import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalDatabaseService } from '@server/database/local-database.service';
import { GrowthDecisionService } from '@server/modules/growth-decision/growth-decision.service';
import type { GrowthJudgment, GrowthProduct } from '@shared/api.interface';

describe('Growth record deletion audit', (): void => {
  const databasePath: string = join(
    tmpdir(),
    `ai-growth-delete-${randomUUID()}.sqlite`,
  );
  let database: LocalDatabaseService;
  let service: GrowthDecisionService;

  beforeAll((): void => {
    process.env.GROWTH_DATABASE_PATH = databasePath;
    database = new LocalDatabaseService();
    service = new GrowthDecisionService(database);
  });

  afterAll((): void => {
    database.onModuleDestroy();
    delete process.env.GROWTH_DATABASE_PATH;
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(`${databasePath}${suffix}`, { force: true });
    }
  });

  it('hides a deleted record while preserving record and audit history', async (): Promise<void> => {
    const product: GrowthProduct = database.listProducts()[0];
    const judgment: GrowthJudgment = {
      id: randomUUID(),
      productId: product.id,
      productName: product.name,
      anomalyType: '删除测试异常',
      severity: 'medium',
      status: 'judgment_pending',
      channel: 'facebook',
      targetMetric: 'cpi',
      evidence: '测试证据',
      rootCause: '测试原因',
      confidence: 80,
      preliminaryJudgment: '等待审核',
      skillRuleCandidate: '测试规则候选',
      createdAt: new Date().toISOString(),
    };
    database.saveDecisionRecord(judgment);

    const result = service.deleteRecord(
      judgment.id,
      { confirmation: 'DELETE_RECORD', reason: '测试人工删除' },
      'growth',
    );
    const archived: GrowthJudgment = database.getDecisionRecord(
      judgment.id,
    ) as GrowthJudgment;
    const dashboard = await service.getDashboard();
    const history = await service.getDecisionHistory(judgment.id);

    expect(result.archived).toBe(true);
    expect(archived.deletedBy).toBe('growth');
    expect(archived.deletionReason).toBe('测试人工删除');
    expect(dashboard.judgments.some((item) => item.id === judgment.id)).toBe(
      false,
    );
    expect(history.items[0].action).toBe('record_deleted');
  });
});
