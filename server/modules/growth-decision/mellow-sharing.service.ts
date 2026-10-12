import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { centerIdentity } from '../../common/utils/center-identity';
import { canReadMellowShared } from '../../common/utils/mellow-sharing';
import {
  personalDorisStatus,
  personalScopeKey,
  runPersonalData,
} from '../../common/utils/personal-doris';
import type {
  CreativeAnalysisJob,
  CreativeAnalysisQuery,
} from '@shared/creative-analysis.interface';
import type { MellowSharedRoas } from '@shared/mellow-sharing.interface';
import {
  CreativeAnalysisService,
  validateCreativeAnalysisQuery,
} from './creative-analysis.service';
import { PaidGrowthService } from './paid-growth.service';

@Injectable()
export class MellowSharingService {
  private handles = new Map<
    string,
    {
      viewer: string;
      ownerRevision: string;
      sourceId: string;
      created: number;
      cancelled: boolean;
    }
  >();
  private roasPending = new Map<string, Promise<MellowSharedRoas>>();
  constructor(
    private readonly analysis: CreativeAnalysisService,
    private readonly bi: PaidGrowthService,
  ) {}
  private grant() {
    if (!canReadMellowShared(centerIdentity.getStore()))
      throw new ForbiddenException('未获 Mellow 数据共享授权');
    const owner = personalDorisStatus('growth');
    if (!owner.configured)
      throw new ConflictException('growth 数据授权未配置，请联系管理员同步');
    return owner.revision;
  }
  private validate(query: CreativeAnalysisQuery) {
    validateCreativeAnalysisQuery(query);
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Shanghai',
    });
    if (Date.parse(today) - Date.parse(query.start) > 89 * 86400000)
      throw new ConflictException('共享数据仅支持最近 90 天，每次最多 31 天');
  }
  start(query: CreativeAnalysisQuery): CreativeAnalysisJob {
    const revision = this.grant();
    this.validate(query);
    // Fixed Mellow analysis contract; never forward client-supplied datasets, identities or filters.
    const q: CreativeAnalysisQuery = {
      start: query.start,
      end: query.end,
      platform: query.platform,
      refresh: false,
    };
    const source = runPersonalData('growth', () => this.analysis.start(q));
    for (const [id, h] of this.handles)
      if (Date.now() - h.created > 1800000) this.handles.delete(id);
    const existing = [...this.handles].find(
      ([, h]) =>
        h.viewer === personalScopeKey() &&
        h.sourceId === source.id &&
        !h.cancelled,
    );
    if (existing) return this.status(existing[0]);
    if (this.handles.size >= 200)
      throw new ConflictException('共享任务较多，请稍后重试');
    const id = randomUUID();
    this.handles.set(id, {
      viewer: personalScopeKey(),
      ownerRevision: revision,
      sourceId: source.id,
      created: Date.now(),
      cancelled: false,
    });
    return this.status(id);
  }
  status(id: string): CreativeAnalysisJob {
    const revision = this.grant();
    const h = this.handles.get(id);
    if (
      !h ||
      h.viewer !== personalScopeKey() ||
      h.ownerRevision !== revision ||
      Date.now() - h.created > 1800000
    )
      throw new NotFoundException('共享任务已失效，请重新查询');
    if (h.cancelled)
      return {
        id,
        state: 'cancelled',
        progress: '已停止等待，不中断其他用户的同步',
      };
    const source = runPersonalData('growth', () =>
      this.analysis.status(h.sourceId),
    );
    return {
      ...source,
      id,
      ...(source.report
        ? { report: { ...source.report, sharedOwner: 'growth' as const } }
        : {}),
    };
  }
  cancel(id: string) {
    this.status(id);
    this.handles.get(id)!.cancelled = true;
    return this.status(id);
  }
  roas(query: CreativeAnalysisQuery): Promise<MellowSharedRoas> {
    const revision = this.grant();
    this.validate(query);
    const key = `${revision}:${query.start}:${query.end}`;
    const active = this.roasPending.get(key);
    if (active) return active;
    if (this.roasPending.size >= 2)
      throw new ConflictException('共享 ROAS 同步繁忙，请稍后重试');
    const job = runPersonalData('growth', () => this.readRoas(query))
      .then((report) => {
        const owner = personalDorisStatus('growth');
        if (!owner.configured || owner.revision !== revision)
          throw new ConflictException('growth 授权已变化，请重新同步');
        return report;
      })
      .finally(() => this.roasPending.delete(key));
    this.roasPending.set(key, job);
    return job;
  }
  private async readRoas(q: CreativeAnalysisQuery): Promise<MellowSharedRoas> {
    const base = {
      start_date: q.start,
      end_date: q.end,
      dimensions: ['app_id', 'media_source'],
    };
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Shanghai',
    });
    const ttl = q.end < today ? 86400000 : 300000;
    const [daily, cohort] = await Promise.all([
      this.bi.part(
        {
          ...base,
          dataset: 'bi_ads.ads_paid_acquisition_daily',
          metrics: ['spend'],
          filters_json: JSON.stringify({ app_id: 3 }),
        },
        false,
        ttl,
      ),
      this.bi.part(
        {
          ...base,
          dataset: 'bi_ads.ads_paid_acquisition_cohort_metric',
          metrics: ['metric_value'],
          filters_json: JSON.stringify({
            app_id: 3,
            metric_id: 'revenue',
            cohort_index: 0,
            cohort_unit: 'D',
          }),
        },
        false,
        ttl,
      ),
    ]);
    const issues: string[] = [];
    const sum = (
      part: typeof daily,
      metric: string,
      organic = false,
    ): number | null => {
      if (
        !['fresh', 'cached'].includes(part.state) ||
        !part.rows.length ||
        part.rows.some(
          (r) =>
            Number(r.app_id) !== 3 ||
            r[metric] == null ||
            !Number.isFinite(Number(r[metric])),
        )
      ) {
        issues.push(
          `${metric === 'spend' ? '消耗' : 'D0 收入'}未完整返回，请稍后同步`,
        );
        return null;
      }
      const rows = organic
        ? part.rows.filter(
            (r) => String(r.media_source).toLowerCase() === 'organic',
          )
        : part.rows;
      if (organic && !rows.length) {
        issues.push('自然量收入未返回');
        return null;
      }
      return rows.reduce((n, r) => n + Number(r[metric]), 0);
    };
    const spend = sum(daily, 'spend'),
      revenue = sum(cohort, 'metric_value'),
      organicRevenue = sum(cohort, 'metric_value', true);
    const times = [daily.updatedAt, cohort.updatedAt]
      .filter((v): v is string => !!v)
      .sort();
    if (q.end === today) issues.push('包含今天，D0 数据仍会回补');
    return {
      owner: 'growth',
      start: q.start,
      end: q.end,
      updatedAt: times[0],
      spend,
      revenue,
      organicRevenue,
      roas:
        spend !== null &&
        spend > 0 &&
        revenue !== null &&
        organicRevenue !== null
          ? (revenue / spend) * 100
          : null,
      issues: [...new Set(issues)],
    };
  }
}
