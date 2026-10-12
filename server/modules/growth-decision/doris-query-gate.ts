import { AsyncLocalStorage } from 'node:async_hooks';
export const dorisWorkPriority = new AsyncLocalStorage<'background'>();
/** Two total permits; background work may use at most one, behind interactive work. */
export class DorisQueryGate {
  private active = 0;
  private backgroundActive = 0;
  private lastInteractiveAt = 0;
  private readonly waiting: Array<{
    scope: string;
    background: boolean;
    resolve: () => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  private lastScope = '';
  constructor(
    private readonly maxWaiting = 128,
    private readonly waitMs = 60000,
  ) {}
  isInteractiveBusy() {
    return (
      this.active > this.backgroundActive ||
      this.waiting.some((item) => !item.background) ||
      Date.now() - this.lastInteractiveAt < 30000
    );
  }
  private dispatch() {
    while (this.active < 2 && this.waiting.length) {
      const interactive = this.waiting.filter((item) => !item.background);
      const eligible = interactive.length
        ? interactive
        : this.backgroundActive === 0
          ? this.waiting
          : [];
      const next =
        eligible.find((item) => item.scope !== this.lastScope) || eligible[0];
      if (!next) return;
      const item = this.waiting.splice(this.waiting.indexOf(next), 1)[0];
      clearTimeout(item.timer);
      this.lastScope = item.scope;
      this.active++;
      if (item.background) this.backgroundActive++;
      item.resolve();
    }
  }
  async run<T>(
    action: () => Promise<T>,
    scope = 'default',
    background = false,
  ): Promise<T> {
    if (!background) this.lastInteractiveAt = Date.now();
    if (
      background &&
      this.waiting.filter((item) => item.background).length >=
        Math.min(16, Math.max(1, Math.floor(this.maxWaiting / 2)))
    )
      throw new Error('后台 Doris 队列繁忙，保留检查点等待下一轮');
    if (this.waiting.length >= this.maxWaiting)
      throw new Error('Doris 查询队列已满，请稍后重试；保留已有缓存');
    await new Promise<void>((resolve, reject) => {
      const entry = {
        scope,
        background,
        resolve,
        timer: setTimeout(() => {
          const index = this.waiting.indexOf(entry);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(new Error('Doris 查询排队超时，请稍后重试；保留已有缓存'));
        }, this.waitMs),
      };
      this.waiting.push(entry);
      this.dispatch();
    });
    try {
      return await action();
    } finally {
      this.active--;
      if (background) this.backgroundActive--;
      else this.lastInteractiveAt = Date.now();
      this.dispatch();
    }
  }
}
