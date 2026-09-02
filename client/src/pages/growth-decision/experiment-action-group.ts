import type { GrowthDecisionCase } from '@shared/api.interface';

interface ActionGroupDefinition {
  key: string;
  label: string;
}

const ACTION_LABELS: Record<string, string> = {
  increase_budget: '提高预算',
  decrease_budget: '降低预算',
  hold_budget: '保持预算并观察',
  exclude_target: '排除定向',
  rotate_creative: '更换素材',
  create_experiment: '新建对照实验',
  observe: '继续观察',
  investigate_data: '补查数据',
};

function inferredActionType(item: GrowthDecisionCase): string {
  const explicit: string | undefined = item.recommendedAction.actionType;
  if (explicit && ACTION_LABELS[explicit]) return explicit;
  const text: string = `${item.recommendation} ${item.decisionReason || ''}`;
  if (/提高|增加|上调.*预算/u.test(text)) return 'increase_budget';
  if (/降低|减少|下调.*预算/u.test(text)) return 'decrease_budget';
  if (/保持.*预算|预算不变|继续观察/u.test(text)) return 'hold_budget';
  if (/排除|暂停.*定向/u.test(text)) return 'exclude_target';
  if (/素材|广告创意/u.test(text)) return 'rotate_creative';
  if (/实验|对照组/u.test(text)) return 'create_experiment';
  if (/补查|核对数据|数据完整/u.test(text)) return 'investigate_data';
  return 'observe';
}

function actionGroupDefinition(
  item: GrowthDecisionCase,
): ActionGroupDefinition {
  const actionType: string = inferredActionType(item);
  const changePct: number | undefined = item.recommendedAction.changePct;
  const usesChangePct: boolean =
    actionType === 'increase_budget' || actionType === 'decrease_budget';
  const normalizedChange: number | undefined =
    usesChangePct && changePct !== undefined
      ? Math.round(Math.abs(changePct))
      : undefined;
  const label: string = ACTION_LABELS[actionType] || '继续观察';
  return {
    key: `action:${actionType}:${normalizedChange ?? 'default'}`,
    label:
      normalizedChange === undefined ? label : `${label} ${normalizedChange}%`,
  };
}

function actionLabel(item: GrowthDecisionCase): string {
  const group: ActionGroupDefinition = actionGroupDefinition(item);
  return group.label;
}

export {
  actionGroupDefinition,
  actionLabel,
  type ActionGroupDefinition,
};
