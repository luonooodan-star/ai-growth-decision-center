/** Share two permits across scheduled, manual and diagnostic reads. */
export class DorisQueryGate {
  private active = 0;
  private readonly waiting: Array<{
    scope: string;
    resolve: () => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  private lastScope = '';
  constructor(
    private readonly maxWaiting = 128,
    private readonly waitMs = 60000,
  ) {}
  private dispatch() {
    while (this.active < 2 && this.waiting.length) {
      const other = this.waiting.findIndex(
        (item) => item.scope !== this.lastScope,
      );
      const item = this.waiting.splice(other < 0 ? 0 : other, 1)[0];
      clearTimeout(item.timer);
      this.lastScope = item.scope;
      this.active++;
      item.resolve();
    }
  }
  async run<T>(action: () => Promise<T>, scope = 'default'): Promise<T> {
    if (this.waiting.length >= this.maxWaiting)
      throw new Error('Doris 查询队列已满，请稍后重试；保留已有缓存');
    await new Promise<void>((resolve, reject) => {
      const entry = {
        scope,
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
      this.dispatch();
    }
  }
}
