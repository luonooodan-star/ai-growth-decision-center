import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Plus } from 'lucide-react';
import type {
  CampaignDecisionRule,
  CampaignDecisionBoard,
  CampaignRulesConfig,
  CampaignVerdict,
  CampaignRulesPreview,
  CampaignRuleVersion,
} from '@shared/api.interface';
import {
  getCampaignRules,
  saveCampaignRules,
  previewCampaignRules,
  getCampaignRuleVersions,
} from '@/api/campaign-decision';
import { CampaignRulePreview } from './CampaignRulePreview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CampaignRuleConditions } from './CampaignRuleConditions';
import { ANOMALY_TEMPLATES, anomalyTemplate } from './campaign-rule-templates';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';

const CATEGORIES: Record<CampaignVerdict, string> = {
  increase: '加量',
  decrease: '减量',
  adjust_ads: '调整广告',
  observe: '观察',
  normal: '正常',
};
const DEFAULT_LOGIC: Record<CampaignVerdict, string> = {
  increase:
    '主目标连续达标、样本充足且其他已有指标不越界，按产品幅度小幅加量。',
  decrease: '主目标连续不达标且样本充足，进入减量候选。',
  adjust_ads:
    '广告明细覆盖完整、广告消耗占比高且 CTR 明显落后，进入素材对照候选。',
  observe: '缺数据、样本不足、数据过期或已有待执行/观测中的措施，维持观察。',
  normal: '主目标及其他已有指标达标，暂不改变设置。',
};
type Condition = CampaignDecisionRule['conditions'][number];
const errorText = (e: unknown): string =>
  axios.isAxiosError(e)
    ? String(
        e.response?.data?.error?.message ||
          e.response?.data?.message ||
          e.message,
      )
    : e instanceof Error
      ? e.message
      : '操作失败';

