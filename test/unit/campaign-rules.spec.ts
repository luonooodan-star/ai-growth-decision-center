import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  CampaignDecisionRule,
  CampaignDailySnapshot,
  GrowthProduct,
} from '@shared/api.interface';
import { LocalDatabaseService } from '@server/database/local-database.service';
import { CampaignDecisionService } from '@server/modules/growth-decision/campaign-decision.service';
import { CampaignBoardManagementService } from '@server/modules/growth-decision/campaign-board-management.service';
import { GrowthDecisionService } from '@server/modules/growth-decision/growth-decision.service';
import { GrowthMavisAnalysisService } from '@server/modules/growth-decision/growth-mavis-analysis.service';
import {
  validateCampaignRules,
  matchCampaignRule,
} from '@server/modules/growth-decision/campaign-rules';
import {
  buildCampaignCard,
  campaignMetric,
  previousDay,
} from '@server/modules/growth-decision/campaign-decision-engine';

const rule = (
  changes: Partial<CampaignDecisionRule> = {},
): CampaignDecisionRule => ({
  id: 'test-rule',
  name: 'High return observe',
  enabled: true,
  verdict: 'observe',
  priority: 50,
  urgent: true,
  consecutiveDays: 2,
  conditions: [
    { metric: 'd0_roas', basis: 'value', operator: 'gte', value: 0.7 },
  ],
  actionText: 'Keep budget; review tomorrow',
  ...changes,
});

