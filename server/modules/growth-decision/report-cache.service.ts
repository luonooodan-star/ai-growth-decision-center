import { isKeyBehavior, KEY_BEHAVIOR_EVENT_MAP } from '@shared/behavior-table';
import { dorisWorkPriority } from './doris-query-gate';
import { Injectable } from '@nestjs/common';
import { LocalDatabaseService } from '@server/database/local-database.service';
import { personalScopeKey } from '../../common/utils/personal-doris';
export type ReportTask = {
  kind: 'roas' | 'behavior';
  date: string;
  platform: 'android' | 'ios';
  hourly: boolean;
  event?: string;
  version?: number;
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
    return t.kind === 'behavior'
      ? `${personalScopeKey()}:daily-report-slice:v2:${JSON.stringify([t.kind, t.date, t.platform, t.hourly, t.event])}`
      : `${personalScopeKey()}:daily-report-slice:v1:${JSON.stringify([t.kind, t.date, t.platform, t.hourly])}`;
  }
  tasks(): ReportTask[] {
    const raw = this.db.getBiCache(this.registryKey());
    if (!raw) return [];
    try {
      return (JSON.parse(raw).tasks || []).filter(
        (t: ReportTask) =>
          t.kind !== 'behavior' ||
          (t.version === 2 && (!t.hourly || isKeyBehavior(t.event))),
      );
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
  select(
    kind: ReportTask['kind'],
    start: string,
    end: string,
    platforms: ReportTask['platform'][],
  ) {
    this.write(
      this.tasks().filter(
        (t) =>
          t.kind !== kind ||
          (t.date >= start && t.date <= end && platforms.includes(t.platform)),
      ),
    );
  }
  isTracked(t: ReportTask) {
    return this.tasks().some((x) => this.key(x) === this.key(t));
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
    else if (dorisWorkPriority.getStore() !== 'background')
      tasks.push({ ...t, attempt, error });
    this.write(tasks);
  }
  read<T>(t: ReportTask): ReportCacheEntry<T> | undefined {
    let raw = this.db.getBiCache(this.key(t));
    // A successful old daily snapshot can be projected without querying Doris.
    // Old all-event hourly tasks are intentionally never replayed.
    if (!raw && t.kind === 'behavior' && !t.hourly) {
      const legacy = this.db.getBiCache(
        `${personalScopeKey()}:daily-report-slice:v1:${JSON.stringify([t.kind, t.date, t.platform, false])}`,
      );
      if (legacy)
        try {
          const old = JSON.parse(legacy);
          if (
            Array.isArray(old.data?.rows) &&
            old.data.rows.every(
              (r: { behaviors?: unknown }) => !!r.behaviors,
            ) &&
            Object.values(KEY_BEHAVIOR_EVENT_MAP).every(
              (names) => names.length <= 1,
            )
          ) {
            old.data.rows = old.data.rows.map(
              (row: { behaviors: Record<string, unknown> }) => ({
                ...row,
                behaviors: Object.fromEntries(
                  Object.entries(KEY_BEHAVIOR_EVENT_MAP)
                    .filter(
                      ([, names]) =>
                        names.length === 1 &&
                        row.behaviors[names[0]] !== undefined,
                    )
                    .map(([id, names]) => [id, row.behaviors[names[0]]]),
                ),
              }),
            );
            raw = JSON.stringify(old);
            this.db.saveBiCache(this.key(t), raw);
          }
        } catch {
          /* An incompatible legacy snapshot requires a scoped first load. */
        }
    }
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
