import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LocalDatabaseService } from '@server/database/local-database.service';
import type {
  GrowthDecisionCase,
  WeeklySkillCandidate,
  WeeklySkillReport,
} from '@shared/api.interface';
import { MetaOperationsService } from './meta-operations.service';
import { reviewMetaOperation, dataDay } from './meta-operation-engine';
import { validateCampaignRules } from './campaign-rules';

export function previousReviewWeek(now = new Date()) {
  const local = new Date(`${dataDay(now.toISOString())}T00:00:00Z`);
  local.setUTCDate(local.getUTCDate() - ((local.getUTCDay() + 6) % 7));
  const end = new Date(local.getTime() - 86400000).toISOString().slice(0, 10);
  return {
    start: new Date(local.getTime() - 7 * 86400000).toISOString().slice(0, 10),
    end,
  };
}

@Injectable()
export class SkillReviewService {
  constructor(
    private readonly db: LocalDatabaseService,
    private readonly meta: MetaOperationsService,
  ) {}
  list() {
    return this.db
      .listSkillReports()
      .map(({ evidence, leaseToken: _token, ...r }) => ({
        ...r,
        evidence: {
          product: { id: evidence.product.id, name: evidence.product.name },
          coverage: evidence.coverage,
        },
      }));
  }
  generate(now = new Date()) {
    const week = previousReviewWeek(now);
    const all = this.meta.linkedOperations();
    for (const product of this.db.listProducts()) {
      const id = `${week.start}-${product.id}`;
      if (this.db.listSkillReports().some((r) => r.id === id)) continue;
      const operations = all.filter(
        (o) =>
          o.productId === product.id &&
          !o.systemActor &&
          o.category !== 'other' &&
          dataDay(o.occurredAt) >= week.start &&
          dataDay(o.occurredAt) <= week.end,
      );
      const manualRecords = this.db
        .listDecisionRecords(10000)
        .filter(
          (r): r is GrowthDecisionCase =>
            !('preliminaryJudgment' in r) &&
            !r.deletedAt &&
            !r.metaOperationId &&
            r.productId === product.id &&
            dataDay(r.createdAt) >= week.start &&
            dataDay(r.createdAt) <= week.end,
        );
      if (!operations.length && !manualRecords.length) continue;
      const snapshots = this.db.listCampaignSnapshots(product.id);
      this.db.saveSkillReport({
        id,
        productId: product.id,
        weekStart: week.start,
        weekEnd: week.end,
        createdAt: now.toISOString(),
        status: 'pending',
        attempt: 0,
        evidence: {
          product,
          operations: operations.slice(0, 150).map((o) => ({
            ...reviewMetaOperation(o, snapshots, all, now),
            decision: this.meta.decisionEvidence(o),
          })),
          manualRecords: manualRecords.slice(0, 100),
          coverage: {
            totalOperations: operations.length,
            returnedOperations: Math.min(150, operations.length),
            truncated: operations.length > 150 || manualRecords.length > 100,
          },
        },
      });
    }
    return this.list();
  }
  claim(now = new Date()) {
    this.generate(now);
    for (const expired of this.db.listSkillReports()) {
      if (
        expired.status === 'running' &&
        Date.parse(expired.leaseUntil || '') <= now.getTime() &&
        expired.attempt >= 3
      )
        this.db.saveSkillReport({
          ...expired,
          status: 'failed',
          error: '连续三次租约超时，请检查分析任务后手动重试',
          leaseToken: undefined,
          leaseUntil: undefined,
        });
    }
    const report = this.db
      .listSkillReports()
      .reverse()
      .find(
        (r) =>
          r.status === 'pending' ||
          (r.status === 'running' &&
            Date.parse(r.leaseUntil || '') <= now.getTime() &&
            r.attempt < 3),
      );
    if (!report) return { job: null };
    const job: WeeklySkillReport = {
      ...report,
      status: 'running',
      attempt: report.attempt + 1,
      leaseToken: randomUUID(),
      leaseUntil: new Date(now.getTime() + 30 * 60000).toISOString(),
    };
    this.db.saveSkillReport(job);
    return {
      job,
      outputContract: {
        summary: '周复盘结论，区分事实、假设、缺口和同期干扰',
        candidates: [
          {
            title: '候选标题',
            conclusion: '适用条件与结论',
            caution: '样本/数据/因果限制',
            evidenceIds: ['仅使用本任务操作或人工记录 ID'],
            suggestedRule: '可选，符合 CampaignDecisionRule，仅候选不自动启用',
          },
        ],
      },
    };
  }
  private active(id: unknown, token: unknown) {
    const report = this.db.listSkillReports().find((r) => r.id === id);
    if (
      !report ||
      report.status !== 'running' ||
      report.leaseToken !== token ||
      Date.parse(report.leaseUntil || '') <= Date.now()
    )
      throw new ConflictException('任务租约失效，请勿覆盖其他运行结果');
    return report;
  }
  submit(input: Record<string, unknown>) {
    const report = this.active(input.id, input.leaseToken);
    if (
      typeof input.summary !== 'string' ||
      !input.summary.trim() ||
      input.summary.length > 12000 ||
      !Array.isArray(input.candidates) ||
      input.candidates.length > 20
    )
      throw new BadRequestException('周复盘格式无效');
    const allowed = new Set([
      ...report.evidence.operations.map((r) => r.operation.id),
      ...report.evidence.manualRecords.map((r) => r.id),
    ]);
    const candidates: WeeklySkillCandidate[] = input.candidates.map(
      (raw: unknown) => {
        if (!raw || typeof raw !== 'object')
          throw new BadRequestException('候选格式错误');
        const c = raw as Record<string, unknown>;
        if (
          !['title', 'conclusion', 'caution'].every(
            (k) =>
              typeof c[k] === 'string' &&
              String(c[k]).trim() &&
              String(c[k]).length <= 4000,
          ) ||
          !Array.isArray(c.evidenceIds) ||
          !c.evidenceIds.length ||
          !c.evidenceIds.every(
            (id) => typeof id === 'string' && allowed.has(id),
          )
        )
          throw new BadRequestException('候选必须包含有效证据、结论及风险');
        const rule = c.suggestedRule
          ? validateCampaignRules([
              c.suggestedRule as NonNullable<
                WeeklySkillCandidate['suggestedRule']
              >,
            ])[0]
          : undefined;
        return {
          title: String(c.title),
          conclusion: String(c.conclusion),
          caution: String(c.caution),
          evidenceIds: [...new Set(c.evidenceIds as string[])],
          suggestedRule: rule ? { ...rule, enabled: false } : undefined,
        };
      },
    );
    this.db.saveSkillReport({
      ...report,
      status: 'completed',
      completedAt: new Date().toISOString(),
      summary: input.summary,
      candidates,
      leaseToken: undefined,
      leaseUntil: undefined,
    });
    return { ok: true, id: report.id };
  }
  fail(input: Record<string, unknown>) {
    const report = this.active(input.id, input.leaseToken);
    if (
      typeof input.error !== 'string' ||
      !input.error.trim() ||
      input.error.length > 1000
    )
      throw new BadRequestException('需要失败原因');
    this.db.saveSkillReport({
      ...report,
      status: 'failed',
      error: input.error,
      leaseToken: undefined,
      leaseUntil: undefined,
    });
    return { ok: true };
  }
  retry(id: string) {
    const report = this.db.listSkillReports().find((r) => r.id === id);
    if (!report) throw new NotFoundException('报告不存在');
    if (
      report.status === 'completed' ||
      (report.status === 'running' &&
        Date.parse(report.leaseUntil || '') > Date.now())
    )
      throw new ConflictException('已完成或运行中，不重复提交');
    this.db.saveSkillReport({
      ...report,
      status: 'pending',
      error: undefined,
      leaseToken: undefined,
      leaseUntil: undefined,
    });
    return { ok: true };
  }
  review(id: string, index: number, decision: unknown) {
    const report = this.db.listSkillReports().find((r) => r.id === id);
    const candidate = report?.candidates?.[index];
    if (
      !report ||
      report.status !== 'completed' ||
      !candidate ||
      !['approved', 'rejected'].includes(String(decision))
    )
      throw new BadRequestException('无效候选审核');
    if (candidate.decision) throw new ConflictException('候选已审核');
    const now = new Date().toISOString();
    if (decision === 'approved') {
      const product = this.db.getProduct(report.productId);
      if (!product) throw new NotFoundException('产品不存在');
      const knowledgeId = `weekly-${report.id}-${index}`;
      this.db.saveProduct({
        ...product,
        knowledge: [
          ...(product.knowledge || []).filter((k) => k.id !== knowledgeId),
          {
            id: knowledgeId,
            sourceCaseId: report.id,
            conclusion: candidate.conclusion,
            caution: candidate.caution,
            approvedAt: now,
          },
        ],
        skillVersion: `${product.skillVersion.split('+weekly-')[0]}+weekly-${report.weekStart}`,
      });
    }
    candidate.decision = decision as 'approved' | 'rejected';
    candidate.reviewedAt = now;
    this.db.saveSkillReport(report);
    this.db.appendActivity({
      caseId: report.productId,
      action: 'weekly_skill_candidate_reviewed',
      actor: 'growth',
      detail: `${decision}: ${candidate.title}`,
      metadata: { reportId: id, index: String(index) },
    });
    return { ok: true };
  }
}
