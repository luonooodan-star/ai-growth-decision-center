import type {
  GrowthActionProposal,
  GrowthAiAnalysis,
  GrowthDeliveryMetricKey,
  GrowthDiagnosticContext,
  GrowthJudgment,
  GrowthProduct,
} from '@shared/api.interface';

interface DiagnosticDecision {
  primaryCause: string;
  recommendedNextStep: string;
  actions: GrowthActionProposal[];
  alternativeCauses: string[];
}

const metricLabel = (key: GrowthDeliveryMetricKey): string =>
  ({
    spend: '消耗',
    impressions: '展示',
    media_clicks: '点击',
    media_installs: '媒体安装',
    adjust_installs: 'Adjust 安装',
    adjust_revenue: 'Adjust 收入',
    cpi: 'CPI',
    ecpm: 'ECPM',
    ctr: 'CTR',
    ipm: 'IPM',
    roas: '当日 ROAS',
    d0_roas: 'D0 ROAS',
  })[key];

const percentageMetrics: GrowthDeliveryMetricKey[] = [
  'ctr',
  'roas',
  'd0_roas',
];

const formatValue = (key: GrowthDeliveryMetricKey, value: number): string => {
  if (percentageMetrics.includes(key)) return `${(value * 100).toFixed(2)}%`;
  if (['spend', 'cpi', 'ecpm', 'adjust_revenue'].includes(key)) {
    return `$${value.toFixed(3)}`;
  }
  return value.toFixed(2);
};

const target = (
  judgment: GrowthJudgment,
): Pick<
  GrowthActionProposal,
  'targetId' | 'targetName' | 'targetLevel'
> => {
  if (judgment.adsetId) {
    return {
      targetLevel: 'adset',
      targetId: judgment.adsetId,
      targetName: judgment.adsetName,
    };
  }
  if (judgment.campaignId) {
    return {
      targetLevel: 'campaign',
      targetId: judgment.campaignId,
      targetName: judgment.campaignName,
    };
  }
  return {
    targetLevel: 'product',
    targetId: judgment.productId,
    targetName: judgment.productName,
  };
};

const action = (
  judgment: GrowthJudgment,
  values: Omit<
    GrowthActionProposal,
    'targetId' | 'targetName' | 'targetLevel'
  >,
): GrowthActionProposal => ({ ...target(judgment), ...values });

const change = (
  context: GrowthDiagnosticContext | undefined,
  key: GrowthDeliveryMetricKey,
): number | undefined => context?.changesPct[key];

