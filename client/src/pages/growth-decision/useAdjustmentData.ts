import { useCallback, useEffect, useRef, useState } from 'react';
import { getAdjustmentDay } from '@/api/paid-growth';
import type { AdjustmentDay } from '@shared/ad-adjustment.interface';
import { adjustmentDates, adjustmentToday } from '@shared/ad-adjustment';

export interface AdjustmentDetail {
  days: AdjustmentDay[];
  loading: boolean;
  error: string;
}
const message = (e: unknown) =>
  e instanceof Error ? e.message : '读取失败，请重试';
const incomplete = (d: AdjustmentDay) =>
  [d.daily, d.revenue, d.accounts]
    .filter((p) => p.state === 'missing' || p.state === 'stale')
    .map((p) => p.message || '数据不完整，未用于达标判断')
    .join('；');

export function useAdjustmentData(
  appId: string,
  media: string,
  optimizer = '',
  country = '',
) {
  const [days, setDays] = useState<AdjustmentDay[]>([]);
  const [today, setToday] = useState(adjustmentToday);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [details, setDetails] = useState<Record<string, AdjustmentDetail>>({});
  const [options, setOptions] = useState<AdjustmentDay['options']>();
  const [accountsReady, setAccountsReady] = useState(false);
  const activated = useRef(false);
  const detailCache = useRef<Record<string, AdjustmentDetail>>({});
  const active = useRef<AbortController | null>(null);
  const children = useRef(new Map<string, AbortController>());
  const generation = useRef(0);
  const reset = useCallback(() => {
    generation.current++;
    active.current?.abort();
    active.current = null;
    for (const controller of children.current.values()) controller.abort();
    children.current.clear();
    detailCache.current = {};
    setDetails({});
  }, []);
  const load = useCallback(async () => {
    if (active.current || !appId || !media) return;
    reset();
    const epoch = generation.current;
    const controller = new AbortController();
    active.current = controller;
    const date = adjustmentToday();
    setToday(date);
    setLoading(true);
    setError('');
    setAccountsReady(false);
    activated.current = true;
    setProgress('先读取缓存 · 今日数据后台更新…');
    const live = () =>
      epoch === generation.current && !controller.signal.aborted;
    try {
      const failures: string[] = [];
      const done = new Set<string>();
      const labels = { daily: '消耗', revenue: 'D0', accounts: '账户归属' };
      const merge = (
        value: AdjustmentDay,
        part: 'daily' | 'revenue' | 'accounts',
        cache = false,
      ) => {
        if (!live()) return;
        if (cache && !value[part].updatedAt) return;
        setDays((old) => {
          const previous = old.find(
            (d) =>
              d.date === value.date &&
              d.scope?.optimizer === optimizer &&
              d.scope?.country === country,
          );
          const next = {
            ...(previous || value),
            [part]: value[part],
            timings: { ...previous?.timings, ...value.timings },
          };
          return [...old.filter((d) => d.date !== value.date), next];
        });
      };
      const fetchPart = async (
        d: string,
        part: 'daily' | 'revenue' | 'accounts',
      ) => {
        const query = { date: d, appId, media, optimizer, country, part };
        if (part === 'accounts') {
          let offset: number | undefined = 0;
          let owner: string | undefined;
          let accountSession: string | undefined;
          const rows: AdjustmentDay['accounts']['rows'] = [];
          try {
            while (offset !== undefined && live()) {
              const value = await getAdjustmentDay(
                { ...query, accountOffset: String(offset), accountSession },
                controller.signal,
              );
              if (!live()) return;
              const page = value.accounts;
              accountSession = page.accountSession;
              if (page.state === 'missing' || page.state === 'stale')
                throw new Error(page.message || '账户核验未完成');
              if (
                owner &&
                page.accountOwnerId &&
                owner !== page.accountOwnerId
              ) {
                rows.length = 0;
                setAccountsReady(false);
                merge(
                  {
                    ...value,
                    accounts: {
                      rows: [],
                      state: 'missing',
                      message: 'Meta 身份已变化，请重新抓取',
                    },
                  },
                  part,
                );
                throw new Error('Meta 身份已变化，请重新抓取');
              }
              owner = page.accountOwnerId || owner;
              rows.push(...page.rows);
              merge({ ...value, accounts: { ...page, rows: [...rows] } }, part);
              setAccountsReady(true);
              setProgress(
                `已确认 ${rows.length} / ${page.accountTotal ?? '待确认'} 个系列，已确认的系列可操作 · 优先核验有消耗的系列`,
              );
              if (page.message && page.message.includes('无法'))
                failures.push(`${d}：${page.message}`);
              const next = page.accountNextOffset;
              if (next !== undefined && next <= offset)
                throw new Error('账户核验分页未推进');
              offset = next;
            }
          } catch (e) {
            if (live())
              failures.push(
                `账户核验部分未完成：${message(e)}；已确认的系列仍可操作，请重新抓取重试其余系列`,
              );
          }
          return;
        }
        try {
          const cached = await getAdjustmentDay(
            { ...query, cacheOnly: '1' },
            controller.signal,
          );
          merge(cached, part, true);
          // The server has already validated this user's historical cache TTL.
          // Reading it does not grant permission to modify an advertising object.
          if (d !== date && cached[part].state === 'cached') return;
        } catch {
          /* A cache failure must not block a fresh read. */
        }
        if (!live()) return;
        try {
          const value = await getAdjustmentDay(
            { ...query, refresh: d === date ? '1' : undefined },
            controller.signal,
          );
          merge(value, part);
          if (!live()) return;
          const p = value[part];
          if (p.state === 'missing' || p.state === 'stale')
            failures.push(`${d} ${labels[part]}：${p.message || '未完成'}`);
          if (d === date) {
            done.add(part);
            setProgress(
              `今日：${Object.entries(labels)
                .map(
                  ([k, label]) =>
                    `${label}${done.has(k) ? '已返回' : '更新中'}`,
                )
                .join(' / ')} · 历史后台补齐`,
            );
          }
        } catch (e) {
          if (live()) failures.push(`${d} ${labels[part]}：${message(e)}`);
        }
      };
      // Sources return independently; slow account ownership cannot hold up spend.
      const todayWork = ['daily', 'revenue', 'accounts'].map((p) =>
        fetchPart(date, p as keyof typeof labels),
      );
      const optionsWork = (async () => {
        try {
          const value = await getAdjustmentDay(
            { date, appId, media, part: 'options' },
            controller.signal,
          );
          if (live()) setOptions(value.options);
          if (
            value.options?.state === 'missing' ||
            value.options?.state === 'stale'
          )
            failures.push(`筛选项：${value.options.message || '未完成'}`);
        } catch (e) {
          if (live()) failures.push(`筛选项：${message(e)}`);
        }
      })();
      // Historical cache display must not wait for a slow live Meta check.
      const historyWork = Promise.all(
        adjustmentDates(date)
          .slice(0, 2)
          .flatMap((d) =>
            ['daily', 'revenue'].map((p) =>
              fetchPart(d, p as keyof typeof labels),
            ),
          ),
      );
      await Promise.all([...todayWork, historyWork, optionsWork]);
      if (live()) {
        setError(failures.join('；'));
        setProgress(
          failures.length
            ? '部分数据未完成 · 可手动重试'
            : '今日已加载 · 历史 D0 已补齐（优先使用缓存）',
        );
      }
    } catch (e) {
      if (live()) {
        setError(message(e));
        setProgress('今日汇总加载失败');
      }
    } finally {
      if (live()) {
        setLoading(false);
        active.current = null;
      }
    }
  }, [appId, media, optimizer, country, reset]);

  const loadDetail = useCallback(
    async (campaignId: string) => {
      if (
        !/^\d+$/.test(campaignId) ||
        !appId ||
        !media ||
        children.current.has(campaignId)
      )
        return;
      const existing = detailCache.current[campaignId];
      if (existing?.days.length && !existing.error) return;
      if (children.current.size >= 2) {
        const cache = {
          ...detailCache.current,
          [campaignId]: {
            days: [],
            loading: false,
            error: '已有两个系列正在加载，请稍后点击重试',
          },
        };
        detailCache.current = cache;
        setDetails(cache);
        return;
      }
      const epoch = generation.current;
      const controller = new AbortController();
      children.current.set(campaignId, controller);
      const live = () =>
        generation.current === epoch && !controller.signal.aborted;
      const publish = (value: AdjustmentDetail) => {
        if (!live()) return;
        const cache = { ...detailCache.current };
        delete cache[campaignId];
        cache[campaignId] = value;
        const count = (c: AdjustmentDetail) =>
          c.days.reduce(
            (s, d) =>
              s +
              d.daily.rows.length +
              d.revenue.rows.length +
              d.accounts.rows.length,
            0,
          );
        let rows = Object.values(cache).reduce((n, c) => n + count(c), 0);
        for (const key of Object.keys(cache)) {
          if (Object.keys(cache).length <= 12 && rows <= 50000) break;
          if (key === campaignId || cache[key].loading) continue;
          rows -= count(cache[key]);
          delete cache[key];
        }
        detailCache.current = cache;
        setDetails(cache);
      };
      const result: AdjustmentDay[] = [];
      const failures: string[] = [];
      publish({ days: existing?.days || [], loading: true, error: '' });
      try {
        for (const date of adjustmentDates(today).reverse()) {
          if (!live()) return;
          try {
            const day = await getAdjustmentDay(
              {
                date,
                appId,
                media,
                campaignId,
                optimizer,
                country,
                refresh: date === today ? '1' : undefined,
              },
              controller.signal,
            );
            if (!live()) return;
            result.push(day);
            const issue = incomplete(day);
            if (issue) failures.push(`${date}：${issue}`);
            publish({
              days: [...result],
              loading: true,
              error: failures.join('；'),
            });
          } catch (e) {
            if (live()) failures.push(`${date}：${message(e)}`);
          }
        }
      } finally {
        if (live()) {
          children.current.delete(campaignId);
          publish({ days: result, loading: false, error: failures.join('；') });
        }
      }
    },
    [appId, media, today, optimizer, country],
  );
  useEffect(() => {
    reset();
    setDays([]);
    setLoading(false);
    setError('');
    setProgress('');
    setOptions(undefined);
    setAccountsReady(false);
    activated.current = false;
    return reset;
  }, [appId, media, reset]);
  useEffect(() => {
    // Selecting a server-side slice cancels obsolete work, never relabels old rows.
    if (!activated.current) return;
    reset();
    void load();
    return reset;
  }, [optimizer, country, load, reset]);
  return {
    days,
    today,
    loading,
    error,
    progress,
    details,
    loadDetail,
    options,
    accountsReady,
    cancel: () => {
      reset();
      setLoading(false);
      setProgress('已停止等待，已返回的汇总保留');
      setError('服务器已发出的查询可能仍在完成，不会自动重新抓取。');
    },
    refresh: load,
  };
}
