import { AdjustmentLocks } from '@server/common/utils/adjustment-locks';
import { createMetaDisplayReader } from '@shared/meta-adjustment';

test('independent campaigns run concurrently while shared hierarchy is locked', () => {
  const locks = new AdjustmentLocks();
  const release = locks.acquire('alice-job', ['acc:campaign']);
  expect(() => locks.acquire('bob-job', ['acc:campaign'])).toThrow('其他任务');
  const releaseB = locks.acquire('bob-job', ['acc:other']);
  release();
  const releaseC = locks.acquire('carol-job', ['acc:campaign']);
  releaseB();
  releaseC();
});
test('execution concurrency is capped at four jobs', () => {
  const locks = new AdjustmentLocks();
  const releases = Array.from({ length: 4 }, (_, i) =>
    locks.acquire(String(i), [String(i)]),
  );
  expect(() => locks.acquire('fifth', ['fifth'])).toThrow('4 个');
  releases[0]();
  expect(() => locks.acquire('fifth', ['fifth'])).not.toThrow();
});
test('one user cannot occupy all display slots; three users can read in parallel', async () => {
  const reader = createMetaDisplayReader();
  const started: string[] = [];
  const releases: (() => void)[] = [];
  const graph = async (id: string) => {
    started.push(id);
    await new Promise<void>((resolve) => releases.push(resolve));
    return {};
  };
  const tasks = ['a', 'a', 'a', 'a', 'b', 'b', 'c', 'c'].map((scope, i) =>
    reader.read(scope, graph, `${scope}-${i}`, {}),
  );
  await new Promise((resolve) => setImmediate(resolve));
  expect(started).toEqual(['a-0', 'a-1', 'b-4', 'b-5', 'c-6', 'c-7']);
  releases.splice(0).forEach((release) => release());
  await new Promise((resolve) => setImmediate(resolve));
  releases.splice(0).forEach((release) => release());
  await Promise.all(tasks);
  expect(started).toHaveLength(8);
});
