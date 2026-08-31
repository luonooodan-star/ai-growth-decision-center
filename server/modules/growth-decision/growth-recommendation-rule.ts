import type {
  CreateRecommendationFromJudgmentRequest,
  GrowthJudgment,
} from '@shared/api.interface';

interface RecommendationTemplate {
  recommendation: string;
  focus: string;
}

const buildSkillRecommendation = (
  judgment: GrowthJudgment,
): CreateRecommendationFromJudgmentRequest => {
  if (judgment.aiAnalysis) {
    return {
      recommendation: judgment.aiAnalysis.recommendedNextStep,
      recommendedAction: {
        actionType: 'investigate_metric_anomaly',
        targetLevel: judgment.adsetId ? 'adset' : 'campaign',
        targetId:
          judgment.adsetId || judgment.campaignId || judgment.productId,
        parameters: {
          source: 'groq_deep_analysis',
          budgetChangePct: 0,
          observationHours: judgment.aiAnalysis.observationHours,
        },
      },
      expectedImpact:
        `在 ${judgment.aiAnalysis.observationHours} 小时观察窗口内验证：` +
        judgment.aiAnalysis.primaryCause,
      riskNote: judgment.aiAnalysis.risk,
    };
  }
  const targetName: string = judgment.adsetName || judgment.adsetId ||
    judgment.campaignName || judgment.campaignId || judgment.productName;
  const templates: Record<string, RecommendationTemplate> = {
    cpi: {
      recommendation: `保持 ${targetName} 当前预算，先拆解 ECPM、素材点击/安装转化与商店页转化，定位 CPI 越界环节。`,
      focus: '竞价成本、素材效率和安装转化',
    },
    cpa: {
      recommendation: `保持 ${targetName} 当前预算，核对目标事件口径并拆解安装后转化漏斗，确认 CPA 越界来源。`,
      focus: '事件口径和安装后转化漏斗',
    },
    d0_roas: {
      recommendation: `保持 ${targetName} 当前预算，核对成熟 cohort 收入、归因完整性和首日变现链路，确认 D0 ROAS 越界原因。`,
      focus: '成熟 cohort、归因和首日变现',
    },
    ecpm: {
      recommendation: `保持 ${targetName} 当前预算，按国家、版位、人群和素材拆解竞价成本，确认 ECPM 越界是否集中。`,
      focus: '国家、版位、人群和素材竞价',
    },
    retention_d1: {
      recommendation: `暂不调整 ${targetName} 预算，按来源和版本拆解新用户次留，优先排查产品体验或流量质量。`,
      focus: '版本、用户质量和次日产品体验',
    },
    ipu: {
      recommendation: `暂不调整 ${targetName} 预算，先确认 IPU 业务口径，再按渠道与用户路径定位越界环节。`,
      focus: 'IPU 口径和用户路径',
    },
    arpu: {
      recommendation: `暂不调整 ${targetName} 预算，按国家、渠道和付费漏斗拆解 ARPU，确认流量质量或变现环节影响。`,
      focus: '用户质量和产品变现漏斗',
    },
  };
  const template: RecommendationTemplate = templates[judgment.targetMetric] || {
    recommendation: `保持 ${targetName} 当前预算，先完成异常指标的分层诊断。`,
    focus: '异常指标分层诊断',
  };
  return {
    recommendation: template.recommendation,
    recommendedAction: {
      actionType: 'investigate_metric_anomaly',
      targetLevel: judgment.adsetId ? 'adset' : 'campaign',
      targetId: judgment.adsetId || judgment.campaignId || judgment.productId,
      parameters: { focus: template.focus, budgetChangePct: 0 },
    },
    expectedImpact: '在下一个完整数据窗口内完成原因定位，并确认是否需要进入预算或素材实验。',
    riskNote: '产品增减量规则尚未校准，本建议不会自动调整预算，需再次人工采纳。',
  };
};

export { buildSkillRecommendation };
