import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CampaignBatchAnalysisRequest,
  CampaignBatchAnalysisResult,
  CampaignRulesConfig,
  GrowthProduct,
  GrowthJudgment,
} from '@shared/api.interface';
import { LocalDatabaseService } from '@server/database/local-database.service';
import { CampaignDecisionService } from './campaign-decision.service';
import { campaignHash } from './campaign-snapshots';
import { validateCampaignRules } from './campaign-rules';

@Injectable()
export class CampaignBoardManagementService {
  constructor(
    private readonly database: LocalDatabaseService,
    private readonly campaigns: CampaignDecisionService,
  ) {}

  private product(id: string): GrowthProduct {
    const product = this.database.getProduct(id);
    if (!product) throw new NotFoundException('产品不存在');
    return product;
  }

  rules(productId: string): CampaignRulesConfig {
    const rules = this.product(productId).campaignRules || [];
    return { rules, revision: campaignHash(rules) };
  }

  saveRules(
    productId: string,
    request: CampaignRulesConfig,
  ): CampaignRulesConfig {
    const current = this.rules(productId);
    if (!request || request.revision !== current.revision)
      throw new ConflictException('规则已更新，请关闭后重新打开规则面板');
    const rules = validateCampaignRules(request.rules);
    this.database.saveProduct({
      ...this.product(productId),
      campaignRules: rules,
    });
    this.database.appendActivity({
      caseId: productId,
      action: 'campaign_rules_updated',
      actor: 'growth',
      detail: `系列判断规则已保存，共 ${rules.length} 条（含停用）`,
      metadata: {
        before: JSON.stringify(current.rules),
        after: JSON.stringify(rules),
      },
    });
    return this.rules(productId);
  }

  async analyzeBatch(
    productId: string,
    request: CampaignBatchAnalysisRequest,
  ): Promise<CampaignBatchAnalysisResult> {
    const product = this.product(productId);
    if (
      !request ||
      !Array.isArray(request.campaigns) ||
      request.campaigns.length > 20 ||
      request.campaigns.some(
        (c) =>
          !c ||
          typeof c.key !== 'string' ||
          typeof c.revision !== 'string' ||
          c.key.length > 100 ||
          c.revision.length > 100,
      )
    ) {
      throw new BadRequestException('每批最多分析 20 个系列，必须携带数据版本');
    }
    const result: CampaignBatchAnalysisResult = {
      submitted: 0,
      skipped: 0,
      failed: [],
    };
    const seen = new Set<string>();
    const prepared: GrowthJudgment[] = [];
    for (const item of request.campaigns) {
      if (seen.has(item.key)) {
        result.skipped++;
        continue;
      }
      seen.add(item.key);
      try {
        const card = this.campaigns
          .board(productId)
          .items.find((c) => c.key === item.key);
        if (!card || card.revision !== item.revision)
          throw new ConflictException('数据或规则已更新，请刷新');
        if (card.analysisId && card.analysisStatus !== 'failed') {
          result.skipped++;
          continue;
        }
        prepared.push(
          await this.campaigns.analyze(
            productId,
            item.key,
            item.revision,
            true,
          ),
        );
        result.submitted++;
      } catch (error: unknown) {
        result.failed.push({
          key: item.key,
          message: error instanceof Error ? error.message : '任务提交失败',
        });
      }
    }
    if (prepared.length) {
      try {
        this.database.saveMavisJob({
          id: randomUUID(),
          judgmentId: prepared[0].id,
          judgmentIds: prepared.map((j) => j.id),
          productId,
          productName: product.name,
          jobType: 'batch_anomaly_assessment',
          trigger: 'manual',
          status: 'queued',
          skillVersion: product.skillVersion,
          attempt: 0,
          createdAt: new Date().toISOString(),
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : '批量任务入队失败';
        for (const judgment of prepared) {
          this.database.saveDecisionRecord({
            ...judgment,
            aiAnalysisStatus: 'failed',
          });
          result.failed.push({ key: judgment.campaignReview!.key, message });
        }
        result.submitted = 0;
        return result;
      }
      for (const judgment of prepared)
        this.database.saveDecisionRecord({
          ...judgment,
          aiAnalysisStatus: 'running',
        });
    }
    return result;
  }
}
