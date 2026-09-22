import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import axios from 'axios';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { centerIdentity } from '../../common/utils/center-identity';
import { AdjustmentLocks } from '../../common/utils/adjustment-locks';
import { LocalDatabaseService } from '@server/database/local-database.service';
import { metaWorkspaceOrigin } from '@shared/meta-workspace';
import { readMetaLocalBridge } from './meta-local-bridge';
import {
  validateAdjustmentChange,
  sanitizeMetaFailure,
  validateAdjustmentTarget,
  type MetaAdjustmentChange,
  type MetaAdjustmentJob,
  type MetaAdjustmentSnapshot,
  type MetaAdjustmentTarget,
} from '@shared/meta-adjustment';

@Injectable()
export class MetaAdjustmentService {
  private readonly logger = new Logger(MetaAdjustmentService.name);
  private readonly executionLocks = new AdjustmentLocks();
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
    const username = centerIdentity.getStore();
    if (local && !username)
      throw new UnauthorizedException(
        '需要个人登录身份，禁止使用共用 Meta 授权',
      );
    const origin =
      local?.origin ||
      metaWorkspaceOrigin(process.env.GROWTH_META_WORKSPACE_ORIGIN);
    if (!origin)
      throw new BadRequestException('未配置原广告服务地址，无法执行调整');
    try {
      const response = await axios.post<T>(
        `${origin}/api/meta/growth-adjustments`,
        body,
        {
          headers: local
            ? {
                Authorization: `Bearer ${local.secret}`,
                'X-Growth-User': username!,
                'Content-Type': 'application/json',
              }
            : { Cookie: this.cookie(cookie), Origin: origin },
          proxy: false,
          timeout: 45000,
          maxRedirects: 0,
          maxContentLength: 2 * 1024 * 1024,
        },
      );
      if (local && response.headers?.['x-growth-identity-version'] !== '2')
        throw new UnauthorizedException(
          '本机桥尚未升级个人授权版本，请先更新并重启原工具；已阻止使用共用授权',
        );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401)
          throw new UnauthorizedException(
            local
              ? '当前用户 Meta 授权缺失或失效，请点击「绑定我的 Meta」重新授权'
              : 'Meta 登录已失效，请重新登录',
          );
        const data = error.response?.data;
        const metaFailure = sanitizeMetaFailure(data?.metaFailure);
        const uncertain = !error.response || data?.uncertain === true;
        const message = metaFailure
          ? metaFailure.message
          : typeof data?.error === 'string'
            ? data.error.slice(0, 250)
            : error.response?.status === 404
              ? '原广告服务尚未安装调整适配接口'
              : '原广告服务连接或校验失败';
        const diagnostic = metaFailure
          ? `META_${metaFailure.category.toUpperCase()}`
          : !error.response
            ? ['ECONNABORTED', 'ETIMEDOUT'].includes(error.code || '')
              ? 'BRIDGE_TIMEOUT'
              : 'BRIDGE_UNREACHABLE'
            : error.response.status === 404
              ? 'ADAPTER_MISSING'
              : error.response.status >= 500
                ? 'UPLOADER_ERROR'
                : 'UPSTREAM_REJECTED';
        throw new BadRequestException({
          message,
          uncertain,
          diagnostic,
          metaFailure,
        });
      }
      throw error;
    }
  }
  async authorizationStatus(cookie: string) {
    if (!centerIdentity.getStore())
      throw new UnauthorizedException('需要个人登录');
    try {
      const ownerId = await this.identity(cookie);
      return {
        status: 'authorized',
        ownerId,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      const response =
        error instanceof BadRequestException ? error.getResponse() : undefined;
      const code =
        error instanceof UnauthorizedException
          ? 'AUTH_REQUIRED'
          : typeof response === 'object' && 'diagnostic' in response
            ? String(response.diagnostic)
            : 'CHECK_FAILED';
      const metaFailure =
        typeof response === 'object' && 'metaFailure' in response
          ? sanitizeMetaFailure(response.metaFailure)
          : undefined;
      const metaCode =
        metaFailure?.code === undefined
          ? ''
          : `（Meta #${metaFailure.code}${metaFailure.subcode === undefined ? '' : `/${metaFailure.subcode}`}）`;
      const reasons: Record<string, string> = {
        AUTH_REQUIRED:
          '个人授权缺失、失效或适配器身份版本不兼容，请检查个人授权。',
        BRIDGE_TIMEOUT:
          '本机桥请求超过 45 秒未返回；可能堵在原工具或 Meta 上游，不等于授权失效。',
        BRIDGE_UNREACHABLE:
          '决策中心无法连接本机桥，请检查原广告工具进程及桥接端口。',
        ADAPTER_MISSING:
          '原广告工具没有返回调整适配接口，请更新适配器并重启原工具。',
        UPLOADER_ERROR:
          '原广告工具返回服务错误，需检查原工具日志；不要重复提交广告修改。',
        UPSTREAM_REJECTED:
          '请求已收到原工具回复，但身份校验被拒绝；需检查 Meta 登录、权限或上游错误。',
        CHECK_FAILED:
          '连接检查未完成，需检查服务配置及日志；当前不能确认授权状态。',
      };
      return {
        status:
          error instanceof UnauthorizedException ||
          metaFailure?.category === 'authentication'
            ? 'unauthorized'
            : 'unavailable',
        diagnostic: code,
        reason: metaFailure
          ? metaFailure.message + metaCode
          : reasons[code] || reasons.CHECK_FAILED,
        metaFailure,
        checkedAt: new Date().toISOString(),
      };
    }
  }
  authorizationLink() {
    const username = centerIdentity.getStore();
    const local = readMetaLocalBridge();
    if (!username || !local?.workspaceOrigin)
      throw new UnauthorizedException('需要个人登录及本机桥配置');
    const origin = metaWorkspaceOrigin(local.workspaceOrigin);
    if (!origin) throw new BadRequestException('原工具地址配置无效');
    const payload = Buffer.from(
      JSON.stringify({
        username,
        until: Date.now() + 5 * 60000,
        id: randomUUID(),
      }),
    ).toString('base64url');
    const signature = createHmac('sha256', local.secret)
      .update(payload)
      .digest('hex');
    return {
      url: `${origin}/growth-center-link?ticket=${payload}.${signature}`,
    };
  }
  async accountNames(cookie: string, ids: string[]) {
    if (
      !Array.isArray(ids) ||
      ids.length > 10 ||
      ids.some((id) => typeof id !== 'string' || !/^\d{1,40}$/.test(id))
    )
      throw new BadRequestException('广告账户 ID 无效');
    return this.relay<{ accounts: { id: string; name: string }[] }>(cookie, {
      action: 'account-names',
      accountIds: [...new Set(ids)],
    });
  }
  async campaignAccounts(ids: string[]) {
    if (!centerIdentity.getStore() || !readMetaLocalBridge())
      throw new UnauthorizedException('请先连接当前用户的个人 Meta 桥接授权');
    if (
      !Array.isArray(ids) ||
      ids.length > 10 ||
      ids.some((id) => typeof id !== 'string' || !/^\d{1,40}$/.test(id))
    )
      throw new BadRequestException('广告系列 ID 无效');
    return this.relay<{
      ownerId: string;
      campaigns: Array<{ campaignId: string; accountId: string }>;
      unavailable: string[];
    }>('', {
      action: 'campaign-accounts',
      campaignIds: [...new Set(ids)],
    });
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
      centerUsername: centerIdentity.getStore(),
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
      .filter(
        (j) =>
          j.ownerId === owner && j.centerUsername === centerIdentity.getStore(),
      )
      .slice(0, 100);
  }
  async submit(cookie: string, id: string): Promise<MetaAdjustmentJob> {
    const owner = await this.identity(cookie);
    const all = this.db.listAdjustmentJobs();
    const job = all.find(
      (j) =>
        j.id === id &&
        j.ownerId === owner &&
        j.centerUsername === centerIdentity.getStore(),
    );
    if (!job) throw new BadRequestException('找不到当前用户的预检任务');
    if (job.state !== 'preview') return job; // Idempotent: never replay a submitted job.
    if (Date.now() - Date.parse(job.createdAt) > 10 * 60000)
      throw new BadRequestException('确认清单已过期，请重新预检');
    if (all.some((j) => j.state === 'running'))
      throw new BadRequestException('已有调整任务执行中，请完成后再提交');
    let release: () => void;
    try {
      release = this.executionLocks.acquire(
        job.id,
        job.items.map(
          (item) => `${item.before.accountId}:${item.before.campaignId}`,
        ),
      );
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    job.state = 'running';
    job.submittedAt = new Date().toISOString();
    try {
      this.db.saveAdjustmentJob(job);
    } catch (error) {
      release();
      throw error;
    }
    void this.run(cookie, job)
      .then(release)
      .catch(() => {
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
      const matches = this.db
        .listProducts()
        .filter((p) => p.channel.toLowerCase() === 'facebook')
        .map((p) => ({
          product: p,
          snapshots: this.db
            .listCampaignSnapshots(p.id)
            .filter(
              (s) =>
                s.accountId === item.before.accountId &&
                s.campaignId === item.before.campaignId &&
                Date.parse(s.fetchedAt) <= Date.parse(item.startedAt!),
            ),
        }))
        .filter((p) => p.snapshots.length);
      const match = matches.length === 1 ? matches[0] : undefined;
      const baseline = match?.snapshots.sort(
        (a, b) =>
          b.fetchedAt.localeCompare(a.fetchedAt) ||
          b.dataDate.localeCompare(a.dataDate),
      )[0];
      const recommendation = match
        ? this.db
            .listCampaignRecommendations()
            .filter(
              (r) =>
                r.productId === match.product.id &&
                r.card.snapshot.accountId === item.before.accountId &&
                r.card.snapshot.campaignId === item.before.campaignId &&
                Date.parse(r.createdAt) <= Date.parse(item.startedAt!) &&
                Date.parse(r.card.snapshot.fetchedAt) <=
                  Date.parse(item.startedAt!),
            )
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
        : undefined;
      item.evidence = {
        skillVersion: match?.product.skillVersion,
        strategies: match?.product.knowledge?.filter(
          (k) => Date.parse(k.approvedAt) <= Date.parse(item.startedAt!),
        ),
        capturedAt: item.startedAt,
        productId: match?.product.id,
        baseline,
        recommendation,
        note: baseline
          ? '提交时已保存的 Doris 系列累计快照；不是操作时刻的实时增量，需核对数据日、抓取时间和质量。'
          : '提交时没有唯一匹配的 Doris 系列快照，保留缺口，禁止用未来回填数据冒充操作前快照。',
      };
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
