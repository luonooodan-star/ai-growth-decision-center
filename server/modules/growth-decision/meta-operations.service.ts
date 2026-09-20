import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  CampaignDailySnapshot,
  GrowthDecisionCase,
  MetaOperation,
  MetaOperationOverview,
  MetaAdEntity,
  MetaSyncPlan,
} from '@shared/api.interface';
import { metaTargets } from '@shared/meta-targets';
import { LocalDatabaseService } from '@server/database/local-database.service';
import {
  dataDay,
  normalizeMetaOperation,
  reviewMetaOperation,
} from './meta-operation-engine';
import { operationDecisionEvidence } from './operation-decision-evidence';
import { buildCampaignCard } from './campaign-decision-engine';
import { reconcileCampaignHistory } from './campaign-history';
import { campaignHash } from './campaign-snapshots';

@Injectable()
export class MetaOperationsService {
  constructor(private readonly db: LocalDatabaseService) {}
  entities(): MetaAdEntity[] {
    return this.db.listMetaEntities();
  }

  syncPlan(offset = 0): MetaSyncPlan {
    const entities = this.entities();
    const targets = new Map<string, MetaSyncPlan['targets'][number]>();
    const unresolved = new Set<string>();
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    for (const product of this.db.listProducts().filter(p => p.status === 'active' && p.channel.toLowerCase() === 'facebook')) {
      for (const s of this.db.listCampaignSnapshots(product.id)) {
        if (s.dataDate < cutoff || !/^\d+$/.test(s.campaignId)) continue;
        const owners = [...new Set(entities.filter(e => e.campaignId === s.campaignId).map(e => e.accountId))];
        const accountId = s.accountId || (owners.length === 1 ? owners[0] : undefined);
        if (!accountId || !/^\d+$/.test(accountId)) { unresolved.add(s.campaignId); continue; }
        const key = `${accountId}:${s.campaignId}`;
        const matching = entities.filter(e => e.accountId === accountId && e.campaignId === s.campaignId);
        const summary = metaTargets(matching);
        const item = targets.get(key) || {
          productId: product.id, accountId, campaignId: s.campaignId,
          adsetIds: [], adIds: [], lastFetchedAt: matching.map(e => e.fetchedAt).sort()[0],
          missingFields: [!summary.objectives.length ? 'objective' : '', !summary.optimizationGoals.length ? 'optimization_goal' : '', summary.eventStatus === 'pending' ? 'promoted_object' : ''].filter(Boolean),
        };
        for (const [dimension, field] of [['adset', 'adsetIds'], ['ad', 'adIds']] as const)
          item[field] = [...new Set([...item[field], ...s.breakdowns.filter(b => b.dimension === dimension && /^\d+$/.test(b.value)).map(b => b.value)])].sort();
        targets.set(key, item);
      }
    }
    // Stable ID pagination so importing a page cannot move the next page beneath the cursor.
    const all = [...targets.values()].sort((a, b) => `${a.accountId}:${a.campaignId}`.localeCompare(`${b.accountId}:${b.campaignId}`));
    const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
    return { generatedAt: new Date().toISOString(), total: all.length, offset: start,
      nextOffset: start + 20 < all.length ? start + 20 : null,
      targets: all.slice(start, start + 20), unresolvedCampaigns: unresolved.size };
  }

