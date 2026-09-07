/** Share two permits across scheduled, manual and diagnostic reads. */
export class DorisQueryGate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  async run<T>(action: () => Promise<T>): Promise<T> {
    if (this.active < 2) this.active++;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      return await action();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
