import axios from 'axios';
import type { BiDay, BiProduct, BiQuery } from '@shared/paid-growth.interface';
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
export const getBiProducts = async (): Promise<BiProduct[]> =>
  (
    await axios.get<BiProduct[]>('/api/growth-decision/bi/products', {
      timeout: 120000,
    })
  ).data;
export const syncBiProducts = async (): Promise<BiProduct[]> =>
  (
    await axios.post<BiProduct[]>(
      '/api/growth-decision/bi/products/sync',
      {},
      { timeout: 120000 },
    )
  ).data;
