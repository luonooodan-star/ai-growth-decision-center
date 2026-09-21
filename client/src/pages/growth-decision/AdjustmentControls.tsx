import { useEffect, useRef, useState } from 'react';
import type { AdjustmentNode } from '@shared/ad-adjustment.interface';
import type { MetaAdjustmentSnapshot } from '@shared/api.interface';
import { inspectAdjustment, adjustmentError } from '@/api/meta-adjustments';
import { AdjustmentRowEditor } from './AdjustmentEditor';
import type { ComponentProps } from 'react';

// Read-only Meta inspections are viewport-driven and bounded, never one request per table row at once.
let running = 0;
const waiting: (() => void)[] = [];
const cache = new Map<
  string,
  { at: number; snapshots: MetaAdjustmentSnapshot[] }
>();
const pending = new Map<string, Promise<MetaAdjustmentSnapshot[]>>();
function inspect(node: AdjustmentNode, live: () => boolean) {
  const key = node.key;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60000) return Promise.resolve(hit.snapshots);
  if (pending.has(key)) return pending.get(key)!;
  const promise = (async () => {
    if (running >= 2)
      await new Promise<void>((resolve) => waiting.push(resolve));
    else running++;
    try {
      if (!live()) return [];
      const snapshots = await inspectAdjustment(
        {
          id: node.id,
          accountId: node.account.replace(/^act_/, ''),
          campaignId: node.campaignId,
          adsetId: node.adsetId,
          level:
            node.level === 'campaign'
              ? 'campaign'
              : node.level === 'adgroup'
                ? 'adset'
                : 'ad',
        },
        node.level === 'creative',
      );
      cache.delete(key);
      cache.set(key, { at: Date.now(), snapshots });
      while (cache.size > 200) cache.delete(cache.keys().next().value!);
      return snapshots;
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  })().finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}
export function AdjustmentControls({
  node,
  enabled,
  drafts,
  update,
}: {
  node: AdjustmentNode;
  enabled: boolean;
  drafts: ComponentProps<typeof AdjustmentRowEditor>['drafts'];
  update: ComponentProps<typeof AdjustmentRowEditor>['update'];
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [snapshots, setSnapshots] = useState<MetaAdjustmentSnapshot[]>([]);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const valid =
    enabled &&
    node.media.toLowerCase() === 'facebook' &&
    /^\d+$/.test(node.account.replace(/^act_/, '')) &&
    /^\d+$/.test(node.id);
  useEffect(() => {
    let live = true;
    setSnapshots([]);
    setError('');
    if (!valid) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      void inspect(node, () => live)
        .then((value) => {
          if (!live) return;
          setSnapshots(value);
          if (!value.length) setError('未映射到可操作广告');
        })
        .catch((e) => {
          if (live) setError(adjustmentError(e));
        });
    });
    if (anchor.current) observer.observe(anchor.current);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [node.key, valid, retry]);
  return (
    <div ref={anchor} className="min-w-56 max-w-64">
      {snapshots.length ? (
        <AdjustmentRowEditor
          snapshots={snapshots}
          drafts={drafts}
          update={update}
          disabled={!valid}
        />
      ) : (
        <span className="text-[11px] text-slate-400">
          {valid
            ? error
              ? 'Meta 状态读取失败'
              : '读取 Meta 开关 / 预算…'
            : '账户未确认 / 不支持操作'}
        </span>
      )}
      {error && (
        <div className="whitespace-normal text-xs text-red-600">
          {error}
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => {
              cache.delete(node.key);
              setRetry((v) => v + 1);
            }}
          >
            重试
          </button>
        </div>
      )}
    </div>
  );
}
