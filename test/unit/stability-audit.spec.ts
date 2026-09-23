import { DorisQueryGate } from '@server/modules/growth-decision/doris-query-gate';
import { GrowthDataFetchService } from '@server/modules/growth-decision/growth-data-fetch.service';
import { personalDataIdentity } from '@server/common/utils/personal-doris';
import { isCenterSessionError } from '@shared/center-session-error';

test('upstream authorization errors never log out the center session', () => {
  expect(
    isCenterSessionError(401, { error: { message: 'Meta 登录已失效' } }),
  ).toBe(false);
  expect(isCenterSessionError(401, { message: 'Meta 登录已失效' })).toBe(false);
  expect(isCenterSessionError(401, { message: '请重新登录' })).toBe(true);
  expect(
    isCenterSessionError(409, { message: '登录身份已变化，请刷新页面后重试' }),
  ).toBe(true);
});
test('Doris queue bounds waiting and gives another identity the next permit', async () => {
  const gate = new DorisQueryGate(2);
  const releases: (() => void)[] = [];
  const starts: string[] = [];
  const job = (scope: string) =>
    gate.run(async () => {
      starts.push(scope);
      await new Promise<void>((resolve) => releases.push(resolve));
    }, scope);
  const a = job('alice'),
    b = job('alice'),
    c = job('alice'),
    d = job('bob');
  await expect(job('carol')).rejects.toThrow('队列已满');
  await Promise.resolve();
  releases.shift()!();
  await a;
  await Promise.resolve();
  expect(starts).toEqual(['alice', 'alice', 'bob']);
  releases.splice(0).forEach((r) => r());
  await Promise.all([b, d]);
  releases.splice(0).forEach((r) => r());
  await c;
});
test('expired queued jobs never execute and do not leak permits', async () => {
  jest.useFakeTimers();
  try {
    const gate = new DorisQueryGate(2, 100);
    let release!: () => void;
    const blocked = new Promise<void>((r) => {
      release = r;
    });
    const a = gate.run(() => blocked),
      b = gate.run(() => blocked);
    const action = jest.fn();
    const rejected = expect(gate.run(action)).rejects.toThrow('排队超时');
    await jest.advanceTimersByTimeAsync(101);
    await rejected;
    release();
    await Promise.all([a, b]);
    expect(action).not.toHaveBeenCalled();
    await expect(gate.run(async () => 'ok')).resolves.toBe('ok');
  } finally {
    jest.useRealTimers();
  }
});
test('scheduled passes are single-flight and reset after failure', async () => {
  const service = new GrowthDataFetchService(
    {} as never,
    {} as never,
    {} as never,
  );
  const internals = service as unknown as {
    scheduledPersonalFetch(): Promise<unknown>;
    runScheduledPersonalFetch(): Promise<unknown>;
  };
  let release!: () => void;
  const mock = jest
    .spyOn(internals, 'runScheduledPersonalFetch')
    .mockImplementation(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
  const a = internals.scheduledPersonalFetch(),
    b = internals.scheduledPersonalFetch();
  expect(a).toBe(b);
  expect(mock).toHaveBeenCalledTimes(1);
  release();
  await a;
  mock.mockRejectedValueOnce(new Error('fixture'));
  await expect(internals.scheduledPersonalFetch()).rejects.toThrow('fixture');
  mock.mockResolvedValueOnce(undefined);
  await internals.scheduledPersonalFetch();
  expect(mock).toHaveBeenCalledTimes(3);
});
test('identical Doris reads merge only within the same personal scope and release on finish', async () => {
  const service = new GrowthDataFetchService(
    {} as never,
    {} as never,
    {} as never,
  );
  const internals = service as unknown as {
    executeQueryMetric(): Promise<{ rows: [] }>;
  };
  const releases: (() => void)[] = [];
  const mock = jest
    .spyOn(internals, 'executeQueryMetric')
    .mockImplementation(async () => {
      await new Promise<void>((r) => releases.push(r));
      return { rows: [] };
    });
  const read = (username: string) =>
    personalDataIdentity.run({ username, revision: 'test' }, () =>
      service.queryMetric({ dataset: 'fixture' }),
    );
  const a = read('alice'),
    b = read('alice'),
    c = read('bob');
  expect(mock).toHaveBeenCalledTimes(2);
  releases.splice(0).forEach((r) => r());
  await Promise.all([a, b, c]);
  mock.mockResolvedValueOnce({ rows: [] });
  await read('alice');
  expect(mock).toHaveBeenCalledTimes(3);
});
