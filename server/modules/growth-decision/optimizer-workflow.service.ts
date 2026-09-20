import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  GrowthDecisionCase,
  OptimizerReview,
} from '@shared/api.interface';
import { LocalDatabaseService } from '@server/database/local-database.service';
import { CampaignDecisionService } from './campaign-decision.service';
import { activeOrder, reviewDeadline } from './campaign-workbench';

@Injectable()
export class OptimizerWorkflowService {
  constructor(
    private readonly db: LocalDatabaseService,
    private readonly campaigns: CampaignDecisionService,
  ) {}

  review(productId: string): OptimizerReview {
    const board = this.campaigns.board(productId);
    const to = new Date().toISOString(),
      from = new Date(Date.now() - 7 * 86400000).toISOString();
    const records = this.db
      .listDecisionRecords(10000)
      .filter(
        (r): r is GrowthDecisionCase =>
          !('preliminaryJudgment' in r) &&
          r.productId === productId &&
          !r.deletedAt,
      );
    const orders = records.filter((r) => r.campaignExecution);
    const week = orders.filter((r) => r.campaignExecution!.acceptedAt >= from);
    const events = this.db
      .listActivities(productId, 10000)
      .filter((a) => a.createdAt >= from);
    const durations = events
      .filter(
        (a) => a.action === 'optimizer_decision' && a.metadata.minutes !== '',
      )
      .map((a) => Number(a.metadata.minutes))
      .filter((n) => Number.isFinite(n) && n >= 0)
      .sort((a, b) => a - b);
    return {
      from,
      to,
      scope: '最近 7 天；当前待办按全量未结束执行单统计。前后变化不代表因果。',
      opened: events.filter((a) => a.action === 'optimizer_viewed').length,
      analysisSubmitted: events
        .filter((a) => a.action === 'optimizer_analysis_batch')
        .reduce((n, a) => n + Number(a.metadata.submitted || 0), 0),
      analysisSkipped: events
        .filter((a) => a.action === 'optimizer_analysis_batch')
        .reduce((n, a) => n + Number(a.metadata.skipped || 0), 0),
      pending: orders.filter(
        (r) => activeOrder(r) && r.campaignExecution!.state === 'pending',
      ).length,
      due: orders.filter(
        (r) =>
          activeOrder(r) &&
          reviewDeadline(r) &&
          Date.parse(reviewDeadline(r)!) <= Date.now(),
      ).length,
      accepted: week.filter((r) =>
        ['pending', 'executed'].includes(r.campaignExecution!.state),
      ).length,
      executed: week.filter((r) => r.campaignExecution!.executedAt).length,
      completedReviews: orders.filter(
        (r) =>
          (r.completedAt || r.campaignExecution!.reviewCompletedAt || '') >=
          from,
      ).length,
      repair: board.items.filter((c) => c.workQueue === 'repair').length,
      medianDecisionMinutes: durations.length
        ? (durations[Math.floor((durations.length - 1) / 2)] +
            durations[Math.floor(durations.length / 2)]) /
          2
        : null,
      results: records.filter(
        (r) =>
          r.status === 'completed' &&
          (r.completedAt || r.observationEndedAt || '') >= from,
      ),
    };
  }

  observe(
    id: string,
    body: { action: 'finish' | 'extend'; reason: string; confirmation: string },
  ) {
    const record = this.db.getDecisionRecord(id);
    if (
      !record ||
      'preliminaryJudgment' in record ||
      record.deletedAt ||
      record.campaignExecution?.state !== 'observing'
    )
      throw new NotFoundException('观察记录不存在');
    if (
      !body ||
      !['finish', 'extend'].includes(body.action) ||
      body.confirmation !== 'REVIEW_OBSERVATION' ||
      typeof body.reason !== 'string' ||
      !body.reason.trim() ||
      body.reason.length > 2000
    )
      throw new BadRequestException('请确认观察复查并填写原因');
    if (record.campaignExecution.reviewCompletedAt) return record;
    const now = new Date().toISOString();
    const finished = body.action === 'finish';
    const updated: GrowthDecisionCase = {
      ...record,
      status: finished ? 'completed' : record.status,
      completedAt: finished ? now : undefined,
      hideAfterAt: finished
        ? new Date(Date.now() + 7 * 86400000).toISOString()
        : undefined,
      actualResult: finished
        ? `仅结束观察，未执行投放措施：${body.reason.trim()}`
        : record.actualResult,
      campaignExecution: {
        ...record.campaignExecution,
        reviewCompletedAt: finished ? now : undefined,
        reviewDueAt: finished
          ? record.campaignExecution.reviewDueAt
          : new Date(
              Date.now() +
                record.campaignExecution.proposal.observationHours * 3600000,
            ).toISOString(),
      },
    };
    this.db.saveDecisionRecord(updated);
    this.db.appendActivity({
      caseId: id,
      action: `observation_${body.action}`,
      actor: 'growth',
      detail: body.reason.trim(),
      metadata: {
        previousDueAt: record.campaignExecution.reviewDueAt || '',
        nextDueAt: updated.campaignExecution!.reviewDueAt || '',
      },
    });
    return updated;
  }

  publishKnowledge(
    id: string,
    body: { confirmation: string; conclusion: string },
  ) {
    const record = this.db.getDecisionRecord(id);
    if (
      !record ||
      'preliminaryJudgment' in record ||
      record.deletedAt ||
      record.status !== 'completed' ||
      !record.resultClassification ||
      !record.executedAt ||
      record.supersededByCaseId
    )
      throw new BadRequestException(
        '只允许实际执行且已记录结果的实验进入知识库；被其他措施打断的实验不能直接发布',
      );
    if (
      body?.confirmation !== 'APPROVE_KNOWLEDGE' ||
      typeof body.conclusion !== 'string' ||
      !body.conclusion.trim() ||
      body.conclusion.length > 2000
    )
      throw new BadRequestException('请填写复盘结论并确认发布');
    const product = this.db.getProduct(record.productId);
    if (!product) throw new NotFoundException('产品不存在');
    const existing = product.knowledge?.find((k) => k.sourceCaseId === id);
    if (existing) return existing;
    const executionDate = new Date(record.executedAt).toLocaleDateString(
      'en-CA',
      { timeZone: 'Asia/Shanghai' },
    );
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Shanghai',
    });
    if (
      !this.db
        .listMonitoringSnapshots(id, 10000)
        .some(
          (s) =>
            !s.isBaseline &&
            s.dataDate > executionDate &&
            s.dataDate < today &&
            Number.isFinite(s.metrics[record.targetMetric]),
        )
    )
      throw new BadRequestException(
        '缺少执行后的目标指标观测，不能发布为产品知识',
      );
    const entry = {
      id: randomUUID(),
      sourceCaseId: id,
      conclusion: body.conclusion.trim(),
      caution:
        '仅为人工审核的历史证据，不等同因果，不自动改变规则；使用前核对样本、归因延迟和同期其他改动。',
      approvedAt: new Date().toISOString(),
    };
    this.db.saveProduct({
      ...product,
      knowledge: [...(product.knowledge || []), entry],
    });
    this.db.appendActivity({
      caseId: record.productId,
      action: 'knowledge_approved',
      actor: 'growth',
      detail: entry.conclusion,
      metadata: { sourceCaseId: id, knowledgeId: entry.id },
    });
    return entry;
  }
}