  captureSnapshots(productId: string): void {
    const snapshots = this.db.listCampaignSnapshots(productId);
    const product = this.db.getProduct(productId);
    if (product)
      for (const {
        snapshots: history,
        relatedKeys,
      } of reconcileCampaignHistory(snapshots)) {
        const card = buildCampaignCard(
          product,
          history,
          [],
          new Date(),
          relatedKeys,
        );
        this.db.saveCampaignRecommendation({
          id: campaignHash({
            productId,
            key: card.key,
            revision: card.revision,
            skill: product.skillVersion,
          }),
          productId,
          createdAt: new Date().toISOString(),
          skillVersion: product.skillVersion,
          rules: product.campaignRules,
          card,
        });
      }
    for (const record of this.db.listDecisionRecords(10000)) {
      if (
        'preliminaryJudgment' in record ||
        !record.metaOperationId ||
        record.productId !== productId ||
        record.completedAt ||
        record.deletedAt
      )
        continue;
      const current = snapshots.find(
        (s) =>
          s.campaignId === record.campaignId &&
          s.accountId === record.adAccountId,
      );
      if (
        !current ||
        Date.parse(current.fetchedAt) < Date.parse(record.executedAt || '')
      )
        continue;
      const previous = this.db.listMonitoringSnapshots(record.id, 1)[0];
      if (previous?.id === `${record.id}-${current.fetchedAt}`) continue;
      this.db.saveMonitoringSnapshot({
        id: `${record.id}-${current.fetchedAt}`,
        recordId: record.id,
        productId,
        subjectType: 'experiment',
        observedAt: current.fetchedAt,
        dataDate: current.dataDate,
        campaignId: current.campaignId,
        campaignName: current.campaignName,
        metrics: current.metrics,
        previousMetrics: previous?.metrics || {},
        changesPct: {},
        isWithinNormalRange: false,
        source: 'meta_operation_doris_daily_cumulative',
      });
    }
  }

  import(payload: unknown) {
    const rows =
      payload && typeof payload === 'object'
        ? Reflect.get(payload, 'operations')
        : undefined;
    if (!Array.isArray(rows) || rows.length > 500)
      throw new BadRequestException('每批 operations 必须为数组，最多 500 条');
    // Validate entire batch before writing, so malformed input never partially imports.
    const operations = rows.map(normalizeMetaOperation);
    const entityRows: unknown =
      Reflect.get(payload as object, 'entities') || [];
    if (!Array.isArray(entityRows) || entityRows.length > 500)
      throw new BadRequestException('entities 最多 500 条');
    const entities: MetaAdEntity[] = entityRows.map((e: unknown) => {
      if (!e || typeof e !== 'object')
        throw new BadRequestException('实体格式无效');
      const value = e as Record<string, unknown>;
      if (
        !['accountId', 'id', 'campaignId'].every(
          (k) =>
            typeof value[k] === 'string' && /^\d{1,40}$/.test(String(value[k])),
        ) ||
        !['campaign', 'adset', 'ad'].includes(String(value.level)) ||
        typeof value.name !== 'string' ||
        value.name.length > 500 ||
        typeof value.fetchedAt !== 'string' ||
        !/(Z|[+-]\d{2}:\d{2})$/.test(value.fetchedAt) ||
        !Number.isFinite(Date.parse(value.fetchedAt)) ||
        Date.parse(value.fetchedAt) > Date.now() + 300000 ||
        !['objective', 'optimizationGoal', 'conversionEvent'].every(
          (k) =>
            value[k] === undefined ||
            (typeof value[k] === 'string' && String(value[k]).length <= 500),
        )
        || (value.adsetId !== undefined && (typeof value.adsetId !== 'string' || !/^\d{1,40}$/.test(value.adsetId)))
        || (value.conversionEventStatus !== undefined && !['returned', 'not_configured', 'unsupported'].includes(String(value.conversionEventStatus)))
      )
        throw new BadRequestException('实体 ID、时间或目标字段无效');
      if (value.level === 'campaign' && value.id !== value.campaignId)
        throw new BadRequestException('系列实体 ID 不一致');
      return {
        ...value,
        fetchedAt: new Date(value.fetchedAt).toISOString(),
      } as unknown as MetaAdEntity;
    });
    let inserted = 0;
    for (const entity of entities) this.db.saveMetaEntity(entity);
    for (const operation of operations)
      if (this.db.saveMetaOperation(operation)) inserted++;
    this.reconcile();
    return {
      inserted,
      duplicates: rows.length - inserted,
      received: rows.length,
      entities: entities.length,
    };
  }