const diagnose = (
  judgment: GrowthJudgment,
  product: GrowthProduct,
): DiagnosticDecision => {
  const context: GrowthDiagnosticContext | undefined =
    judgment.diagnosticContext;
  const observationHours: number = Math.max(
    2,
    Math.ceil(product.dataDelayMinutes / 60) * 2,
  );
  const commonGuardrails: string[] = [
    '保留当前投放对象作为对照，不同时改预算、素材和定向',
    '等待 Doris 完成下一完整数据窗口后再判断结果',
    '若归因延迟或 cohort 未成熟，停止实验结论判定',
  ];
  if (!context || context.comparisonDays < 1) {
    return {
      primaryCause: '历史对照数据不足，当前只能确认指标越界，不能确认根因',
      recommendedNextStep:
        '保持预算不变，补齐至少一个历史完整窗口及广告组、版位、年龄和人群拆分后重新分析。',
      actions: [
        action(judgment, {
          actionType: 'investigate_data',
          rationale: '缺少可比历史窗口，直接调整预算会把数据延迟误判为投放问题。',
          steps: [
            '等待下一次 Doris 完整抓取',
            '补查广告组、国家、版位、年龄和人群拆分',
            '使用相同星期与小时窗口重新比较',
          ],
          guardrails: commonGuardrails,
          rollbackCondition: '无需执行投放变更；数据补齐前维持现状。',
          observationHours,
        }),
      ],
      alternativeCauses: ['归因延迟', 'cohort 尚未成熟', '样本量不足'],
    };
  }

  const ecpmChange: number | undefined = change(context, 'ecpm');
  const ctrChange: number | undefined = change(context, 'ctr');
  const ipmChange: number | undefined = change(context, 'ipm');
  const cpiChange: number | undefined = change(context, 'cpi');
  const roasChange: number | undefined =
    change(context, 'd0_roas') ?? change(context, 'roas');
  const targetName: string =
    judgment.adsetName || judgment.campaignName || judgment.productName;

  if ((ctrChange ?? 0) <= -15 || (ipmChange ?? 0) <= -15) {
    return {
      primaryCause:
        '点击或安装响应显著下降，优先指向素材疲劳、受众匹配或版位组合变化',
      recommendedNextStep:
        `为 ${targetName} 新建素材对照实验：保留原素材作控制组，只替换新素材；按版位、年龄和人群观察 CTR、IPM、CPI 与 D0 ROAS。`,
      actions: [
        action(judgment, {
          actionType: 'rotate_creative',
          rationale: `CTR 变化 ${ctrChange ?? 0}%，IPM 变化 ${ipmChange ?? 0}%，响应端恶化比单纯阈值越界更接近可控原因。`,
          steps: [
            '复制当前广告建立新素材实验，原广告保持不变作为控制组',
            '一次只替换素材，不同步修改预算和受众',
            '按版位、年龄、人群比较 CTR、IPM、CPI 和 D0 ROAS',
          ],
          guardrails: commonGuardrails,
          rollbackCondition:
            '新素材在完整观察窗口内 CPI 更高且 D0 ROAS 未改善时停止实验。',
          observationHours,
        }),
      ],
      alternativeCauses: [
        '高成本版位占比上升',
        '受众频次升高或规模枯竭',
        '落地页或商店页转化下降',
      ],
    };
  }

  if ((ecpmChange ?? 0) >= 15 && (ctrChange ?? 0) > -15) {
    return {
      primaryCause:
        'ECPM 上升而点击响应未同步恶化，更可能是竞价压力、版位或受众成本结构变化',
      recommendedNextStep:
        `保持 ${targetName} 原预算作为控制，新建版位/人群拆分实验；优先排查消耗占比高且 ECPM 高的分组，确认后再排除或降量。`,
      actions: [
        action(judgment, {
          actionType: 'create_experiment',
          rationale: `ECPM 较历史窗口上升 ${ecpmChange ?? 0}%，需要用分组实验定位高成本来源。`,
          steps: [
            '按版位、国家、年龄和人群列出消耗与 ECPM 排名',
            '复制广告组，仅隔离一个高成本分组进行对照',
            '若该分组持续高 ECPM 且 D0 ROAS 更差，再提交排除或减量建议',
          ],
          guardrails: commonGuardrails,
          rollbackCondition:
            '实验组安装量不足或 D0 ROAS 下降时恢复原定向并结束实验。',
          observationHours,
        }),
      ],
      alternativeCauses: ['竞品出价升高', '受众重叠', '预算或排期改变'],
    };
  }

  if (
    judgment.targetMetric === 'd0_roas' &&
    Math.abs(cpiChange ?? 0) < 10 &&
    (roasChange ?? judgment.deviationPct ?? 0) < 0
  ) {
    return {
      primaryCause:
        '获客成本基本稳定但成熟 D0 ROAS 下滑，优先指向流量质量、首日变现或产品漏斗，而非单纯竞价成本',
      recommendedNextStep:
        `保持 ${targetName} 预算不变并建立人群质量对照实验，同时核查 Adjust 收入、安装后激活和首日付费漏斗；未证实广告侧原因前不直接减预算。`,
      actions: [
        action(judgment, {
          actionType: 'create_experiment',
          rationale: `CPI 较历史变化 ${cpiChange ?? 0}%，但 D0 ROAS 明显走弱，需要区分流量质量与产品变现问题。`,
          steps: [
            '保留当前广告组作为控制组',
            '复制广告组并仅更换一个人群或素材变量',
            '同步核查 Adjust 安装、收入、ARPU 与成熟 D0 ROAS',
          ],
          guardrails: commonGuardrails,
          rollbackCondition:
            '实验组 D0 ROAS 未改善或 CPI 恶化超过指标库上界时结束实验。',
          observationHours,
        }),
        action(judgment, {
          actionType: 'hold_budget',
          rationale: '当前证据尚未证明预算是根因，直接降量会干扰流量质量验证。',
          steps: ['保持当前预算', '等待成熟 cohort', '与产品侧首日变现数据交叉验证'],
          guardrails: commonGuardrails,
          rollbackCondition: '若达到已批准的止损线，重新提交减量或暂停审批。',
          observationHours,
        }),
      ],
      alternativeCauses: ['首日付费率下降', '低价值人群占比上升', '收入事件延迟'],
    };
  }

  return {
    primaryCause:
      '当前多个交付指标没有形成单一清晰链路，需要通过单变量实验继续定位',
    recommendedNextStep:
      `保持 ${targetName} 预算，建立单变量对照实验；优先比较 ECPM、CTR、IPM、CPI、ARPU 和成熟 D0 ROAS，再决定增量、减量或排除。`,
    actions: [
      action(judgment, {
        actionType: 'create_experiment',
        rationale: '现有指标信号混合，单变量实验比直接调整预算更能确认可控原因。',
        steps: [
          '选择素材、受众或版位中的一个变量',
          '复制当前对象作为实验组，原对象保持控制',
          '完成观察窗口后按指标库标准判断实验结果',
        ],
        guardrails: commonGuardrails,
        rollbackCondition: '实验组核心指标恶化并越过指标库风险边界时结束实验。',
        observationHours,
      }),
    ],
    alternativeCauses: ['竞价成本变化', '素材或受众质量变化', '归因或产品数据变化'],
  };
};

