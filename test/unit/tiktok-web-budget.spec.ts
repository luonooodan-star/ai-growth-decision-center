// Exercise controller logic without installing Nest HTTP route metadata in Jest.
jest.mock('@nestjs/common', () => ({
  ...jest.requireActual('@nestjs/common'),
  Get: () => () => undefined,
  Post: () => () => undefined,
  Controller: () => () => undefined,
}));
import { parseBudgetCard } from '../../server/modules/growth-decision/tiktok-web-budget';
import { TikTokBalanceController } from '../../server/modules/growth-decision/tiktok-balance.controller';
import * as web from '../../server/modules/growth-decision/tiktok-web-budget';
import { centerIdentity } from '../../server/common/utils/center-identity';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const account = '7708966031700033557';
const card =
  'Activity Your One-time budget is 3,000.00 USD. Spent 1,369.98 USD Remaining 1,630.02 USD';
test('reads a single labelled budget card and preserves zero', () => {
  expect(parseBudgetCard(card)).toEqual({
    period: '单次',
    total: '3000.00',
    spent: '1369.98',
    remaining: '1630.02',
    currency: 'USD',
  });
  expect(
    parseBudgetCard(
      '你的单次预算为 100.00 USD。 已花费预算 100.00 USD 剩余预算 0.00 USD',
    )?.remaining,
  ).toBe('0.00');
  expect(
    parseBudgetCard(card.replace('1,630.02 USD', '1,630.02 EUR')),
  ).toBeUndefined();
  expect(parseBudgetCard(card + ' ' + card)).toBeUndefined();
});

test('limits automatic web reads across service restarts, refreshes manually and timestamps stale results', async () => {
  const root = mkdtempSync(join(tmpdir(), 'budget-spec-'));
  const token = process.env.TIKTOK_ACCESS_TOKEN;
  delete process.env.TIKTOK_ACCESS_TOKEN;
  const dir = join(root, 'runtime/tiktok');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'web-budget-accounts.json'),
    JSON.stringify([account]),
  );
  const budget = {
    ...parseBudgetCard(card)!,
    updatedAt: '2026-11-23T01:00:00.000Z',
  };
  try {
    jest.spyOn(process, 'cwd').mockReturnValue(root);
    let now = Date.parse(budget.updatedAt);
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const collect = jest
      .spyOn(web, 'collectWebBudgets')
      .mockResolvedValue(new Map([[account, { budget }]]));
    await centerIdentity.run('growth', async () => {
      const c = new TikTokBalanceController();
      expect((await c.balances()).rows?.[0].webBudget).toEqual(budget);
      await new TikTokBalanceController().balances();
      expect(collect).toHaveBeenCalledTimes(1);
      collect.mockResolvedValue(new Map([[account, { error: '登录已过期' }]]));
      expect((await c.refresh()).rows?.[0]).toMatchObject({
        webBudget: budget,
        webBudgetError: '登录已过期',
      });
      await c.balances();
      expect(collect).toHaveBeenCalledTimes(2);
      now += 12 * 3600000;
      await Promise.all([c.balances(), c.balances()]);
      expect(collect).toHaveBeenCalledTimes(3);
    });
  } finally {
    jest.restoreAllMocks();
    if (token !== undefined) process.env.TIKTOK_ACCESS_TOKEN = token;
    rmSync(root, { recursive: true, force: true });
  }
});

test('selects current Sinox advertiser names across BCs plus explicit IDs exactly once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'budget-targets-'));
  const token = process.env.TIKTOK_ACCESS_TOKEN;
  process.env.TIKTOK_ACCESS_TOKEN = 'fixture';
  try {
    jest.spyOn(process, 'cwd').mockReturnValue(root);
    jest.spyOn(web, 'webBudgetAccounts').mockResolvedValue(['1', '9']);
    const collect = jest
      .spyOn(web, 'collectWebBudgets')
      .mockResolvedValue(new Map());
    let newName = 'other';
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      const accounts = [
        'Sinox-A',
        '  SINOX-B',
        'BFI-SINOX',
        'unrelated',
        newName,
      ].map((asset_name, i) => ({
        asset_id: String(i + 1),
        asset_name,
        owner_bc_name: 'SINOX OWNER',
      }));
      const data = path.endsWith('/bc/get/')
        ? {
            list: [
              { bc_info: { bc_id: '111' } },
              { bc_info: { bc_id: '222' } },
            ],
          }
        : path.endsWith('/bc/asset/get/')
          ? { list: accounts }
          : {
              advertiser_account_list: accounts.map((a) => ({
                advertiser_id: a.asset_id,
                valid_account_balance: 10,
              })),
            };
      return Response.json({ code: 0, data });
    });
    await centerIdentity.run('growth', async () => {
      const c = new TikTokBalanceController();
      await c.balances();
      expect(collect.mock.calls[0][1]).toEqual(['1', '9', '2']);
      newName = 'sinox-new';
      await c.refresh();
      expect(collect.mock.calls[1][1]).toEqual(['1', '9', '2', '5']);
    });
  } finally {
    jest.restoreAllMocks();
    if (token === undefined) delete process.env.TIKTOK_ACCESS_TOKEN;
    else process.env.TIKTOK_ACCESS_TOKEN = token;
    rmSync(root, { recursive: true, force: true });
  }
});
