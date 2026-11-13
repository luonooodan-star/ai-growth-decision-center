import { Injectable } from '@nestjs/common';
import { LocalDatabaseService } from '@server/database/local-database.service';
import { personalScopeKey } from '../../common/utils/personal-doris';
export type ReportTask = {
  kind: 'roas' | 'behavior';
  date: string;
  platform: 'android' | 'ios';
  hourly: boolean;
  attempt?: string;
  error?: string;
};
export function reportCycle(now = new Date()): string {
  const local = new Date(now.getTime() + 8 * 3600000);
  if (local.getUTCHours() < 10) local.setUTCDate(local.getUTCDate() - 1);
  return local.toISOString().slice(0, 10);
}
export interface ReportCacheEntry<T> {
  data: T;
  updatedAt: string;
}
@Injectable()
export class ReportCacheService {
  constructor(private readonly db: LocalDatabaseService) {}
  private registryKey() {
    return `${personalScopeKey()}:daily-report-registry:v1`;
  }
  private key(t: ReportTask) {
    return `${personalScopeKey()}:daily-report-slice:v1:${JSON.stringify([t.kind, t.date, t.platform, t.hourly])}`;
  }
  tasks(): ReportTask[] {
    const raw = this.db.getBiCache(this.registryKey());
    if (!raw) return [];
    try {
      return JSON.parse(raw).tasks || [];
    } catch {
      return [];
    }
  }
  private write(tasks: ReportTask[]) {
    const oldest = new Date(Date.now() - 89 * 86400000)
      .toISOString()
      .slice(0, 10);
    this.db.saveBiCache(
      this.registryKey(),
      JSON.stringify({
        tasks: tasks.filter((t) => t.date >= oldest),
        updatedAt: new Date().toISOString(),
      }),
    );
  }
  track(t: ReportTask, scheduled = false) {
    const tasks = this.tasks();
    if (!tasks.some((x) => this.key(x) === this.key(t))) {
      tasks.push({ ...t, attempt: scheduled ? '' : reportCycle() });
      this.write(tasks);
    }
  }
  mark(t: ReportTask, attempt: string, error?: string) {
    const tasks = this.tasks();
    const index = tasks.findIndex((x) => this.key(x) === this.key(t));
    if (index >= 0) tasks[index] = { ...tasks[index], attempt, error };
    else tasks.push({ ...t, attempt, error });
    this.write(tasks);
  }
  read<T>(t: ReportTask): ReportCacheEntry<T> | undefined {
    const raw = this.db.getBiCache(this.key(t));
    if (!raw) return;
    try {
      const entry = JSON.parse(raw);
      if (entry.data !== undefined && entry.updatedAt) return entry;
    } catch {
      /* corrupt entries are a cache miss */
    }
  }
  save<T>(t: ReportTask, data: T) {
    this.db.saveBiCache(
      this.key(t),
      JSON.stringify({ data, updatedAt: new Date().toISOString() }),
    );
    this.mark(t, reportCycle());
  }
  error(t: ReportTask) {
    return this.tasks().find((x) => this.key(x) === this.key(t))?.error;
  }
}