interface CampaignRulesPanelProps {
  initialRule?: CampaignDecisionRule;
  productId: string;
  open: boolean;
  onClose: () => void;
  onSaved: (board: CampaignDecisionBoard) => Promise<void>;
}
export const CampaignRulesPanel: React.FC<CampaignRulesPanelProps> = ({
  productId,
  open,
  onClose,
  onSaved,
  initialRule,
}) => {
  const [config, setConfig] = useState<CampaignRulesConfig | null>(null);
  const [category, setCategory] = useState<CampaignVerdict>('increase');
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [preview, setPreview] = useState<CampaignRulesPreview | null>(null);
  const [versions, setVersions] = useState<CampaignRuleVersion[]>([]);
  const [publish, setPublish] = useState(false);
  useEffect(() => {
    setPreview(null);
  }, [config]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setConfig(null);
    setError('');
    setNotice('');
    setSelectedId('');
    setDirty(false);
    setVersions([]);
    void getCampaignRuleVersions(productId)
      .then((v) => {
        if (!cancelled) setVersions(v);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      });
    void getCampaignRules(productId)
      .then((data) => {
        if (!cancelled) {
          if (initialRule) {
            const rule = {
              ...initialRule,
              id: `weekly-${Date.now()}`,
              enabled: false,
            };
            setConfig({ ...data, rules: [...data.rules, rule] });
            setSelectedId(rule.id);
            setDirty(true);
            setNotice(
              '周复盘候选已带入（默认停用）。请核对、启用候选并历史试跑后再发布。',
            );
          } else setConfig(data);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, productId, initialRule]);
  const selected = config?.rules.find((r) => r.id === selectedId);
  const edit = (changes: Partial<CampaignDecisionRule>): void => {
    if (!config || !selected || saving) return;
    setConfig({
      ...config,
      rules: config.rules.map((r) =>
        r.id === selectedId ? { ...r, ...changes } : r,
      ),
    });
    setDirty(true);
    setNotice('');
  };
  const editCondition = (index: number, changes: Partial<Condition>): void => {
    if (selected)
      edit({
        conditions: selected.conditions.map((c, i) =>
          i === index ? { ...c, ...changes } : c,
        ),
      });
  };
  const add = (): void => {
    if (!config || saving || config.rules.length >= 50) return;
    const rule: CampaignDecisionRule = {
      id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: `新增${CATEGORIES[category]}规则`,
      verdict: category,
      enabled: true,
      urgent: category === 'decrease' || category === 'adjust_ads',
      priority: 50,
      consecutiveDays: 2,
      conditions: [
        {
          metric: 'd0_roas',
          basis: 'value',
          operator: category === 'decrease' ? 'lte' : 'gte',
          value: Number.NaN,
        },
      ],
      actionText: '',
    };
    setConfig({ ...config, rules: [...config.rules, rule] });
    setSelectedId(rule.id);
    setDirty(true);
    setNotice('');
  };
  const save = async (confirmed = false): Promise<void> => {
    if (!config || saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      // All categories are saved together. Focus incomplete drafts instead of
      // sending NaN (serialized as null) and showing an unrelated generic error.
      for (const rule of config.rules) {
        const index = rule.conditions.findIndex(
          (condition) =>
            !Number.isFinite(condition.value) ||
            Math.abs(condition.value) > 1e12 ||
            (condition.basis === 'value' && condition.value < 0),
        );
        if (index >= 0) {
          setCategory(rule.verdict);
          setSelectedId(rule.id);
          throw new Error(
            `规则「${rule.name}」第 ${index + 1} 个条件的阈值未填写完整或不合法。已定位该规则；请补齐，或删除该草稿后保存。较前一天变化允许填写 -25，表示下降至少 25%（配合小于等于）。`,
          );
        }
      }
      if (!confirmed) {
        setPreview(await previewCampaignRules(productId, config));
        return;
      }
      if (!preview) throw new Error('请先试跑当前规则');
      const saved = await saveCampaignRules(productId, {
        ...config,
        previewToken: preview.token,
      });
      setConfig({ rules: saved.rules, revision: saved.revision });
      setDirty(false);
      setPublish(false);
      setVersions(await getCampaignRuleVersions(productId));
      if (!saved.board)
        throw new Error(
          '规则已保存，但服务未返回重算结果，请更新公司服务后刷新。',
        );
      await onSaved(saved.board);
      setNotice(
        `已保存并重新判断 ${saved.board.items.length} 个系列；启用规则 ${saved.rules.filter((r) => r.enabled).length} 条，停用 ${saved.rules.filter((r) => !r.enabled).length} 条。命中 ${saved.board.items.filter((c) => c.matchedRule).length} 个系列，异常优先 ${saved.board.items.filter((c) => c.urgent).length} 个。被数据或安全条件拦截的原因可在“查看”中检查；不会自动提交 Codex 分析。`,
      );
    } catch (e: unknown) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next && !saving) {
            if (dirty) setDiscard(true);
            else onClose();
          }
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-4xl">
          <SheetHeader>
            <SheetTitle>系列判断规则</SheetTitle>
            <SheetDescription>
              仅作用于当前产品的广告系列。新增、启停或修改规则后保存；删除也保留变更留档。
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 p-4">
            <p className="rounded-lg bg-blue-50 p-3 text-sm">
              产品达标线仍在指标库维护。自定义规则决定措施类别；多条命中按优先级从高到低，同级按规则
              ID
              排序。未命中时沿用内置判断。自定义规则不能跳过数据完整性、样本和加量达标保护。
            </p>
            <div className="flex flex-wrap gap-2">
              {ANOMALY_TEMPLATES.map((template, index) => (
                <Button
                  key={template.metric}
                  size="sm"
                  variant="outline"
                  disabled={!config || saving || config.rules.length >= 50}
                  onClick={() => {
                    if (!config) return;
                    const rule = anomalyTemplate(
                      index,
                      `rule-${Date.now()}-${index}`,
                    );
                    setConfig({ ...config, rules: [...config.rules, rule] });
                    setCategory('observe');
                    setSelectedId(rule.id);
                    setDirty(true);
                    setNotice(
                      '已添加异常模板草稿：环比 30% 仅为待确认示例。请修改阈值、补全 CPI 临界值，并启用后保存。买量 CPM 不是产品变现 ECPM，下降不一定是坏事。',
                    );
                  }}
                >
                  异常模板：{template.label}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(CATEGORIES) as CampaignVerdict[]).map((v) => (
                <Button
                  key={v}
                  size="sm"
                  variant={category === v ? 'default' : 'outline'}
                  onClick={() => {
                    setCategory(v);
                    setSelectedId('');
                  }}
                >
                  {CATEGORIES[v]}{' '}
                  {config?.rules.filter((r) => r.verdict === v).length || 0}
                </Button>
              ))}
            </div>
            <p className="text-sm text-slate-600">
              内置{CATEGORIES[category]}逻辑：{DEFAULT_LOGIC[category]}
            </p>
            <Button
              size="sm"
              disabled={!config || saving || config.rules.length >= 50}
              onClick={add}
            >
              <Plus className="size-4" />
              新增{CATEGORIES[category]}规则
            </Button>
            {!config && !error && <p>正在读取规则…</p>}
            {config && !config.rules.some((r) => r.verdict === category) && (
              <p className="text-sm text-slate-500">
                此类别暂未配置自定义规则，当前使用上方内置逻辑。
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {config?.rules
                .filter((r) => r.verdict === category)
                .map((r) => (
                  <Button
                    key={r.id}
                    size="sm"
                    variant={selectedId === r.id ? 'secondary' : 'outline'}
                    onClick={() => setSelectedId(r.id)}
                  >
                    {r.name} · {r.enabled ? '启用' : '停用'} · 优先级{' '}
                    {r.priority}
                  </Button>
                ))}
            </div>
            {selected && (
              <div className="space-y-4 rounded-xl border p-4">
                <label className="block space-y-1 text-sm">
                  规则名称
                  <Input
                    aria-label="规则名称"
                    value={selected.name}
                    onChange={(e) => edit({ name: e.target.value })}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={selected.enabled ? 'default' : 'outline'}
                    aria-pressed={selected.enabled}
                    onClick={() => edit({ enabled: !selected.enabled })}
                  >
                    {selected.enabled ? '规则已启用' : '规则已停用（点击启用）'}
                  </Button>
                  <Button
                    size="sm"
                    variant={selected.urgent ? 'default' : 'outline'}
                    aria-pressed={selected.urgent}
                    onClick={() => edit({ urgent: !selected.urgent })}
                  >
                    异常优先处理：{selected.urgent ? '开' : '关'}
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="space-y-1 text-sm">
                    措施类别
                    <Select
                      value={selected.verdict}
                      onValueChange={(v) => {
                        edit({
                          verdict: v as CampaignVerdict,
                          changePct: undefined,
                        });
                        setCategory(v as CampaignVerdict);
                      }}
                    >
                      <SelectTrigger aria-label="措施类别" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(CATEGORIES).map(([v, label]) => (
                          <SelectItem key={v} value={v}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="space-y-1 text-sm">
                    匹配优先级（0～100）
                    <Input
                      aria-label="匹配优先级"
                      type="number"
                      min={0}
                      max={100}
                      value={
                        Number.isFinite(selected.priority)
                          ? selected.priority
                          : ''
                      }
                      onChange={(e) =>
                        edit({
                          priority:
                            e.target.value === ''
                              ? NaN
                              : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    连续满足天数（1～7）
                    <Input
                      aria-label="连续满足天数"
                      type="number"
                      min={1}
                      max={7}
                      value={
                        Number.isFinite(selected.consecutiveDays)
                          ? selected.consecutiveDays
                          : ''
                      }
                      onChange={(e) =>
                        edit({
                          consecutiveDays:
                            e.target.value === ''
                              ? NaN
                              : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                </div>
                <CampaignRuleConditions
                  selected={selected}
                  edit={edit}
                  editCondition={editCondition}
                />
                {['increase', 'decrease'].includes(selected.verdict) && (
                  <label className="block space-y-1 text-sm">
                    本规则预算调整幅度（%，留空沿用产品策略；不会超过产品幅度上限）
                    <Input
                      type="number"
                      aria-label="规则预算调整幅度"
                      value={selected.changePct ?? ''}
                      onChange={(e) =>
                        edit({
                          changePct:
                            e.target.value === ''
                              ? undefined
                              : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                )}
                <label className="block space-y-1 text-sm">
                  具体措施说明
                  <Textarea
                    aria-label="具体措施说明"
                    value={selected.actionText}
                    onChange={(e) => edit({ actionText: e.target.value })}
                    placeholder="填写满足条件后应采取的动作，以及观察重点"
                  />
                </label>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant="outline">
                    保存前请核对规则启用状态和条件
                  </Badge>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setDeleteId(selected.id)}
                  >
                    删除规则
                  </Button>
                </div>
              </div>
            )}
            {error && (
              <p
                role="alert"
                className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
              >
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm">
                {notice}
              </p>
            )}
            {preview && <CampaignRulePreview preview={preview} />}
            <Button
              disabled={!config || saving || !dirty}
              onClick={() => void save()}
            >
              {saving ? '处理中' : '试跑规则（不修改线上）'}
            </Button>
            <Button
              disabled={!preview || saving || !dirty}
              onClick={() => setPublish(true)}
            >
              核对后发布并重新判断
            </Button>
            {!!versions.length && (
              <details className="rounded-lg border p-3 text-sm">
                <summary>历史版本恢复（保留审计）</summary>
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {versions.map((v) => (
                    <div
                      key={v.id}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span>
                        {new Date(v.createdAt).toLocaleString('zh-CN')} 修改前 ·{' '}
                        {v.rules.length} 条
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={saving}
                        onClick={() => {
                          if (config) setConfig({ ...config, rules: v.rules });
                          setDirty(true);
                          setNotice('历史版本已载入草稿，请试跑后发布');
                        }}
                      >
                        载入草稿
                      </Button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <AlertDialog
        open={Boolean(deleteId)}
        onOpenChange={(v) => !v && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这条规则？</AlertDialogTitle>
            <AlertDialogDescription>
              保存后不再参与判断，历史执行单与分析保留，规则变更会留档。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (config)
                  setConfig({
                    ...config,
                    rules: config.rules.filter((r) => r.id !== deleteId),
                  });
                setDirty(true);
                setSelectedId('');
                setDeleteId(null);
              }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={publish} onOpenChange={setPublish}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认发布规则？</AlertDialogTitle>
            <AlertDialogDescription>
              历史试跑 {preview?.changed || 0}{' '}
              个系列日改判。发布将立即重算当前决策台，不自动修改广告或触发 AI
              分析。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>返回核对</AlertDialogCancel>
            <Button disabled={saving} onClick={() => void save(true)}>
              确认发布
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle>
            <AlertDialogDescription>
              尚未保存的规则不会生效。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDirty(false);
                setDiscard(false);
                onClose();
              }}
            >
              放弃并关闭
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