  linkedOperations(): MetaOperation[] {
    const products = this.db.listProducts();
    const entities = this.db.listMetaEntities();
    const histories = products.map((p) => ({
      id: p.id,
      snapshots: this.db.listCampaignSnapshots(p.id),
    }));
    return this.db.listMetaOperations().map((original) => {
      const entity = entities.find(
        (e) => e.accountId === original.accountId && e.id === original.objectId,
      );
      const o = {
        ...original,
        campaignId:
          original.objectLevel === 'campaign'
            ? original.objectId
            : original.campaignId || entity?.campaignId,
      };
      const matches = histories.filter((h) =>
        h.snapshots.some(
          (s) => s.campaignId === o.campaignId && s.accountId === o.accountId,
        ),
      );
      return {
        ...o,
        currentTargets: metaTargets(entities.filter(e => e.accountId === o.accountId && e.campaignId === o.campaignId &&
          (e.level === 'campaign' || o.objectLevel === 'campaign' || e.id === o.objectId ||
            (o.objectLevel === 'ad' && e.id === entity?.adsetId)))),
        linked: matches.length === 1,
        productId: matches.length === 1 ? matches[0].id : undefined,
      };
    });
  }

  overview(page = 1): MetaOperationOverview {
    const operations = this.linkedOperations();
    const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
    const histories = new Map<string, CampaignDailySnapshot[]>();
    const items = operations
      .slice((safePage - 1) * 50, safePage * 50)
      .map((o) => {
        if (o.productId && !histories.has(o.productId))
          histories.set(
            o.productId,
            this.db.listCampaignSnapshots(o.productId),
          );
        return {
          ...reviewMetaOperation(
            o,
            histories.get(o.productId || '') || [],
            operations,
          ),
          decision: this.decisionEvidence(o),
        };
      });
    return {
      items,
      total: operations.length,
      page: safePage,
      lastImportAt: operations
        .map((o) => o.importedAt)
        .sort()
        .at(-1),
    };
  }

  decisionEvidence(op: MetaOperation) {
    const stored = this.db.getOperationEvidence(op.id);
    if (stored) return stored;
    const result = operationDecisionEvidence(
      op,
      this.db.listDecisionRecords(10000),
      this.db.listCampaignRecommendations(),
    );
    if (op.linked) this.db.saveOperationEvidence(result);
    return result;
  }

  annotate(id: string, reason: unknown) {
    const op = this.linkedOperations().find((o) => o.id === id);
    if (
      !op ||
      typeof reason !== 'string' ||
      !reason.trim() ||
      reason.length > 2000
    )
      throw new BadRequestException('请提供有效操作及 1～2000 字判断理由');
    const evidence = {
      ...this.decisionEvidence(op),
      humanReason: reason.trim(),
      reasonUpdatedAt: new Date().toISOString(),
    };
    this.db.saveOperationEvidence(evidence);
    this.db.appendActivity({
      caseId: id,
      action: 'operation_reason_updated',
      actor: 'growth',
      detail: reason.trim(),
      metadata: {},
    });
    return evidence;
  }

