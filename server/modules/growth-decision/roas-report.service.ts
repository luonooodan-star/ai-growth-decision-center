import { ReportCacheService, reportCycle } from './report-cache.service';
import { Injectable } from '@nestjs/common';
import type { CreativeAnalysisQuery } from '@shared/creative-analysis.interface';
import { buildRoasReport, type RoasReport } from '@shared/roas-report';
import { PaidGrowthService } from './paid-growth.service';
import { validateCreativeAnalysisQuery } from './creative-analysis.service';
@Injectable()
export class RoasReportService {
  constructor(
    private readonly bi: PaidGrowthService,
    private readonly cache: ReportCacheService,
  ) {}
  async query(q: CreativeAnalysisQuery): Promise<RoasReport> {
    validateCreativeAnalysisQuery(q);
    const rows: RoasReport['rows'] = [],
      issues = new Set<string>(),
      times: string[] = [];
    for (const platform of q.platform === 'all'
      ? (['android', 'ios'] as const)
      : [q.platform])
      for (
        let date = q.start;
        date <= q.end;
        date = new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10)
      ) {
        const task = { kind: 'roas' as const, date, platform, hourly: false };
        this.cache.track(task);
        const old = this.cache.read<RoasReport>(task);
        let report = old?.data;
        if (!q.refresh && !report && this.cache.error(task)) {
          issues.add(
            `${date} 暂无成功缓存；上次读取失败，请等待每日 10:00 更新或手动重新抓取。`,
          );
          continue;
        }
        if (q.refresh || !report) {
          const next = await this.fetchDay({
            ...q,
            start: date,
            end: date,
            platform,
          });
          if (next.cacheable) {
            this.cache.save(task, next);
            report = next;
          } else {
            const message = next.issues.join('；');
            this.cache.mark(task, reportCycle(), message);
            issues.add(`${date}：更新未完成${old ? '，保留上次成功缓存' : ''}`);
            next.issues.forEach((i) => issues.add(i));
            if (!report) report = next;
          }
        }
        rows.push(...report!.rows);
        report!.issues.forEach((i) => issues.add(i));
        times.push(report!.generatedAt);
        const error = this.cache.error(task);
        if (error) issues.add(`${date} 上次更新失败：${error}`);
      }
    return {
      rows: rows.sort(
        (a, b) =>
          b.date.localeCompare(a.date) || a.buyer.localeCompare(b.buyer),
      ),
      issues: [...issues],
      generatedAt: times.sort()[0] || new Date().toISOString(),
    };
  }
  private async fetchDay(
    q: CreativeAnalysisQuery,
  ): Promise<RoasReport & { cacheable: boolean }> {
    const filters = {
      app_id: q.platform === 'all' ? [3, 12] : q.platform === 'ios' ? 3 : 12,
    };
    const base = { start_date: q.start, end_date: q.end };
    const daily = await this.bi.part(
      {
        ...base,
        dataset: 'bi_ads.ads_paid_acquisition_daily',
        dimensions: [
          'app_id',
          'buyer_alias',
          'media_source',
          'report_date',
          'media_report_date_timezone',
        ],
        metrics: ['spend'],
        filters_json: JSON.stringify(filters),
      },
      !!q.refresh,
      300000,
      'roas-report:v1',
    );
    const cohort = await this.bi.part(
      {
        ...base,
        dataset: 'bi_ads.ads_paid_acquisition_cohort_metric',
        dimensions: [
          'app_id',
          'buyer_alias',
          'media_source',
          'install_date',
          'cohort_index',
          'observation_complete',
        ],
        metrics: ['cumulative_metric_value'],
        filters_json: JSON.stringify({
          ...filters,
          metric_id: 'revenue',
          cohort_unit: 'D',
          cohort_index: Array.from({ length: 15 }, (_, i) => i),
        }),
      },
      !!q.refresh,
      300000,
      'roas-report:v1',
    );
    const issues = [
      '收入沿用 Doris 同期群表时区；未独立核实。* 表示观察未完成；↓ 表示源累计收入较前一日回落。',
    ];
    for (const [label, part] of [
      ['消耗', daily],
      ['收入', cohort],
    ] as const)
      if (!['fresh', 'cached'].includes(part.state))
        issues.push(`${label}：${part.message || part.state}`);
    if (
      daily.rows.some((r) => r.media_report_date_timezone !== 'Asia/Shanghai')
    )
      issues.push('部分媒体消耗的时区不是 Asia/Shanghai 或缺失，请核对来源。');
    return {
      cacheable:
        ['fresh', 'cached'].includes(daily.state) &&
        ['fresh', 'cached'].includes(cohort.state),
      rows: ['fresh', 'cached'].includes(daily.state)
        ? buildRoasReport(
            daily.rows,
            ['fresh', 'cached'].includes(cohort.state) ? cohort.rows : [],
          )
        : [],
      generatedAt: new Date().toISOString(),
      issues,
    };
  }
}
