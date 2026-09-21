import { useCallback, useEffect, useRef, useState } from 'react';
import { getAdjustmentDay } from '@/api/paid-growth';
import type { AdjustmentDay } from '@shared/ad-adjustment.interface';
import { adjustmentDates, adjustmentToday } from '@shared/ad-adjustment';

export function useAdjustmentData(appId: string, media: string) {
  const [days, setDays] = useState<AdjustmentDay[]>([]);
  const [today, setToday] = useState(adjustmentToday);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const active = useRef<AbortController | null>(null);
  const load = useCallback(
    async (refresh = false) => {
      if (active.current || !appId || !media) return;
      const controller = new AbortController();
      active.current = controller;
      const date = adjustmentToday();
      setToday(date);
      setLoading(true);
      setError('');
      setDays([]);
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
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : '读取失败，请手动刷新');
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
    setLoading(false);
    setError('');
    setProgress('');
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [load]);
  return {
    days,
    today,
    loading,
    error,
    progress,
    cancel: () => {
      active.current?.abort();
      active.current = null;
      setLoading(false);
      setProgress('');
      setError(
        '已停止等待。服务器已发出的查询可能仍在完成，不会自动重新抓取。',
      );
    },
    refresh: () => load(true),
  };
}