  /** Called after import and after Doris snapshots arrive. Idempotent; no ad writes. */
  reconcile(): void {
    const operations = this.linkedOperations().sort((a, b) =>
      a.occurredAt.localeCompare(b.occurredAt),
    );
    for (const op of operations) {
      this.decisionEvidence(op);
      if (!op.productId || op.category === 'other') continue;
      const id = `meta-${op.id}`;
      if (this.db.getDecisionRecord(id)) continue;
      const product = this.db.getProduct(op.productId)!;
      const baseline = this.db
        .listCampaignSnapshots(product.id)
        .filter(
          (s) =>
            s.campaignId === op.campaignId &&
            s.accountId === op.accountId &&
            s.dataDate < dataDay(op.occurredAt) &&
            !s.qualityIssues.length,
        )
        .sort((a, b) => b.dataDate.localeCompare(a.dataDate))[0];
      if (!baseline) continue;
      const label = {
        increase: '已执行加量',
        decrease: '已执行减量',
        pause: '已停投',
        adjust: '已调整广告',
      }[op.category];
      const actionType =
        op.category === 'increase'
          ? 'increase_budget'
          : op.category === 'decrease'
            ? 'decrease_budget'
            : 'observe';
      const next = operations.find(
        (o) =>
          o.category !== 'other' &&
          o.campaignId === op.campaignId &&
          o.accountId === op.accountId &&
          o.occurredAt > op.occurredAt,
      );
      const record: GrowthDecisionCase = {
        id,
        metaOperationId: op.id,
        productId: product.id,
        productName: product.name,
        campaignId: op.campaignId,
        campaignName: op.campaignName || baseline.campaignName,
        adAccountId: op.accountId,
        channel: product.channel,
        anomalyType: 'Meta 实际操作跟踪',
        severity: 'low',
        status: next ? 'completed' : 'observing',
        targetMetric: 'd0_roas',
        evidence: `${op.actorName} · ${op.occurredAt} · ${op.eventType} · ${op.objectName}`,
        rootCause: '记录真实操作，不推断优化师意图或效果因果',
        confidence: 0,
        recommendation: `${label} · 自动观察`,
        recommendedAction: {
          actionType,
          targetId: op.objectId,
          targetLevel: op.objectLevel,
        },
        expectedImpact: '等待 Doris 操作前后完整日对照',
        riskNote:
          '广告组/广告操作的 D0 目前仅能在系列层观察，不能冒充广告组效果。',
        createdAt: op.importedAt,
        executedAt: op.occurredAt,
        experimentStartedAt: op.occurredAt,
        completedAt: next?.occurredAt,
        observationEndedAt: next?.occurredAt,
        supersededByCaseId: next ? `meta-${next.id}` : undefined,
        hideAfterAt: next
          ? new Date(Date.parse(next.occurredAt) + 7 * 86400000).toISOString()
          : undefined,
        campaignExecution: {
          campaignKey: baseline.key,
          revision: `meta-${op.id}`,
          state: 'executed',
          acceptedAt: op.occurredAt,
          executedAt: op.occurredAt,
          reviewCompletedAt: next?.occurredAt,
          reviewDueAt: new Date(
            Date.parse(op.occurredAt) + 86400000,
          ).toISOString(),
          baseline,
          executionNote: `Meta 自动记录：${op.eventType}`,
          proposal: {
            actionType,
            targetLevel: 'campaign',
            targetId: op.campaignId!,
            targetName: baseline.campaignName,
            changePct: op.changePct,
            rationale: `${label}；原操作对象 ${op.objectLevel} ${op.objectName}`,
            steps: ['只读跟踪操作后数据，不再次执行投放'],
            guardrails: ['核对同期其他操作与数据完整性'],
            rollbackCondition: '需人工判断，不自动回滚',
            observationHours: 24,
          },
        },
      };
      this.db.saveDecisionRecord(record);
      this.db.saveMonitoringSnapshot({
        id: `${id}-baseline`,
        recordId: id,
        productId: product.id,
        subjectType: 'experiment',
        observedAt: op.importedAt,
        dataDate: baseline.dataDate,
        campaignId: op.campaignId,
        campaignName: baseline.campaignName,
        metrics: baseline.metrics,
        previousMetrics: {},
        changesPct: {},
        isWithinNormalRange: false,
        isBaseline: true,
        source: 'meta_previous_complete_day',
      });
      this.db.appendActivity({
        caseId: id,
        action: 'meta_operation_imported',
        actor: op.actorName,
        detail: record.evidence,
        metadata: { metaOperationId: op.id },
      });
    }
    // Later imports also close earlier observations; keep all evidence and do not declare success.
    const records = this.db.listDecisionRecords(10000);
    for (const record of records) {
      if (
        'preliminaryJudgment' in record ||
        !record.metaOperationId ||
        record.completedAt ||
        record.deletedAt
      )
        continue;
      const next = operations.find(
        (o) =>
          o.category !== 'other' &&
          o.accountId === record.adAccountId &&
          o.campaignId === record.campaignId &&
          o.occurredAt > (record.executedAt || ''),
      );
      if (!next) continue;
      this.db.saveDecisionRecord({
        ...record,
        status: 'completed',
        completedAt: next.occurredAt,
        observationEndedAt: next.occurredAt,
        supersededByCaseId: `meta-${next.id}`,
        hideAfterAt: new Date(
          Date.parse(next.occurredAt) + 7 * 86400000,
        ).toISOString(),
        actualResult: '新 Meta 操作介入，原观察结束；不能单独归因',
        campaignExecution: record.campaignExecution
          ? { ...record.campaignExecution, reviewCompletedAt: next.occurredAt }
          : undefined,
      });
    }
  }
}
