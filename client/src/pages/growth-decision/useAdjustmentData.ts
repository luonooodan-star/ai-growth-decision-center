import { useCallback, useEffect, useRef, useState } from 'react';
import { getAdjustmentDay } from '@/api/paid-growth';
import {
  ADJUSTMENT_REFRESH_MS,
  type AdjustmentDay,
} from '@shared/ad-adjustment.interface';
import { adjustmentDates, adjustmentToday } from '@shared/ad-adjustment';

export function useAdjustmentData(appId: string, media: string) {
  const [days, setDays] = useState<AdjustmentDay[]>([]);
  const [today, setToday] = useState(adjustmentToday);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [nextAt, setNextAt] = useState<number | null>(null);
  const active = useRef<AbortController | null>(null);
  const due = useRef(0);
  const load = useCallback(
    async (refresh = false) => {
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      const date = adjustmentToday();
      setToday(date);
      setLoading(true);
      setError('');
      due.current = Date.now() + ADJUSTMENT_REFRESH_MS;
      try {
        // Current day first. Sequential queries bound Doris concurrency and memory.
        const results: AdjustmentDay[] = [];
        for (const d of adjustmentDates(date).reverse()) {
          setProgress(`正在读取 ${d}`);
          const value = await getAdjustmentDay(
            {
              date: d,
              appId: appId || undefined,
              media: media || undefined,
              refresh: refresh ? '1' : undefined,
            },
            controller.signal,
          );
          if (controller.signal.aborted) return;
          results.push(value);
          setDays([...results]);
        }
        const stamps = results
          .flatMap((d) => [d.daily, d.revenue])
          .map((p) => Date.parse(p.updatedAt || ''))
          .filter(Number.isFinite);
        // Failed/stale fragments wait for the next 4h cycle (or an explicit refresh), no retry storm.
        const failed = results.some((d) =>
          [d.daily, d.revenue].some((p) =>
            ['stale', 'missing'].includes(p.state),
          ),
        );
        due.current =
          failed || !stamps.length
            ? Date.now() + ADJUSTMENT_REFRESH_MS
            : Math.min(...stamps) + ADJUSTMENT_REFRESH_MS;
        setNextAt(due.current);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : '读取失败，请手动刷新');
          setNextAt(due.current);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setProgress('');
          active.current = null;
        }
      }
    },
    [appId, media],
  );
  useEffect(() => {
    setDays([]);
    setNextAt(null);
    void load();
    return () => active.current?.abort();
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (active.current) return;
      // Shanghai midnight always advances the view, even before the 4h cache expires.
      if (adjustmentToday() !== today || Date.now() >= due.current) void load();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [load, today]);
  return {
    days,
    today,
    loading,
    error,
    progress,
    nextAt,
    refresh: () => load(true),
  };
}
