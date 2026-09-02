import { BadRequestException } from '@nestjs/common';

import { validateBatchAnalysisCoverage } from '@server/modules/growth-decision/growth-batch-analysis-validation';
import type {
  CompleteGrowthMavisBatchJobRequest,
  GrowthMavisJob,
} from '@shared/api.interface';

const analysis: CompleteGrowthMavisBatchJobRequest['analyses'][number]['analysis'] =
  {
    judgment: 'uncertain',
    confidence: 80,
    summary: '测试分析',
    primaryCause: '测试原因',
    alternativeCauses: [],
    evidence: [],
    recommendedNextStep: '继续观察',
    observationHours: 1,
    risk: '测试风险',
    actionProposals: [],
  };

function batchJob(ids: string[]): GrowthMavisJob {
  return {
    id: 'job-1',
    judgmentId: ids[0],
    judgmentIds: ids,
    productId: 'product-1',
    productName: 'Wingslite',
    jobType: 'batch_anomaly_assessment',
    trigger: 'manual',
    status: 'running',
    skillVersion: '1.0.0',
    attempt: 1,
    createdAt: new Date(0).toISOString(),
  };
}

describe('validateBatchAnalysisCoverage', () => {
  it('accepts a complete batch regardless of order and trims ids', () => {
    const analyses: CompleteGrowthMavisBatchJobRequest['analyses'] = [
      { judgmentId: ' judgment-b ', analysis },
      { judgmentId: 'judgment-a', analysis },
    ];

    expect(() =>
      validateBatchAnalysisCoverage(
        batchJob(['judgment-a', 'judgment-b']),
        analyses,
      ),
    ).not.toThrow();
    expect(analyses[0].judgmentId).toBe('judgment-b');
  });

  it('reports missing, unknown and duplicate ids separately', () => {
    const analyses: CompleteGrowthMavisBatchJobRequest['analyses'] = [
      { judgmentId: 'judgment-a', analysis },
      { judgmentId: 'judgment-a', analysis },
      { judgmentId: 'judgment-c', analysis },
    ];

    expect(() =>
      validateBatchAnalysisCoverage(
        batchJob(['judgment-a', 'judgment-b', 'judgment-d']),
        analyses,
      ),
    ).toThrow(
      new BadRequestException(
        '整批分析覆盖不完整：期望 3 条，收到 3 条；' +
          '缺失 ID=["judgment-b","judgment-d"]；' +
          '未知 ID=["judgment-c"]；' +
          '重复 ID=["judgment-a"]',
      ),
    );
  });
});
