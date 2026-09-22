import axios from 'axios';
import type {
  MetaAdjustmentChange,
  MetaAdjustmentJob,
  MetaAdjustmentSnapshot,
  MetaAdjustmentTarget,
} from '@shared/api.interface';
const base = '/api/growth-decision/adjustments';
export const inspectAdjustment = async (
  target: MetaAdjustmentTarget,
  creative: boolean,
) =>
  (
    await axios.post<MetaAdjustmentSnapshot[]>(
      `${base}/inspect`,
      { target, creative },
      { timeout: 60000 },
    )
  ).data;
export const previewAdjustments = async (changes: MetaAdjustmentChange[]) =>
  (
    await axios.post<MetaAdjustmentJob>(
      `${base}/preview`,
      { changes },
      { timeout: 300000 },
    )
  ).data;
export const submitAdjustments = async (id: string) =>
  (
    await axios.post<MetaAdjustmentJob>(
      `${base}/${encodeURIComponent(id)}/submit`,
      { confirmed: true },
      { timeout: 60000 },
    )
  ).data;
export const listAdjustments = async () =>
  (await axios.get<MetaAdjustmentJob[]>(base, { timeout: 60000 })).data;
export function adjustmentError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const message =
      error.response?.data?.message || error.response?.data?.error?.message;
    if (typeof message === 'string') return message;
    if (!error.response)
      return '未收到决策中心响应，请检查服务或本机 Meta 桥连接；若已提交，请先查任务记录核对结果，勿重复操作';
  }
  return error instanceof Error ? error.message : '操作失败';
}
