import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CreativeAnalysisJob,
  CreativeAnalysisQuery,
  CreativeAnalysisReport,
  CreativeFunnelRow,
} from '@shared/creative-analysis.interface';
import { FUNNEL_METRICS } from '@shared/creative-analysis.interface';
import type { BiRawRow } from '@shared/paid-growth.interface';
import { LocalDatabaseService } from '@server/database/local-database.service';
import { personalScopeKey } from '../../common/utils/personal-doris';
import { PaidGrowthService } from './paid-growth.service';
import {
  buildCreativeFunnelRows,
  funnelCohort,
  FUNNEL_APPS,
  FUNNEL_EVENTS,
} from './creative-funnel';

const EVENTS = 'bi_dwd.dwd_app_event';
const ATTRIBUTION = 'xy_online_data.tbl_user_access_permissions_all';
const ORDERS = 'xy_online_data.tbl_user_order';
const shift = (date: string, days: number) =>
  new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
const today = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : '读取失败').slice(0, 800);
export function validateCreativeAnalysisQuery(q: CreativeAnalysisQuery) {
  if (!q || !['all', 'android', 'ios'].includes(q.platform))
    throw new BadRequestException('请选择 Mellow 平台');
  for (const date of [q.start, q.end]) {
    if (
      typeof date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      throw new BadRequestException('日期无效');
  }
  if (
    q.end < q.start ||
    Date.parse(q.end) - Date.parse(q.start) > 30 * 86400000 ||
    q.end > today()
  )
    throw new BadRequestException('请选择不超过今天的 1～31 天');
  if (q.refresh !== undefined && typeof q.refresh !== 'boolean')
    throw new BadRequestException('刷新参数无效');
}
type Work = {
  scope: string;
  key: string;
  created: number;
  cancelled: boolean;
  job: CreativeAnalysisJob;
};

@Injectable()
export class CreativeAnalysisService {
  private readonly jobs = new Map<string, Work>();
  private readonly active = new Map<string, Work>();
  constructor(
    private readonly bi: PaidGrowthService,
    private readonly db: LocalDatabaseService,
  ) {}

  start(query: CreativeAnalysisQuery): CreativeAnalysisJob {
    validateCreativeAnalysisQuery(query);
    const q = {
      start: query.start,
      end: query.end,
      platform: query.platform,
      refresh: !!query.refresh,
    };
    const scope = personalScopeKey();
    const key = `${scope}:creative-funnel:v2:${JSON.stringify([q.start, q.end, q.platform])}`;
    const active = this.active.get(scope);
    if (active) {
      if (active.key === key && !active.cancelled) return active.job;
      throw new ConflictException(
        '当前用户的分析仍在读取，请等待完成或取消后重试',
      );
    }
    for (const [id, entry] of this.jobs)
      if (!this.active.has(entry.scope) && Date.now() - entry.created > 1800000)
        this.jobs.delete(id);
    if (this.jobs.size >= 30) {
      const finished = [...this.jobs].find(
        ([, work]) => !this.active.has(work.scope),
      );
      if (finished) this.jobs.delete(finished[0]);
    }
    const work: Work = {
      scope,
      key,
      created: Date.now(),
      cancelled: false,
      job: { id: randomUUID(), state: 'running', progress: '准备读取首开用户' },
    };
    this.jobs.set(work.job.id, work);
    const cached = this.db.getBiCache(key);
    if (!q.refresh && cached) {
      try {
        const report = JSON.parse(cached) as CreativeAnalysisReport;
        const ttl = q.end < today() ? 86400000 : 300000;
        if (
          report.schemaVersion === 2 &&
          Date.now() - Date.parse(report.generatedAt) < ttl
        ) {
          work.job = {
            ...work.job,
            state: 'completed',
            progress: '已读取缓存',
            report: { ...report, cache: true },
          };
          return work.job;
        }
      } catch {
        /* A corrupt cache triggers a fresh, scoped query. */
      }
    }
    if (this.active.size >= 2) {
      this.jobs.delete(work.job.id);
      throw new ConflictException('已有两个分析任务正在读取，请稍后再查询');
    }
    this.active.set(scope, work);
    void this.run(work, q).finally(() => this.active.delete(scope));
    return work.job;
  }
  status(id: string): CreativeAnalysisJob {
    return this.owned(id).job;
  }
  cancel(id: string): CreativeAnalysisJob {
    const work = this.owned(id);
    if (work.job.state === 'running') {
      work.cancelled = true;
      work.job = {
        ...work.job,
        state: 'cancelled',
        progress: '已取消，当前读取结束后停止后续请求',
      };
    }
    return work.job;
  }
  private owned(id: string): Work {
    const work = this.jobs.get(id);
    if (!work || work.scope !== personalScopeKey())
      throw new NotFoundException('分析任务不存在或不属于当前用户');
    return work;
  }
  private async run(work: Work, q: CreativeAnalysisQuery) {
    let sourceFailed = false;
    const issues = new Set<string>();
    const failedSources = new Set<string>();
    const checkpoint = () => {
      if (work.cancelled) throw new Error('任务已取消');
      if (Date.now() - work.created > 8 * 60000)
        throw new Error('本次分析达到八分钟上限，请缩小日期范围');
    };
    const read = async (
      dataset: string,
      start: string,
      end: string,
      dimensions: string[],
      filters: Record<string, unknown>,
      metric: string,
    ): Promise<BiRawRow[]> => {
      checkpoint();
      const part = await this.bi.part(
        {
          dataset,
          start_date: start,
          end_date: end,
          dimensions,
          metrics: [metric],
          filters_json: JSON.stringify(filters),
        },
        !!q.refresh,
        end < today() ? 86400000 : 300000,
        'creative-funnel:v2',
      );
      checkpoint();
      if (!['fresh', 'cached'].includes(part.state))
        throw new Error(part.message || '数据尚未完整返回');
      for (const row of part.rows) {
        const date = String(row.event_date || '').slice(0, 10);
        if (!date || date < start || date > end)
          throw new Error('数据日期与查询范围不一致');
        if (filters.app_id && Number(row.app_id) !== filters.app_id)
          throw new Error('数据产品与查询范围不一致');
        if (filters.bundle_id && row.bundle_id !== filters.bundle_id)
          throw new Error('归因产品与查询范围不一致');
        if (filters.platform && Number(row.platform) !== filters.platform)
          throw new Error('业务数据平台与查询范围不一致');
      }
      return part.rows;
    };
    const optional = async (
      label: string,
      fetch: () => Promise<BiRawRow[]>,
    ) => {
      // Do not amplify an outage/permission denial by retrying every user batch.
      if (failedSources.has(label)) return null;
      try {
        return await fetch();
      } catch (error) {
        checkpoint();
        sourceFailed = true;
        failedSources.add(label);
        issues.add(`${label}：${errorText(error)}`);
        return null;
      }
    };
    try {
      const apps = FUNNEL_APPS.filter(
        (app) => q.platform === 'all' || app.platform === q.platform,
      );
      const first: BiRawRow[] = [];
      const dates: string[] = [];
      for (let date = q.start; date <= q.end; date = shift(date, 1))
        dates.push(date);
      for (const app of apps)
        for (const date of dates) {
          work.job.progress = `${app.platform === 'ios' ? 'iOS' : 'Android'} · ${date} · 读取首开用户`;
          first.push(
            ...(await read(
              EVENTS,
              date,
              date,
              ['event_date', 'app_id', 'resolved_user_id', 'geo_country'],
              { app_id: app.appId, event_name: 'first_open' },
              'event_count',
            )),
          );
          if (first.length > 50000)
            throw new Error('首开数据超过本次分析上限，请缩小日期范围');
        }
      const cohort = funnelCohort(first);
      const buckets = new Map<string, CreativeFunnelRow>();
      for (const app of apps)
        for (const date of dates) {
          checkpoint();
          const users = cohort.users.filter(
            (user) => user.appId === app.appId && user.date === date,
          );
          if (!users.length) continue;
          const label = `${app.platform === 'ios' ? 'iOS' : 'Android'} · ${date}`;
          const orders = app.orders
            ? await optional(`${label} 订单核验`, () =>
                read(
                  ORDERS,
                  date,
                  date,
                  [
                    'event_date',
                    'user_id',
                    'bundle_id',
                    'platform',
                    'action_desc',
                    'env',
                  ],
                  {
                    bundle_id: app.bundle,
                    ...(app.platform === 'ios' ? { platform: 2 } : {}),
                    action_desc: 'PURCHASED',
                    env: 'Production',
                  },
                  'order_count',
                ),
              )
            : null;
          for (let offset = 0; offset < users.length; offset += 200) {
            checkpoint();
            const batch = users.slice(offset, offset + 200);
            const ids = batch.map((user) => user.userId);
            work.job.progress = `${label} · 行为与归因 ${Math.min(offset + 200, users.length)}/${users.length} 人`;
            const events = await optional(`${label} 行为事件`, () =>
              read(
                EVENTS,
                date,
                date,
                [
                  'event_date',
                  'app_id',
                  'resolved_user_id',
                  'event_name',
                  'character_id',
                ],
                {
                  app_id: app.appId,
                  resolved_user_id: ids,
                  event_name: FUNNEL_EVENTS,
                },
                'event_count',
              ),
            );
            const attribution = await optional(`${label} 素材归因`, () =>
              read(
                ATTRIBUTION,
                shift(date, app.platform === 'ios' ? -89 : -7),
                shift(date, 1) > today() ? today() : shift(date, 1),
                [
                  'event_date',
                  'user_id',
                  'bundle_id',
                  'platform',
                  'channel',
                  'campaign',
                  'adgroup',
                  'creative',
                ],
                {
                  bundle_id: app.bundle,
                  user_id: ids,
                  ...(app.platform === 'ios' ? { platform: 2 } : {}),
                },
                'user_count',
              ),
            );
            for (const row of buildCreativeFunnelRows(batch, {
              events,
              attribution,
              orders,
            })) {
              const existing = buckets.get(row.key);
              if (!existing) {
                buckets.set(row.key, row);
                continue;
              }
              existing.users += row.users;
              for (const metric of FUNNEL_METRICS)
                existing[metric] =
                  existing[metric] === null || row[metric] === null
                    ? null
                    : existing[metric]! + row[metric]!;
            }
          }
        }
      checkpoint();
      if (q.end === today()) issues.add('包含今天，D0 行为和归因仍在回传。');
      const report: CreativeAnalysisReport = {
        schemaVersion: 2,
        scope: { ...q, refresh: false },
        generatedAt: new Date().toISOString(),
        cache: false,
        rows: [...buckets.values()],
        issues: [...issues],
        excludedFirstOpenEvents: cohort.excluded,
        duplicateFirstOpenUsers: cohort.duplicates,
      };
      if (!sourceFailed)
        this.db.saveBiCache(
          work.key,
          JSON.stringify({ ...report, updatedAt: report.generatedAt }),
        );
      work.job = {
        ...work.job,
        state: 'completed',
        progress: '读取完成',
        report,
      };
    } catch (error) {
      if (!work.cancelled)
        work.job = {
          ...work.job,
          state: 'failed',
          progress: '读取未完成',
          error: errorText(error),
        };
    }
  }
}