describe('campaign rules and one-click batch', () => {
  it('accepts negative day-over-day thresholds and identifies incomplete drafts by rule and condition', () => {
    const valid = rule({
      name: 'D0 ROAS 突降',
      enabled: false,
      consecutiveDays: 1,
      conditions: [
        {
          metric: 'd0_roas',
          basis: 'previous_day_change',
          operator: 'lte',
          value: -25,
        },
      ],
    });
    expect(validateCampaignRules([valid])[0].conditions[0].value).toBe(-25);
    const draft = rule({
      id: 'draft-cpi',
      name: 'CPI 突涨并越界',
      enabled: false,
      conditions: [
        {
          metric: 'cpi',
          basis: 'previous_day_change',
          operator: 'gte',
          value: 30,
        },
        { metric: 'cpi', basis: 'value', operator: 'gte', value: Number.NaN },
      ],
    });
    expect(() =>
      validateCampaignRules(JSON.parse(JSON.stringify([valid, draft]))),
    ).toThrow('规则「CPI 突涨并越界」第 2 个条件');
    expect(() =>
      validateCampaignRules([
        rule({
          conditions: [
            { metric: 'd0_roas', basis: 'value', operator: 'lte', value: -25 },
          ],
        }),
      ]),
    ).toThrow('当日指标值不能为负数');
  });
  it('uses the custom increase duration and surfaces independently matched urgent rules', () => {
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Shanghai',
    });
    const date = previousDay(today);
    const row: CampaignDailySnapshot = {
      key: 'test',
      productId: 'test',
      campaignId: 'test',
      campaignName: 'test',
      accountId: 'test',
      countries: ['IN'],
      dataDate: date,
      fetchedAt: new Date().toISOString(),
      qualityIssues: [],
      breakdowns: [],
      metrics: {
        spend: 100,
        adjust_installs: 500,
        d0_roas: 0.9,
        cpi: 0.2,
        ctr: 0.005,
      },
    };
    const custom = {
      targetMetric: 'd0_roas',
      dataDelayMinutes: 60,
      metrics: [{ key: 'd0_roas', lowerBound: 0.7 }],
      campaignRules: [
        rule({ verdict: 'increase', consecutiveDays: 1, urgent: false }),
      ],
    } as GrowthProduct;
    expect(buildCampaignCard(custom, [row], []).verdict).toBe('increase');
    custom.campaignRules!.push(
      rule({
        id: 'urgent-ctr',
        name: 'CTR sudden drop',
        priority: 10,
        urgent: true,
        consecutiveDays: 1,
        conditions: [
          {
            metric: 'ctr',
            basis: 'previous_day_change',
            operator: 'lte',
            value: -30,
          },
        ],
      }),
    );
    const prior = {
      ...row,
      dataDate: previousDay(date),
      metrics: { ...row.metrics, ctr: 0.01 },
    };
    const card = buildCampaignCard(custom, [row, prior], []);
    expect(card.urgent).toBe(true);
    expect(card.evidence.join()).toContain('CTR sudden drop');
    const missingTarget = {
      ...row,
      metrics: { ...row.metrics, d0_roas: undefined },
    };
    const blocked = buildCampaignCard(custom, [missingTarget, prior], []);
    expect(blocked.urgent).toBe(true);
    expect(blocked.primaryAction.changePct).toBeUndefined();
    expect(blocked.blockers.join()).toContain('主目标指标未返回');
  });
  const file = join(tmpdir(), `campaign-rules-${randomUUID()}.sqlite`);
  const now = new Date();
  const day = previousDay(
    now.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }),
  );
  let db: LocalDatabaseService;
  let product: GrowthProduct;
  let campaigns: CampaignDecisionService;
  let management: CampaignBoardManagementService;
  const snapshot = (
    date: string,
    key = 'rules-fixture',
    d0 = 0.9,
  ): CampaignDailySnapshot => ({
    key,
    productId: product.id,
    campaignId: key,
    campaignName: key,
    accountId: 'test-account',
    countries: ['IN'],
    dataDate: date,
    fetchedAt: now.toISOString(),
    metrics: { spend: 50, adjust_installs: 500, d0_roas: d0, cpi: 0.1 },
    breakdowns: [],
    qualityIssues: [],
  });
  beforeAll(() => {
    process.env.GROWTH_DATABASE_PATH = file;
    process.env.MAVIS_MCP_TOKEN = 'test-fixture-token';
    db = new LocalDatabaseService();
    product = db.listProducts()[0];
    product.targetMetric = 'd0_roas';
    product.metrics = product.metrics.map((m) => ({
      ...m,
      lowerBound: m.key === 'd0_roas' ? 0.7 : undefined,
      upperBound: undefined,
    }));
    db.saveProduct(product);
    campaigns = new CampaignDecisionService(
      db,
      new GrowthDecisionService(db),
      new GrowthMavisAnalysisService(db),
    );
    management = new CampaignBoardManagementService(db, campaigns);
  });
  afterAll(() => {
    db.onModuleDestroy();
    delete process.env.GROWTH_DATABASE_PATH;
    delete process.env.MAVIS_MCP_TOKEN;
    for (const suffix of ['', '-wal', '-shm'])
      rmSync(file + suffix, { force: true });
  });

  it('validates rules and prevents invalid metrics, unsafe percentages and duplicate IDs', () => {
    expect(validateCampaignRules([rule()])[0].name).toBe('High return observe');
    expect(() => validateCampaignRules([rule(), rule()])).toThrow();
    expect(() => validateCampaignRules([rule({ priority: 101 })])).toThrow();
    expect(() => validateCampaignRules([rule({ changePct: 10 })])).toThrow();
    expect(() =>
      validateCampaignRules([rule({ verdict: 'increase', changePct: 31 })]),
    ).toThrow();
    expect(() =>
      validateCampaignRules([
        rule({
          conditions: [
            { metric: 'cpi', basis: 'value', operator: 'lte', value: NaN },
          ],
        }),
      ]),
    ).toThrow();
  });

  it('applies enabled rules by priority with AND conditions, retaining safety gates', () => {
    const history = [snapshot(day), snapshot(previousDay(day))];
    const configured = {
      ...product,
      campaignRules: [
        rule(),
        rule({ id: 'high', priority: 90, verdict: 'normal' }),
      ],
    };
    expect(buildCampaignCard(configured, history, [], now).verdict).toBe(
      'normal',
    );
    expect(
      buildCampaignCard(configured, history, [], now).matchedRule?.id,
    ).toBe('high');
    expect(
      buildCampaignCard(
        { ...product, campaignRules: [rule({ enabled: false })] },
        history,
        [],
        now,
      ).verdict,
    ).toBe('increase');
    const missing = rule({
      conditions: [
        ...rule().conditions,
        { metric: 'cpa', basis: 'value', operator: 'lte', value: 1 },
      ],
    });
    expect(
      matchCampaignRule([missing], history, campaignMetric),
    ).toBeUndefined();
    const bad = history.map((s) => ({
      ...s,
      metrics: { ...s.metrics, d0_roas: 0.2 },
    }));
    const unsafe = rule({
      verdict: 'increase',
      conditions: [
        { metric: 'spend', basis: 'value', operator: 'gte', value: 1 },
      ],
    });
    expect(
      buildCampaignCard({ ...product, campaignRules: [unsafe] }, bad, [], now)
        .verdict,
    ).toBe('observe');
    const low = history.map((s) => ({
      ...s,
      metrics: { ...s.metrics, spend: 1 },
    }));
    expect(
      buildCampaignCard(configured, low, [], now).matchedRule,
    ).toBeUndefined();
    expect(
      buildCampaignCard(
        {
          ...product,
          campaignRules: [rule({ verdict: 'increase', changePct: 25 })],
        },
        history,
        [],
        now,
      ).primaryAction.changePct,
    ).toBe(10);
  });

  it('uses exact previous-day percentage comparisons and rejects missing or zero baselines', () => {
    const changeRule = rule({
      consecutiveDays: 1,
      conditions: [
        {
          metric: 'spend',
          basis: 'previous_day_change',
          operator: 'gte',
          value: 20,
        },
      ],
    });
    const history = [
      snapshot(day),
      { ...snapshot(previousDay(day)), metrics: { spend: 25 } },
    ];
    expect(matchCampaignRule([changeRule], history, campaignMetric)?.id).toBe(
      changeRule.id,
    );
    expect(
      matchCampaignRule([changeRule], [history[0]], campaignMetric),
    ).toBeUndefined();
    expect(
      matchCampaignRule(
        [changeRule],
        [history[0], { ...history[1], metrics: { spend: 0 } }],
        campaignMetric,
      ),
    ).toBeUndefined();
    expect(
      matchCampaignRule(
        [changeRule],
        [
          history[0],
          { ...history[1], dataDate: previousDay(previousDay(day)) },
        ],
        campaignMetric,
      ),
    ).toBeUndefined();
  });

  it('evaluates normal rules on ended days even when today has no matured D0', () => {
    const today = now.toLocaleDateString('en-CA', {
      timeZone: 'Asia/Shanghai',
    });
    const intraday = {
      ...snapshot(today),
      metrics: { spend: 80, adjust_installs: 2000, cpi: 0.04 },
    };
    const configured = {
      ...product,
      campaignRules: [rule({ verdict: 'normal' })],
    };
    const history = [intraday, snapshot(day), snapshot(previousDay(day))];
    const card = buildCampaignCard(configured, history, [], now);
    expect(card.verdict).toBe('normal');
    expect(card.snapshot.dataDate).toBe(day);
    expect(card.previous?.dataDate).toBe(previousDay(day));
    expect(card.currentDaySnapshot).toEqual(intraday);
    expect(card.trend.some((s) => s.dataDate === today)).toBe(false);
    expect(card.revision).toBe(
      buildCampaignCard(configured, history.slice(1), [], now).revision,
    );
    expect(buildCampaignCard(configured, [intraday], [], now).verdict).toBe(
      'observe',
    );
  });

  it('does not bypass a failed ended day by selecting an older healthy snapshot', () => {
    const configured = {
      ...product,
      campaignRules: [rule({ verdict: 'normal' })],
    };
    const card = buildCampaignCard(
      configured,
      [
        { ...snapshot(day), qualityIssues: ['昨日数据未补齐'] },
        snapshot(previousDay(day)),
        snapshot(previousDay(previousDay(day))),
      ],
      [],
      now,
    );
    expect(card.snapshot.dataDate).toBe(day);
    expect(card.verdict).toBe('observe');
    expect(card.blockers).toContain('昨日数据未补齐');
  });

  it('persists product-specific rules, rejects stale edits, and changes decision revisions', () => {
    db.saveCampaignSnapshot(snapshot(day));
    db.saveCampaignSnapshot(snapshot(previousDay(day)));
    const before = campaigns.board(product.id).items[0];
    const config = management.rules(product.id);
    const saved = management.saveRules(product.id, {
      ...config,
      rules: [rule()],
    });
    expect(saved.board.items[0].verdict).toBe('observe');
    expect(saved.board.items[0].revision).not.toBe(before.revision);
    expect(management.rules(product.id)).toEqual({
      rules: saved.rules,
      revision: saved.revision,
    });
    expect(campaigns.board(product.id).items[0].verdict).toBe('observe');
    expect(campaigns.board(product.id).items[0].revision).not.toBe(
      before.revision,
    );
    expect(() =>
      management.saveRules(product.id, { ...config, rules: [] }),
    ).toThrow('已更新');
    const other = { ...product, id: randomUUID(), name: 'Other product' };
    db.saveProduct(other);
    expect(management.rules(other.id).rules).toEqual([]);
    management.saveRules(product.id, { ...saved, rules: [] });
    expect(campaigns.board(product.id).items[0].verdict).toBe('increase');
    const audit = db
      .listActivities(product.id)
      .filter((a) => a.action === 'campaign_rules_updated');
    expect(audit).toHaveLength(2);
    expect(
      audit.some(
        (a) =>
          a.metadata?.before === JSON.stringify(saved.rules) &&
          a.metadata?.after === '[]',
      ),
    ).toBe(true);
  });

  it('queues multiple campaigns in ONE batch and skips repeats, while reporting stale failures', async () => {
    for (const key of ['batch-a', 'batch-b']) {
      db.saveCampaignSnapshot(snapshot(day, key));
      db.saveCampaignSnapshot(snapshot(previousDay(day), key));
    }
    const cards = campaigns
      .board(product.id)
      .items.filter((c) => c.key.startsWith('batch-'));
    const request = {
      campaigns: cards.map((c) => ({ key: c.key, revision: c.revision })),
    };
    const initialJobs = db.listMavisJobs().length;
    const first = await management.analyzeBatch(product.id, {
      campaigns: [...request.campaigns, { key: 'absent', revision: 'stale' }],
    });
    expect(first.submitted).toBe(2);
    expect(first.failed).toHaveLength(1);
    const jobs = db.listMavisJobs();
    expect(jobs).toHaveLength(initialJobs + 1);
    expect(jobs[0].judgmentIds).toHaveLength(2);
    expect(jobs[0].jobType).toBe('batch_anomaly_assessment');
    const repeat = await management.analyzeBatch(product.id, request);
    expect(repeat.submitted).toBe(0);
    expect(repeat.skipped).toBe(2);
    expect(db.listMavisJobs()).toHaveLength(initialJobs + 1);
  });

  it('leaves failed enqueue attempts retryable instead of skipping them forever', async () => {
    db.saveCampaignSnapshot(snapshot(day, 'enqueue-retry'));
    db.saveCampaignSnapshot(snapshot(previousDay(day), 'enqueue-retry'));
    const card = campaigns
      .board(product.id)
      .items.find((c) => c.key === 'enqueue-retry')!;
    const request = { campaigns: [{ key: card.key, revision: card.revision }] };
    const saveJob = jest
      .spyOn(db, 'saveMavisJob')
      .mockImplementationOnce(() => {
        throw new Error('fixture enqueue failure');
      });
    try {
      const failed = await management.analyzeBatch(product.id, request);
      expect(failed.submitted).toBe(0);
      expect(failed.failed).toHaveLength(1);
      expect(
        campaigns.board(product.id).items.find((c) => c.key === card.key)
          ?.analysisStatus,
      ).toBe('failed');
      const retried = await management.analyzeBatch(product.id, request);
      expect(retried.submitted).toBe(1);
      expect(retried.skipped).toBe(0);
    } finally {
      saveJob.mockRestore();
    }
  });
});
