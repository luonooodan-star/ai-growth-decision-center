import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalDatabaseService } from '@server/database/local-database.service';
import { GrowthMavisAnalysisService } from '@server/modules/growth-decision/growth-mavis-analysis.service';
import type {
  GrowthJudgment,
  GrowthMavisJob,
  GrowthProduct,
} from '@shared/api.interface';

describe('GrowthMavisAnalysisService', (): void => {
  const databasePath: string = join(
    tmpdir(),
    `ai-growth-mavis-${randomUUID()}.sqlite`,
  );
  let database: LocalDatabaseService;
  let service: GrowthMavisAnalysisService;

  beforeAll((): void => {
    process.env.GROWTH_DATABASE_PATH = databasePath;
    delete process.env.MAVIS_WORKER_MODE;
    database = new LocalDatabaseService();
    service = new GrowthMavisAnalysisService(database);
  });

  afterAll((): void => {
    database.onModuleDestroy();
    delete process.env.GROWTH_DATABASE_PATH;
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(`${databasePath}${suffix}`, { force: true });
    }
  });

  it('creates a persisted job and writes the simulated result back', async (): Promise<void> => {
    const product: GrowthProduct = database.listProducts()[0];
    const judgment: GrowthJudgment = {
      id: randomUUID(),
      productId: product.id,
      productName: product.name,
      anomalyType: 'CPI 高于上界',
      severity: 'high',
      status: 'judgment_pending',
      channel: 'facebook',
      campaignId: 'campaign-test',
      campaignName: 'Test Campaign',
      adsetId: 'adset-test',
      adsetName: 'Test Adset',
      targetMetric: 'cpi',
      currentValue: 2,
      baselineValue: 1.5,
      deviationPct: 33.33,
      metricValues: { cpi: 2 },
      diagnosticContext: {
        dataDate: '2026-08-31',
        comparisonDays: 3,
        current: { spend: 100, cpi: 2, ecpm: 8, ctr: 0.01, ipm: 2 },
        previousAverage: {
          spend: 80,
          cpi: 1.5,
          ecpm: 5,
          ctr: 0.02,
          ipm: 4,
        },
        changesPct: {
          spend: 25,
          cpi: 33.33,
          ecpm: 60,
          ctr: -50,
          ipm: -50,
        },
        breakdowns: [],
        availableFields: ['spend', 'cpi', 'ecpm', 'ctr', 'ipm'],
        missingFields: ['adjust_revenue', 'roas', 'd0_roas'],
        availableDimensions: ['campaign', 'adset'],
        missingDimensions: ['placement', 'age', 'gender', 'audience'],
      },
      spend: 100,
      evidence: 'CPI $2.000，高于上界 $1.500。',
      rootCause: '待进一步分析',
      confidence: 95,
      preliminaryJudgment: '异常条件成立，等待人工确认。',
      createdAt: new Date().toISOString(),
    };
    database.saveDecisionRecord(judgment);

    const result: GrowthJudgment = await service.analyzeJudgment(
      judgment.id,
      'default',
      'manual',
    );
    const jobs: GrowthMavisJob[] = service.listJobs(judgment.id).items;

    expect(result.aiAnalysisStatus).toBe('completed');
    expect(result.aiAnalysis?.provider).toBe('product_skill');
    expect(result.aiAnalysis?.judgment).toBe('confirmed');
    expect(result.aiAnalysis?.recommendedActions?.[0].actionType).toBe(
      'rotate_creative',
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('completed');
    expect(jobs[0].skillVersion).toBe(product.skillVersion);
  });
});
