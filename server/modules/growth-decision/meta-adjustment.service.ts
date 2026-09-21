import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import axios from 'axios';
import { createHash, randomUUID } from 'node:crypto';
import { LocalDatabaseService } from '@server/database/local-database.service';
import { metaWorkspaceOrigin } from '@shared/meta-workspace';
import { readMetaLocalBridge } from './meta-local-bridge';
import {
  validateAdjustmentChange,
  validateAdjustmentTarget,
  type MetaAdjustmentChange,
  type MetaAdjustmentJob,
  type MetaAdjustmentSnapshot,
  type MetaAdjustmentTarget,
} from '@shared/meta-adjustment';

@Injectable()
export class MetaAdjustmentService {
  private readonly logger = new Logger(MetaAdjustmentService.name);
  private readonly identities = new Map<
    string,
    { ownerId: string; until: number }
  >();
  constructor(private readonly db: LocalDatabaseService) {
    for (const job of db.listAdjustmentJobs())
      if (job.state === 'running') {
        job.state = 'interrupted';
        job.completedAt = new Date().toISOString();
        for (const item of job.items)
          if (item.state === 'running' || item.state === 'pending') {
            item.error =
              item.state === 'running'
                ? '服务重启，提交结果不确定，请核对 Meta，勿直接重试'
                : '服务重启，尚未执行';
            item.state = item.state === 'running' ? 'uncertain' : 'failed';
          }
        db.saveAdjustmentJob(job);
      }
  }
  private cookie(raw: string): string {
    const session = raw
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('meta_session='));
    if (!session || session.length > 16384)
      throw new UnauthorizedException(
        '请在同主机 HTTPS 原广告工具登录 Meta，然后回到本页',
      );
    return session;
  }
  private async relay<T>(cookie: string, body: object): Promise<T> {
    const local = readMetaLocalBridge();
    const origin =
      local?.origin ||
      metaWorkspaceOrigin(process.env.GROWTH_META_WORKSPACE_ORIGIN);
    if (!origin)
      throw new BadRequestException('未配置原广告服务地址，无法执行调整');
    try {
      return (
        await axios.post<T>(`${origin}/api/meta/growth-adjustments`, body, {
          headers: local
            ? {
                Authorization: `Bearer ${local.secret}`,
                'Content-Type': 'application/json',
              }
            : { Cookie: this.cookie(cookie), Origin: origin },
          proxy: false,
          timeout: 45000,
          maxRedirects: 0,
          maxContentLength: 2 * 1024 * 1024,
        })
      ).data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401)
          throw new UnauthorizedException(
            local
              ? '本机授权缺失或登录失效，请在原广告工具打开 /growth-center-link 重新授权'
              : 'Meta 登录已失效，请重新登录',
          );
        const data = error.response?.data;
        const uncertain = !error.response || data?.uncertain === true;
        const message =
          typeof data?.error === 'string'
            ? data.error.slice(0, 250)
            : error.response?.status === 404
              ? '原广告服务尚未安装调整适配接口'
              : '原广告服务连接或校验失败';
        throw new BadRequestException({ message, uncertain });
      }
      throw error;
    }
  }
  async identity(cookie: string): Promise<string> {
    if (readMetaLocalBridge()) {
      // Shared local authorization can be rebound/revoked: never cache its identity.
      const result = await this.relay<{ ownerId: string }>(cookie, {
        action: 'identity',
      });
      if (!result.ownerId)
        throw new UnauthorizedException('无法识别本机授权的 Meta 用户');
      return result.ownerId;
    }
    const key = createHash('sha256').update(this.cookie(cookie)).digest('hex');
    const cached = this.identities.get(key);
    if (cached && cached.until > Date.now()) return cached.ownerId;
    const result = await this.relay<{ ownerId: string }>(cookie, {
      action: 'identity',
    });
    if (!result.ownerId) throw new UnauthorizedException('无法识别 Meta 用户');
    for (const [k, v] of this.identities)
      if (v.until <= Date.now()) this.identities.delete(k);
    this.identities.set(key, {
      ownerId: result.ownerId,
      until: Date.now() + 60000,
    });
    return result.ownerId;
  }
  async inspect(
    cookie: string,
    target: MetaAdjustmentTarget,
    creative = false,
  ): Promise<MetaAdjustmentSnapshot[]> {
    validateAdjustmentTarget(target);
    if (creative)
      return (
        await this.relay<{ snapshots: MetaAdjustmentSnapshot[] }>(cookie, {
          action: 'resolve-ad',
          target,
        })
      ).snapshots;
    return [
      (
        await this.relay<{ snapshot: MetaAdjustmentSnapshot }>(cookie, {
          action: 'read',
          target,
        })
      ).snapshot,
    ];
  }
  async preview(
    cookie: string,
    changes: MetaAdjustmentChange[],
  ): Promise<MetaAdjustmentJob> {
    if (!Array.isArray(changes) || !changes.length || changes.length > 100)
      throw new BadRequestException('每批需包含 1 至 100 项修改');
    const ownerId = await this.identity(cookie);
    const job: MetaAdjustmentJob = {
      id: randomUUID(),
      ownerId,
      createdAt: new Date().toISOString(),
      state: 'preview',
      items: [],
    };
    const seen = new Set<string>();
    for (const change of changes) {
      validateAdjustmentChange(change);
      const key = `${change.before.accountId}:${change.before.id}`;
      if (seen.has(key))
        throw new BadRequestException('同一对象重复提交，请合并修改');
      seen.add(key);
    }
    // Bound read concurrency; actual mutations remain strictly sequential.
    for (let offset = 0; offset < changes.length; offset += 4) {
      const items = await Promise.all(
        changes.slice(offset, offset + 4).map(async (change) => {
          const before = (
            await this.relay<{ snapshot: MetaAdjustmentSnapshot }>(cookie, {
              action: 'read',
              target: change.before,
              ownerId,
            })
          ).snapshot;
          const item = {
            before,
            ...(change.status ? { status: change.status } : {}),
            ...(change.dailyBudget !== undefined
              ? { dailyBudget: change.dailyBudget }
              : {}),
            state: 'pending' as const,
          };
          validateAdjustmentChange(item);
          if (!['ACTIVE', 'PAUSED'].includes(before.status))
            throw new BadRequestException('不能调整已归档或删除的对象');
          return item;
        }),
      );
      job.items.push(...items);
    }
    job.createdAt = new Date().toISOString();
    this.db.saveAdjustmentJob(job);
    return job;
  }
  async list(cookie: string): Promise<MetaAdjustmentJob[]> {
    const owner = await this.identity(cookie);
    return this.db
      .listAdjustmentJobs()
      .filter((j) => j.ownerId === owner)
      .slice(0, 100);
  }
  async submit(cookie: string, id: string): Promise<MetaAdjustmentJob> {
    const owner = await this.identity(cookie);
    const all = this.db.listAdjustmentJobs();
    const job = all.find((j) => j.id === id && j.ownerId === owner);
    if (!job) throw new BadRequestException('找不到当前用户的预检任务');
    if (job.state !== 'preview') return job; // Idempotent: never replay a submitted job.
    if (Date.now() - Date.parse(job.createdAt) > 10 * 60000)
      throw new BadRequestException('确认清单已过期，请重新预检');
    if (all.some((j) => j.state === 'running'))
      throw new BadRequestException('已有调整任务执行中，请完成后再提交');
    job.state = 'running';
    job.submittedAt = new Date().toISOString();
    this.db.saveAdjustmentJob(job);
    void this.run(cookie, job).catch(() => {
      // Persistence failure: do not continue any remaining mutation. Restart recovery marks inflight rows uncertain.
      this.logger.error(
        `调整任务 ${job.id} 留档失败，已停止执行；需核对数据库与 Meta 状态`,
      );
    });
    return job;
  }
  private async run(cookie: string, job: MetaAdjustmentJob): Promise<void> {
    for (const item of job.items) {
      item.state = 'running';
      item.startedAt = new Date().toISOString();
      this.db.saveAdjustmentJob(job);
      try {
        const result = await this.relay<{ after: MetaAdjustmentSnapshot }>(
          cookie,
          { action: 'apply', change: item, ownerId: job.ownerId },
        );
        item.after = result.after;
        item.state = 'succeeded';
      } catch (error) {
        const response =
          error instanceof BadRequestException
            ? error.getResponse()
            : undefined;
        const uncertain =
          typeof response === 'object' &&
          response !== null &&
          'uncertain' in response &&
          response.uncertain === true;
        item.state = uncertain ? 'uncertain' : 'failed';
        item.error = error instanceof Error ? error.message : '执行失败';
      }
      item.completedAt = new Date().toISOString();
      this.db.saveAdjustmentJob(job);
      if (item.state === 'uncertain') {
        for (const pending of job.items)
          if (pending.state === 'pending') {
            pending.state = 'failed';
            pending.error = '前项结果不确定，已停止后续执行';
          }
        break;
      }
    }
    job.state = 'completed';
    job.completedAt = new Date().toISOString();
    this.db.saveAdjustmentJob(job);
  }
}
