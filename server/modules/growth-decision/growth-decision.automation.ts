import { Logger } from '@nestjs/common';
import { Automation, BindTrigger } from '@lark-apaas/fullstack-nestjs-core';

import { GrowthDecisionService } from './growth-decision.service';

@Automation()
export class GrowthDecisionAutomation {
  private readonly logger = new Logger(GrowthDecisionAutomation.name);

  constructor(private readonly growthDecisionService: GrowthDecisionService) {}

  @BindTrigger('hourlyGrowthScan')
  async hourlyGrowthScan(): Promise<void> {
    const result: Record<string, number> =
      await this.growthDecisionService.getHourlyMaintenanceStatus();
    this.logger.log(`每小时增长扫描完成: ${JSON.stringify(result)}`);
  }

  @BindTrigger('weeklyGrowthReview')
  async weeklyGrowthReview(): Promise<void> {
    const result: Record<string, number> =
      await this.growthDecisionService.getWeeklyReviewMetrics();
    this.logger.log(`每周增长复盘完成: ${JSON.stringify(result)}`);
  }
}
