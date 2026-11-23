jest.mock('@nestjs/common', () => ({
  ...jest.requireActual('@nestjs/common'),
  Get: () => () => undefined,
  Post: () => () => undefined,
  Header: () => () => undefined,
  Controller: () => () => undefined,
}));
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FacebookBalanceController } from '../../server/modules/growth-decision/facebook-balance.controller';
import type { MetaAdjustmentService } from '../../server/modules/growth-decision/meta-adjustment.service';
import { centerIdentity } from '../../server/common/utils/center-identity';
import { readFacebookBalancePage } from '../../shared/meta-adjustment';

test('keeps accessible accounts and distinguishes missing amounts from zero', async () => {
  const page = await readFacebookBalancePage(
    async (path, { fields, after }) => {
      expect(path).toBe('me/adaccounts');
      expect(after).toBe('cursor');
      if (fields.includes('spend_cap')) throw new Error('#200 permission');
      return {
        data: [
          {
            account_id: '123',
            name: 'Ad',
            currency: 'USD',
            balance: '0',
            amount_spent: '12345',
          },
        ],
        paging: { next: 'private-url', cursors: { after: 'next' } },
      };
    },
    'cursor',
  );
  expect(page).toEqual({
    rows: [
      {
        id: '123',
        name: 'Ad',
        currency: 'USD',
        balance: '0',
        spend_cap: null,
        amount_spent: '12345',
      },
    ],
    next: 'next',
  });
});

test('paginates by personal identity, persists half-day slots and allows manual refresh', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fb-balances-'));
  try {
    jest.spyOn(process, 'cwd').mockReturnValue(root);
    let now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    mkdirSync(join(root, 'runtime'));
    const file = join(root, 'runtime/meta-local-bridge.json.users');
    writeFileSync(
      file,
      JSON.stringify({
        sessions: {
          alice: { until: now + 7 * 86400000 },
          bob: { until: now + 7 * 86400000 },
        },
      }),
      { mode: 0o600 },
    );
    const billingPage = jest.fn(async (after?: string, owner?: string) => {
      const user = centerIdentity.getStore();
      expect(owner).toBe(after ? user : undefined);
      return {
        ownerId: user,
        rows: [{ id: user + (after || '1') }],
        next: after ? null : '2',
      };
    });
    const make = () =>
      new FacebookBalanceController({
        billingPage,
      } as unknown as MetaAdjustmentService);
    const controller = make();
    await centerIdentity.run('alice', async () => {
      const [first] = await Promise.all([controller.list(), controller.list()]);
      expect(first.rows.map((r) => r.id)).toEqual(['alice1', 'alice2']);
      await make().list();
      expect(billingPage).toHaveBeenCalledTimes(2);
      await controller.refresh();
      expect(billingPage).toHaveBeenCalledTimes(4);
      now += 12 * 3600000;
      await controller.list();
      expect(billingPage).toHaveBeenCalledTimes(6);
    });
    expect(
      (await centerIdentity.run('bob', () => controller.list())).rows[0].id,
    ).toBe('bob1');
    writeFileSync(file, JSON.stringify({ sessions: {} }));
    await expect(
      centerIdentity.run('alice', () => controller.list()),
    ).rejects.toThrow('绑定');
  } finally {
    jest.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  }
});
