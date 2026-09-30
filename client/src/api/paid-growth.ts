import axios from 'axios';
import type {
  BiDay,
  BiPart,
  BiProduct,
  BiQuery,
} from '@shared/paid-growth.interface';
import type { AdjustmentDay, AdjustmentQuery } from '@shared/api.interface';
import type { MetricStandardProduct } from '@shared/metric-signals';
export const getAdjustmentDay = async (
  query: AdjustmentQuery,
  signal?: AbortSignal,
): Promise<AdjustmentDay> =>
  (
    await axios.get<AdjustmentDay>('/api/growth-decision/bi/adjustment-day', {
      params: query,
      signal,
      timeout: 420000,
    })
  ).data;
export const getBiStandards = async (): Promise<MetricStandardProduct[]> =>
  (
    await axios.get<MetricStandardProduct[]>(
      '/api/growth-decision/bi/standards',
    )
  ).data;
export const getBiDay = async (
  query: BiQuery,
  signal?: AbortSignal,
): Promise<BiDay> =>
  (
    await axios.get<BiDay>('/api/growth-decision/bi/day', {
      params: query,
      signal,
      timeout: 180000,
    })
  ).data;
export const getBiChannelSpend = async (
  date: string,
  appId: string,
  signal?: AbortSignal,
): Promise<BiPart> =>
  (
    await axios.get<BiPart>('/api/growth-decision/bi/channel-spend', {
      params: { date, appId },
      signal,
      timeout: 180000,
    })
  ).data;
export const getBiProducts = async (): Promise<BiProduct[]> =>
  (
    await axios.get<BiProduct[]>('/api/growth-decision/bi/products', {
      timeout: 120000,
    })
  ).data;
export const getBiProductOptions = async (): Promise<BiProduct[]> =>
  (await axios.get<BiProduct[]>('/api/growth-decision/bi/products/options'))
    .data;
export const syncBiProducts = async (): Promise<BiProduct[]> =>
  (
    await axios.post<BiProduct[]>(
      '/api/growth-decision/bi/products/sync',
      {},
      { timeout: 120000 },
    )
  ).data;
