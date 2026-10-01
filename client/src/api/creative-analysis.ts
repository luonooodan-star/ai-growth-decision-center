import axios from 'axios';
import type {
  CreativeAnalysisJob,
  CreativeAnalysisQuery,
} from '@shared/creative-analysis.interface';

const base = '/api/growth-decision/analysis/query';
export const startCreativeAnalysis = async (
  query: CreativeAnalysisQuery,
  signal?: AbortSignal,
) =>
  (
    await axios.post<CreativeAnalysisJob>(base, query, {
      timeout: 15000,
      signal,
    })
  ).data;
export const getCreativeAnalysis = async (id: string, signal?: AbortSignal) =>
  (
    await axios.get<CreativeAnalysisJob>(`${base}/${encodeURIComponent(id)}`, {
      timeout: 15000,
      signal,
    })
  ).data;
export const cancelCreativeAnalysis = async (id: string) =>
  (
    await axios.delete<CreativeAnalysisJob>(
      `${base}/${encodeURIComponent(id)}`,
      { timeout: 15000 },
    )
  ).data;
