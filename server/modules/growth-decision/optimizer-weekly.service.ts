import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { LocalDatabaseService } from '@server/database/local-database.service';
import { OptimizerWorkflowService } from './optimizer-workflow.service';
import {
  configuredDorisUsers,
  runPersonalData,
} from '../../common/utils/personal-doris';

export function reviewWeek(now = new Date()): string {
  const local = new Date(now.getTime() + 8 * 3600000);
  const day = (local.getUTCDay() + 6) % 7;
  local.setUTCDate(local.getUTCDate() - day);
  local.setUTCHours(10, 0, 0, 0);
  if (local.getTime() - 8 * 3600000 > now.getTime())
    local.setUTCDate(local.getUTCDate() - 7);
  return local.toISOString().slice(0, 10);
}

@Injectable()
export class OptimizerWeeklyService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(OptimizerWeeklyService.name);
  constructor(
    private readonly db: LocalDatabaseService,
    private readonly workflow: OptimizerWorkflowService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => this.tick(), 30 * 60000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  tick() {
    if (process.env.GROWTH_PERSONAL_DATA === '1') {
      for (const username of configuredDorisUsers())
        runPersonalData(username, () => this.tickCurrentUser());
      return;
    }
    this.tickCurrentUser();
  }
  private tickCurrentUser() {
    for (const product of this.db
      .listProducts()
      .filter((p) => p.weeklyReviewEnabled)) {
      try {
        this.generate(product.id, false);
      } catch (e) {
        this.logger.error(
          e instanceof Error ? e.stack || e.message : String(e),
        );
      }
    }
  }
  state(productId: string) {
    const product = this.db.getProduct(productId);
    if (!product) throw new NotFoundException('产品不存在');
    return {
      enabled: !!product.weeklyReviewEnabled,
      reports: this.db
        .listActivities(productId, 10000)
        .filter((a) => a.action === 'optimizer_weekly_report')
        .slice(0, 12)
        .map((a) => ({
          id: a.id,
          createdAt: a.createdAt,
          week: a.metadata.week,
          summary: a.detail,
        })),
    };
  }
  configure(productId: string, enabled: boolean) {
    const product = this.db.getProduct(productId);
    if (!product) throw new NotFoundException('产品不存在');
    if (typeof enabled !== 'boolean')
      throw new BadRequestException('请指定周复盘开关');
    this.db.saveProduct({ ...product, weeklyReviewEnabled: enabled });
    this.db.appendActivity({
      caseId: productId,
      action: 'optimizer_weekly_configured',
      actor: 'growth',
      detail: enabled
        ? '启用周一 10:00 复盘（上海时区，半小时检查）'
        : '暂停自动周复盘',
      metadata: {},
    });
    return this.state(productId);
  }
  generate(productId: string, manual = true) {
    const state = this.state(productId),
      week = reviewWeek();
    if (state.reports.some((r) => r.week === week)) return state;
    if (!manual && !state.enabled) return state;
    const review = this.workflow.review(productId);
    const summary = `最近 7 天：实际执行 ${review.executed}/${review.accepted}，完成复查 ${review.completedReviews}；当前待执行 ${review.pending}、到期复查 ${review.due}、数据待修复 ${review.repair}。已结束 ${review.results.length} 条记录；前后改善不证明因果，需核对自然恢复、回补及同期变更。`;
    this.db.appendActivity({
      caseId: productId,
      action: 'optimizer_weekly_report',
      actor: manual ? 'growth' : 'weekly_review',
      detail: summary,
      metadata: {
        week,
        from: review.from,
        to: review.to,
        sourceIds: JSON.stringify(review.results.map((r) => r.id)),
        results: JSON.stringify(review),
      },
    });
    return this.state(productId);
  }
}
