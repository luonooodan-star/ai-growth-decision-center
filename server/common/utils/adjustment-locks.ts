/** Single company-server process: allow independent campaigns in parallel,
 * protect the entire campaign hierarchy from cross-user concurrent writes. */
export class AdjustmentLocks {
  private readonly jobs = new Map<string, Set<string>>();
  acquire(jobId: string, campaigns: string[]): () => void {
    if (this.jobs.size >= 4)
      throw new Error('已有 4 个调整任务执行中，请稍后提交');
    const keys = new Set(campaigns);
    for (const held of this.jobs.values())
      for (const key of keys)
        if (held.has(key))
          throw new Error('该广告系列正在由其他任务调整，请完成后重新预检');
    this.jobs.set(jobId, keys);
    return () => {
      this.jobs.delete(jobId);
    };
  }
}
