import { Body, Controller, Post, Injectable } from '@nestjs/common';
import type { CreativeAnalysisQuery } from '@shared/creative-analysis.interface';
import { buildRoasReport, type RoasReport } from '@shared/roas-report';
import { PaidGrowthService } from './paid-growth.service';
import { validateCreativeAnalysisQuery } from './creative-analysis.service';
@Injectable()
export class RoasReportService {
  constructor(private readonly bi: PaidGrowthService) {}
  async query(q: CreativeAnalysisQuery): Promise<RoasReport> {
    validateCreativeAnalysisQuery(q);
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
@Controller('api/growth-decision/roas-report')
export class RoasReportController {
  constructor(private readonly service: RoasReportService) {}
  @Post() query(@Body() q: CreativeAnalysisQuery) {
    return this.service.query(q);
  }
}