const evidence = (judgment: GrowthJudgment): string[] => {
  const context: GrowthDiagnosticContext | undefined =
    judgment.diagnosticContext;
  const items: string[] = [judgment.evidence];
  if (!context) return items;
  for (const key of DELIVERY_METRIC_KEYS_FOR_EVIDENCE) {
    const value: number | undefined = context.current[key];
    if (value === undefined) continue;
    const delta: number | undefined = context.changesPct[key];
    items.push(
      `${metricLabel(key)} ${formatValue(key, value)}` +
        (delta === undefined
          ? ''
          : `，较前 ${context.comparisonDays} 个完整窗口${delta >= 0 ? '上升' : '下降'} ${Math.abs(delta).toFixed(2)}%`),
    );
  }
  if (context.missingDimensions.length) {
    items.push(`尚缺维度：${context.missingDimensions.join('、')}`);
  }
  return items;
};

const DELIVERY_METRIC_KEYS_FOR_EVIDENCE: GrowthDeliveryMetricKey[] = [
  'spend',
  'ecpm',
  'ctr',
  'ipm',
  'cpi',
  'adjust_installs',
  'adjust_revenue',
  'roas',
  'd0_roas',
];

const buildProductSkillDiagnostic = (
  product: GrowthProduct,
  judgment: GrowthJudgment,
): Omit<
  GrowthAiAnalysis,
  'provider' | 'model' | 'generatedAt' | 'fallbackReason'
> => {
  const decision: DiagnosticDecision = diagnose(judgment, product);
  const context: GrowthDiagnosticContext | undefined =
    judgment.diagnosticContext;
  const evidenceItems: string[] = evidence(judgment);
  const completeness: number = context
    ? context.availableFields.length / DELIVERY_METRIC_KEYS_FOR_EVIDENCE.length
    : 0;
  const confidence: number = Math.max(
    55,
    Math.min(
      88,
      Math.round(
        58 +
          Math.min(14, (context?.comparisonDays || 0) * 2) +
          completeness * 16,
      ),
    ),
  );
  return {
    judgment: context?.comparisonDays ? 'confirmed' : 'uncertain',
    summary:
      `${product.name} 已完成 ${judgment.targetMetric.toUpperCase()} 异常的交付链路拆解。` +
      `最可能原因：${decision.primaryCause}`,
    primaryCause: decision.primaryCause,
    evidence: evidenceItems,
    alternativeCauses: decision.alternativeCauses,
    recommendedNextStep: decision.recommendedNextStep,
    recommendedActions: decision.actions,
    risk:
      context?.missingDimensions.length
        ? `当前缺少 ${context.missingDimensions.join('、')} 拆分，原因属于高概率判断而非已证实因果；执行任何预算或排除动作前需人工确认。`
        : '分析基于观察数据，仍需通过对照实验验证因果；任何投放变更均需人工确认。',
    confidence,
    observationHours: decision.actions[0]?.observationHours || 2,
  };
};

export { buildProductSkillDiagnostic };
