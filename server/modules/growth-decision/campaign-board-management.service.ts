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
  CampaignRulesSaveResult,
  GrowthProduct,
  GrowthJudgment,
} from '@shared/api.interface';
import { LocalDatabaseService } from '@server/database/local-database.service';
import { CampaignDecisionService } from './campaign-decision.service';
import { campaignHash } from './campaign-snapshots';
import { validateCampaignRules } from './campaign-rules';
import { previewRules } from './campaign-rule-preview';

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

  viewed(productId: string, request: { key: string; revision: string }) {
    const card = this.campaigns
      .board(productId)
      .items.find(
        (c) => c.key === request?.key && c.revision === request?.revision,
      );
    if (!card) throw new ConflictException('卡片版本已变更，请刷新');
    const exists = this.database
      .listActivities(productId, 10000)
      .some(
        (a) =>
          a.action === 'optimizer_viewed' &&
          a.metadata.key === card.key &&
          a.metadata.revision === card.revision,
      );
    if (!exists)
      this.database.appendActivity({
        caseId: productId,
        action: 'optimizer_viewed',
        actor: 'growth',
        detail: '首次查看该版本系列详情',
        metadata: { key: card.key, revision: card.revision },
      });
    return { ok: true };
  }

  preview(productId: string, request: CampaignRulesConfig) {
    if (!request || request.revision !== this.rules(productId).revision)
      throw new ConflictException('规则已更新，请重新打开规则面板');
    return previewRules(
      this.product(productId),
      validateCampaignRules(request.rules),
      this.database.listCampaignSnapshots(productId),
    );
  }

  versions(productId: string) {
    this.product(productId);
    return this.database
      .listActivities(productId, 1000)
      .filter((a) => a.action === 'campaign_rules_updated')
      .map((a) => ({
        id: a.id,
        createdAt: a.createdAt,
        rules: JSON.parse(a.metadata.before || '[]'),
      }));
  }

  async observeBatch(
    productId: string,
    request: CampaignBatchAnalysisRequest & {
      reason: string;
      confirmation: string;
    },
  ) {
    if (
      !request ||
      request.confirmation !== 'OBSERVE_BATCH' ||
      typeof request.reason !== 'string' ||
      !request.reason.trim() ||
      request.reason.length > 2000 ||
      !Array.isArray(request.campaigns) ||
      request.campaigns.length > 20
    )
      throw new BadRequestException('请确认最多 20 个观察对象并填写原因');
    const result: CampaignBatchAnalysisResult = {
      submitted: 0,
      skipped: 0,
      failed: [],
    };
    const seen = new Set<string>();
    for (const item of request.campaigns) {
      try {
        if (
          !item ||
          typeof item.key !== 'string' ||
          typeof item.revision !== 'string'
        )
          throw new BadRequestException('系列参数无效');
        if (seen.has(item.key)) {
          result.skipped++;
          continue;
        }
        seen.add(item.key);
        const card = this.campaigns
          .board(productId)
          .items.find((c) => c.key === item.key);
        if (
          !card ||
          card.revision !== item.revision ||
          card.workQueue !== 'observation' ||
          card.urgent
        )
          throw new BadRequestException(
            '仅允许批量确认低风险观察候选，请刷新或单独处理',
          );
        await this.campaigns.decide(productId, {
          ...item,
          decision: 'observe',
          reason: request.reason,
        });
        result.submitted++;
      } catch (e) {
        result.failed.push({
          key: item?.key || 'unknown',
          message: e instanceof Error ? e.message : '观察失败',
        });
      }
    }
    return result;
  }

  saveRules(
    productId: string,
    request: CampaignRulesConfig,
  ): CampaignRulesSaveResult {
    const current = this.rules(productId);
    if (!request || request.revision !== current.revision)
      throw new ConflictException('规则已更新，请关闭后重新打开规则面板');
    const rules = validateCampaignRules(request.rules);
    if (
      request.previewToken &&
      request.previewToken !== this.preview(productId, request).token
    )
      throw new ConflictException('数据或策略已变化，请重新试跑后发布');
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
    return { ...this.rules(productId), board: this.campaigns.board(productId) };
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
    this.database.appendActivity({
      caseId: productId,
      action: 'optimizer_analysis_batch',
      actor: 'growth',
      detail: '批量分析去重统计',
      metadata: {
        submitted: String(result.submitted),
        skipped: String(result.skipped),
        failed: String(result.failed.length),
      },
    });
    return result;
  }
}
