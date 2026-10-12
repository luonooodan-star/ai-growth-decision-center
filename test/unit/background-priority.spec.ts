import {
  DorisQueryGate,
  dorisWorkPriority,
} from '@server/modules/growth-decision/doris-query-gate';
import {
  GrowthDataFetchService,
  productSyncDue,
} from '@server/modules/growth-decision/growth-data-fetch.service';

test('background uses one permit, leaves capacity for interactive queries and preserves priority', async () => {
  const gate = new DorisQueryGate();
  const starts: string[] = [];
  const releases = new Map<string, () => void>();
  const run = (id: string, background: boolean) =>
    gate.run(
      async () => {
        starts.push(id);
        await new Promise<void>((r) => releases.set(id, r));
      },
      id,
      background,
    );
  const b1 = run('b1', true),
    b2 = run('b2', true),
    f1 = run('f1', false),
    f2 = run('f2', false);
  await Promise.resolve();
  expect(starts).toEqual(['b1', 'f1']);
  releases.get('b1')!();
  await b1;
  await Promise.resolve();
  expect(starts).toEqual(['b1', 'f1', 'f2']);
  releases.get('f1')!();
  await f1;
  await Promise.resolve();
  expect(starts).toEqual(['b1', 'f1', 'f2', 'b2']);
  releases.get('f2')!();
  releases.get('b2')!();
  await Promise.all([f2, b2]);
});
test('fresh and inactive products are not resynced after restart', () => {
  const now = Date.now();
  expect(
    productSyncDue(
      { status: 'active', lastSyncAt: new Date(now - 60000).toISOString() },
      now,
    ),
  ).toBe(false);
  expect(
    productSyncDue(
      { status: 'active', lastSyncAt: new Date(now - 3600000).toISOString() },
      now,
    ),
  ).toBe(true);
  expect(productSyncDue({ status: 'active' }, now)).toBe(true);
  expect(productSyncDue({ status: 'active', lastSyncAt: 'invalid' }, now)).toBe(
    true,
  );
  expect(productSyncDue({ status: 'paused' } as never, now)).toBe(false);
});
test('restart schedules no sync in first minute, then checks at five minutes', async () => {
  jest.useFakeTimers();
  const service = new GrowthDataFetchService(
    { listFetchRuns: () => [], pruneFetchCheckpoints: () => {} } as never,
    {} as never,
    {} as never,
  );
  const internal = service as unknown as {
    scheduledPersonalFetch(): Promise<unknown>;
    fetchDueObservations(): Promise<void>;
  };
  const sync = jest
    .spyOn(internal, 'scheduledPersonalFetch')
    .mockResolvedValue(undefined);
  jest.spyOn(internal, 'fetchDueObservations').mockResolvedValue(undefined);
  try {
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(60001);
    expect(sync).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(240000);
    expect(sync).toHaveBeenCalledTimes(1);
  } finally {
    service.onModuleDestroy();
    jest.useRealTimers();
  }
});
test('scheduled fetch inherits background context, manual query does not', async () => {
  const service = new GrowthDataFetchService(
    { pruneFetchCheckpoints: () => {} } as never,
    {} as never,
    {} as never,
  );
  const internal = service as unknown as { runProducts(): Promise<never[]> };
  const priorities: unknown[] = [];
  jest.spyOn(internal, 'runProducts').mockImplementation(async () => {
    priorities.push(dorisWorkPriority.getStore());
    return [];
  });
  await service.trigger('scheduled');
  await service.trigger('manual');
  expect(priorities).toEqual(['background', undefined]);
});
