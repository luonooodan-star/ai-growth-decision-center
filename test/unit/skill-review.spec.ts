import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalDatabaseService } from '@server/database/local-database.service';
import { MetaOperationsService } from '@server/modules/growth-decision/meta-operations.service';
import {
  SkillReviewService,
  previousReviewWeek,
} from '@server/modules/growth-decision/skill-review.service';
import { buildCampaignCard } from '@server/modules/growth-decision/campaign-decision-engine';
import type {
  CampaignDailySnapshot,
  MetaOperationInput,
} from '@shared/api.interface';

describe('weekly operation learning', () => {
  let db: LocalDatabaseService,
    meta: MetaOperationsService,
    service: SkillReviewService,
    dir: string,
    prior: string | undefined;
  const now = new Date('2026-01-12T03:00:00Z');
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    prior = process.env.GROWTH_DATABASE_PATH;
    dir = mkdtempSync(join(tmpdir(), 'growth-weekly-'));
    process.env.GROWTH_DATABASE_PATH = join(dir, 'test.sqlite');
    db = new LocalDatabaseService();
    meta = new MetaOperationsService(db);
    service = new SkillReviewService(db, meta);
  });
  afterEach(() => {
    db.onModuleDestroy();
    rmSync(dir, { recursive: true });
    if (prior === undefined) delete process.env.GROWTH_DATABASE_PATH;
    else process.env.GROWTH_DATABASE_PATH = prior;
    jest.useRealTimers();
  });
  function seed(withPrior = true) {
    const product = db.listProducts()[0];
    const snapshot: CampaignDailySnapshot = {
      key: 's',
      productId: product.id,
      accountId: '11',
      campaignId: '22',
      campaignName: 'fixture',
      dataDate: '2026-01-06',
      fetchedAt: '2026-01-07T00:00:00Z',
      countries: ['IN'],
      metrics: { spend: 50, adjust_installs: 200, d0_roas: 0.8 },
      breakdowns: [],
      qualityIssues: [],
    };
    db.saveCampaignSnapshot(snapshot);
    if (withPrior) {
      const card = buildCampaignCard(
        product,
        [snapshot],
        [],
        new Date('2026-01-07T01:00:00Z'),
      );
      card.verdict = 'decrease';
      db.saveCampaignRecommendation({
        id: 'old-recommendation',
        productId: product.id,
        createdAt: '2026-01-07T01:00:00Z',
        skillVersion: 'v1',
        card,
      });
    }
    const op: MetaOperationInput = {
      accountId: '11',
      campaignId: '22',
      objectId: '22',
      objectName: 'fixture',
      objectLevel: 'campaign',
      actorId: '33',
      actorName: 'optimizer',
      systemActor: false,
      occurredAt: '2026-01-08T01:00:00Z',
      accountTimezone: 'Asia/Shanghai',
      eventType: 'budget',
      field: 'budget',
      before: 100,
      after: 150,
      raw: '{}',
    };
    meta.import({ operations: [op] });
    return product;
  }
  it('uses last complete Shanghai calendar week', () => {
    expect(previousReviewWeek(now)).toEqual({
      start: '2026-01-05',
      end: '2026-01-11',
    });
  });
  it('records a real pre-operation conflict once and preserves optional human rationale', () => {
    seed();
    const review = meta.overview().items[0];
    expect(review.decision?.state).toBe('conflict');
    meta.annotate(review.operation.id, '等待归因回补，小幅试量');
    expect(meta.overview().items[0].decision?.humanReason).toContain(
      '归因回补',
    );
  });
  it('never reconstructs missing historical recommendations using current rules', () => {
    seed(false);
    expect(meta.overview().items[0].decision?.state).toBe('unknown');
  });
  it('deduplicates weeks, locks claims, validates evidence, and requires human approval', () => {
    const product = seed();
    service.generate(now);
    service.generate(now);
    expect(service.list()).toHaveLength(1);
    const job = service.claim(now).job!;
    expect(service.claim(now).job).toBeNull();
    expect(() =>
      service.submit({
        id: job.id,
        leaseToken: 'wrong',
        summary: 's',
        candidates: [],
      }),
    ).toThrow();
    expect(() =>
      service.submit({
        id: job.id,
        leaseToken: job.leaseToken,
        summary: 's',
        candidates: [
          {
            title: 't',
            conclusion: 'c',
            caution: 'x',
            evidenceIds: ['invented'],
          },
        ],
      }),
    ).toThrow();
    service.submit({
      id: job.id,
      leaseToken: job.leaseToken,
      summary: '相关性待验证',
      candidates: [
        {
          title: '试量条件',
          conclusion: '先核对归因回补',
          caution: '一个样本不能证明因果',
          evidenceIds: [job.evidence.operations[0].operation.id],
        },
      ],
    });
    expect(db.getProduct(product.id)?.knowledge || []).toHaveLength(0);
    service.review(job.id, 0, 'approved');
    expect(db.getProduct(product.id)?.knowledge).toHaveLength(1);
    expect(db.getProduct(product.id)?.campaignRules).toEqual(
      product.campaignRules,
    );
    expect(() => service.review(job.id, 0, 'approved')).toThrow();
  });
  it('failed tasks require visible retry and expired leases cannot overwrite', () => {
    seed();
    const job = service.claim(now).job!;
    service.fail({
      id: job.id,
      leaseToken: job.leaseToken,
      error: 'test failure',
    });
    expect(service.claim(now).job).toBeNull();
    service.retry(job.id);
    const next = service.claim(now).job!;
    expect(next.leaseToken).not.toBe(job.leaseToken);
    expect(() =>
      service.submit({
        id: job.id,
        leaseToken: job.leaseToken,
        summary: 'stale',
        candidates: [],
      }),
    ).toThrow();
  });
});
