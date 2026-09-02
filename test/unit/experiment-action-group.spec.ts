import { actionGroupDefinition } from '@client/pages/growth-decision/experiment-action-group';
import type { GrowthDecisionCase } from '@shared/api.interface';

function legacyCase(recommendation: string): GrowthDecisionCase {
  return {
    id: recommendation,
    productId: 'product-1',
    productName: 'Wingslite',
    anomalyType: 'CPI 异常',
    severity: 'high',
    status: 'accepted',
    channel: 'facebook',
    targetMetric: 'cpi',
    evidence: '测试证据',
    rootCause: '测试原因',
    confidence: 90,
    recommendation,
    recommendedAction: {},
    expectedImpact: '观察 CPI',
    createdAt: new Date(0).toISOString(),
  };
}

describe('experiment action grouping', (): void => {
  it('groups legacy hold-budget actions despite different adset names', (): void => {
    const first = actionGroupDefinition(
      legacyCase('保持 NSQMT/A - 广告副本 当前预算，先拆解 ECPM。'),
    );
    const second = actionGroupDefinition(
      legacyCase('保持 NSQMT/B - 广告副本 当前预算，先拆解 ECPM。'),
    );

    expect(first.key).toBe('action:hold_budget:default');
    expect(second.key).toBe(first.key);
    expect(second.label).toBe('保持预算并观察');
  });
});
