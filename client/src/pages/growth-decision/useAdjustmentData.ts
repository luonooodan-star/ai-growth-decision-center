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

const emptyVerification = () => ({
  cursor: 0 as number | undefined,
  session: undefined as string | undefined,
  owner: undefined as string | undefined,
  failed: new Set<number>(),
  rows: new Map<string, AdjustmentDay['accounts']['rows'][number]>(),
  unverified: {} as Record<string, string>,
});

export function useAdjustmentData(appId: string, media: string) {
  const [days, setDays] = useState<AdjustmentDay[]>([]);
  const [today, setToday] = useState(adjustmentToday);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [details, setDetails] = useState<Record<string, AdjustmentDetail>>({});
  const [options, setOptions] = useState<AdjustmentDay['options']>();
  const [accountsReady, setAccountsReady] = useState(false);
  const verification = useRef(emptyVerification());
  const [accountError, setAccountError] = useState('');
  const [accountStatuses, setAccountStatuses] = useState<
    Record<string, string>
  >({});
  const [checkingAccounts, setCheckingAccounts] = useState(false);
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
  const clearVerification = useCallback(() => {
    verification.current = emptyVerification();
    setAccountsReady(false);
    setAccountStatuses({});
    setAccountError('');
    setDays((old) =>
      old.map((day) =>
        day.accounts.rows.length
          ? {
              ...day,
              accounts: {
                rows: [],
                state: 'missing',
                message: '等待本次个人 Meta 归属核验',
              },
            }
          : day,
      ),
    );
  }, []);
  const verifyAccounts = useCallback(
    async (date: string, signal: AbortSignal, live: () => boolean) => {
      if (media !== 'facebook') return;
      setCheckingAccounts(true);
      setAccountError('');
      const state = verification.current;
      const attempts = [...state.failed];
      let problem = '';
      try {
        while (live() && (attempts.length || state.cursor !== undefined)) {
          const retry = attempts.length > 0;
          const offset = retry ? attempts.shift()! : state.cursor!;
          const value = await getAdjustmentDay(
            {
              date,
              appId,
              media,
              localFilters: '1',
              part: 'accounts',
              accountOffset: String(offset),
              accountSession: state.session,
            },
            signal,
          );
          if (!live()) return;
          const page = value.accounts;
          if (!page.accountSession) {
            if (page.message?.includes('已过期')) {
              clearVerification();
            }
            throw new Error(page.message || '账户核验未完成');
          }
          if (
            state.owner &&
            page.accountOwnerId &&
            state.owner !== page.accountOwnerId
          ) {
            clearVerification();
            throw new Error('Meta 身份已变化，请重新核验');
          }
          state.owner = page.accountOwnerId || state.owner;
          state.session = page.accountSession;
          if (!retry) state.cursor = page.accountNextOffset;
          if (
            page.accountNextOffset !== undefined &&
            page.accountNextOffset <= offset
          )
            throw new Error('账户核验分页未推进');
          const ids = page.accountCampaignIds || [];
          const failed = page.state === 'missing' || page.state === 'stale';
          if (failed || page.rows.length < ids.length) state.failed.add(offset);
          else state.failed.delete(offset);
          if (failed) problem = page.message || 'Meta 核验暂时失败';
          for (const id of ids) {
            state.rows.delete(id);
            state.unverified[id] = failed
              ? '账户核验暂时失败'
              : '当前 Meta 身份未确认访问权限';
          }
          for (const row of page.rows) {
            const id = String(row.campaign_id);
            state.rows.set(id, row);
            delete state.unverified[id];
          }
          setAccountStatuses({ ...state.unverified });
          setAccountsReady(state.rows.size > 0);
          const accounts = {
            ...page,
            state: state.rows.size ? ('fresh' as const) : page.state,
            rows: [...state.rows.values()],
          };
          setDays((old) => {
            const previous = old.find(
              (d) => d.date === date && d.filterable === value.filterable,
            );
            return [
              ...old.filter((d) => d.date !== date),
              { ...(previous || value), accounts },
            ];
          });
        }
      } catch (e) {
        if (live()) problem = message(e);
      } finally {
        if (live()) {
          setCheckingAccounts(false);
          if (state.failed.size || problem)
            setAccountError(
              [
                state.failed.size
                  ? `${state.failed.size} 批账户核验未完整确认`
                  : '',
                problem,
              ]
                .filter(Boolean)
                .join(' · '),
            );
        }
      }
    },
    [appId, media, clearVerification],
  );

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
    clearVerification();
    setProgress('先读取缓存 · 今日数据后台更新…');
    const live = () =>
      epoch === generation.current && !controller.signal.aborted;
    try {
      const failures: string[] = [];
      const done = new Set<string>();
      const labels = { daily: '消耗', revenue: 'D0' };
      const merge = (
        value: AdjustmentDay,
        part: keyof typeof labels,
        cache = false,
      ) => {
        if (!live() || (cache && !value[part].updatedAt)) return;
        if (value.date === date && part === 'daily') setOptions(value.daily);
        setDays((old) => {
          const previous = old.find(
            (d) => d.date === value.date && d.filterable === value.filterable,
          );
          const next = {
            ...(previous || value),
            [part]: value[part],
            timings: { ...previous?.timings, ...value.timings },
          };
          return [...old.filter((d) => d.date !== value.date), next];
        });
      };
      const fetchPart = async (d: string, part: keyof typeof labels) => {
        const query = { date: d, appId, media, localFilters: '1', part };
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
      const todayWork = ['daily', 'revenue'].map((p) =>
        fetchPart(date, p as keyof typeof labels),
      );
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
      await Promise.all([
        ...todayWork,
        historyWork,
        verifyAccounts(date, controller.signal, live),
      ]);
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
  }, [appId, media, reset, verifyAccounts, clearVerification]);

  const retryAccounts = async () => {
    if (active.current) return;
    if (today !== adjustmentToday()) {
      setAccountError('日期已切换，请先抓取今日数据');
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    const live = () => !controller.signal.aborted;
    try {
      await verifyAccounts(today, controller.signal, live);
    } finally {
      if (active.current === controller) active.current = null;
    }
  };

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
                localFilters: '1',
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
    [appId, media, today],
  );
  useEffect(() => {
    reset();
    setDays([]);
    setLoading(false);
    setError('');
    setProgress('');
    setOptions(undefined);
    setAccountsReady(false);
    setCheckingAccounts(false);
    setAccountError('');
    setAccountStatuses({});
    verification.current = emptyVerification();
    return reset;
  }, [appId, media, reset]);
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
    accountError,
    accountStatuses,
    checkingAccounts,
    retryAccounts,
    cancel: () => {
      reset();
      setLoading(false);
      setCheckingAccounts(false);
      setProgress('已停止等待，已返回的汇总保留');
      const state = verification.current;
      if (
        media === 'facebook' &&
        (state.cursor !== undefined || state.failed.size)
      )
        setAccountError('账户核验尚未完成');
      setError('服务器已发出的查询可能仍在完成，不会自动重新抓取。');
    },
    refresh: load,
  };
}
