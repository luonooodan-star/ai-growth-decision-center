import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  ReportCacheService,
  reportCycle,
  type ReportTask,
} from './report-cache.service';
import { CreativeAnalysisService } from './creative-analysis.service';
import { RoasReportService } from './roas-report.service';
import {
  configuredDorisUsers,
  runPersonalData,
} from '../../common/utils/personal-doris';
import { GrowthDataFetchService } from './growth-data-fetch.service';
import { dorisWorkPriority } from './doris-query-gate';
@Injectable()
export class ReportScheduleService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(ReportScheduleService.name);
  constructor(
    private readonly cache: ReportCacheService,
    private readonly analysis: CreativeAnalysisService,
    private readonly roas: RoasReportService,
    private readonly fetcher: GrowthDataFetchService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick().catch(() =>
        this.logger.warn('报表每日调度检查失败，保留缓存'),
      );
    }, 60000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async tick(now = new Date()) {
    // Persisted cycle markers prevent repeated refreshes after restart. No startup stampede.
    const local = new Date(now.getTime() + 8 * 3600000);
    if (
      this.running ||
      local.getUTCHours() < 10 ||
      this.fetcher.reportBackgroundBusy() ||
      this.analysis.isBusy()
    )
      return;
    this.running = true;
    try {
      for (const username of configuredDorisUsers()) {
        if (this.fetcher.reportBackgroundBusy() || this.analysis.isBusy())
          break;
        await runPersonalData(username, () =>
          dorisWorkPriority.run('background', async () => {
            const tasks = this.cache.tasks();
            if (!tasks.length) return;
            const due = this.cache
              .tasks()
              .filter((t) => t.attempt !== reportCycle(now))
              .sort((a, b) => b.date.localeCompare(a.date));
            for (const task of due) {
              if (!this.cache.isTracked(task)) continue;
              if (this.fetcher.reportBackgroundBusy() || this.analysis.isBusy())
                break;
              this.cache.mark(task, reportCycle(now));
              try {
                await this.refresh(task);
              } catch (e) {
                this.cache.mark(
                  task,
                  reportCycle(now),
                  e instanceof Error ? e.message : '更新失败',
                );
                this.logger.warn(
                  '每日报表更新失败，保留上次成功缓存；可手动重试',
                );
              }
            }
          }),
        );
      }
    } finally {
      this.running = false;
    }
  }
  private async refresh(t: ReportTask) {
    const q = {
      start: t.date,
      end: t.date,
      platform: t.platform,
      refresh: true,
      behaviorDetail: t.kind === 'behavior',
      hourly: t.hourly,
    };
    if (t.kind === 'roas') {
      await this.roas.query(q);
      return;
    }
    const previous = this.cache.read(t)?.updatedAt;
    let job = this.analysis.start(q);
    while (job.state === 'running') {
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      job = this.analysis.status(job.id);
    }
    if (
      job.state !== 'completed' ||
      !this.cache.read(t) ||
      this.cache.read(t)?.updatedAt === previous
    )
      throw new Error(job.error || '行为报表未完整更新');
  }
}
