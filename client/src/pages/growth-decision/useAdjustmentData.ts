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

export function useAdjustmentData(appId: string, media: string) {
  const [days, setDays] = useState<AdjustmentDay[]>([]);
  const [today, setToday] = useState(adjustmentToday);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [details, setDetails] = useState<Record<string, AdjustmentDetail>>({});
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
    setDays([]);
    setProgress('正在抓取今日广告系列汇总…');
    const live = () =>
      epoch === generation.current && !controller.signal.aborted;
    try {
      const current = await getAdjustmentDay(
        { date, appId, media, refresh: '1' },
        controller.signal,
      );
      if (!live()) return;
      setDays([current]);
      const warning = incomplete(current);
      setProgress(
        warning
          ? '今日汇总部分返回 · 历史 D0 补充中…'
          : '今日已加载 · 历史 D0 补充中…',
      );
      const failures: string[] = warning ? [`今天：${warning}`] : [];
      await Promise.all(
        adjustmentDates(date)
          .slice(0, 2)
          .map(async (d) => {
            try {
              const value = await getAdjustmentDay(
                { date: d, appId, media },
                controller.signal,
              );
              if (!live()) return;
              setDays((old) => [...old.filter((v) => v.date !== d), value]);
              const issue = incomplete(value);
              if (issue) failures.push(`${d}：${issue}`);
            } catch (e) {
              if (live()) failures.push(`${d}：${message(e)}`);
            }
          }),
      );
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
  }, [appId, media, reset]);

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
    cancel: () => {
      reset();
      setLoading(false);
      setProgress('已停止等待，已返回的汇总保留');
      setError('服务器已发出的查询可能仍在完成，不会自动重新抓取。');
    },
    refresh: load,
  };
}
