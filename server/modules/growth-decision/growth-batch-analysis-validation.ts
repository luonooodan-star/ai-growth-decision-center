import { BadRequestException } from '@nestjs/common';

import type {
  CompleteGrowthMavisBatchJobRequest,
  GrowthMavisJob,
} from '@shared/api.interface';

interface BatchAnalysisCoverage {
  duplicateIds: string[];
  expectedCount: number;
  missingIds: string[];
  receivedCount: number;
  unknownIds: string[];
}

function normalizedId(value: string | undefined): string {
  return value?.trim() || '';
}

export function validateBatchAnalysisCoverage(
  job: GrowthMavisJob,
  analyses: CompleteGrowthMavisBatchJobRequest['analyses'],
): void {
  if (job.jobType !== 'batch_anomaly_assessment') {
    throw new BadRequestException(
      `任务 ${job.id} 不是整批分析任务（实际类型：${job.jobType}）`,
    );
  }

  const sourceExpectedIds: string[] =
    job.judgmentIds && job.judgmentIds.length > 0
      ? job.judgmentIds
      : [job.judgmentId];
  const expectedIds: string[] = sourceExpectedIds
    .map(normalizedId)
    .filter(Boolean);
  const receivedIds: string[] = analyses
    .map((item): string => normalizedId(item.judgmentId))
    .filter(Boolean);
  const expectedSet = new Set(expectedIds);
  const receivedSet = new Set(receivedIds);
  const counts = new Map<string, number>();
  receivedIds.forEach((id: string): void => {
    counts.set(id, (counts.get(id) || 0) + 1);
  });

  const coverage: BatchAnalysisCoverage = {
    duplicateIds: Array.from(counts.entries())
      .filter(([, count]: [string, number]): boolean => count > 1)
      .map(([id]: [string, number]): string => id),
    expectedCount: expectedSet.size,
    missingIds: Array.from(expectedSet).filter(
      (id: string): boolean => !receivedSet.has(id),
    ),
    receivedCount: receivedIds.length,
    unknownIds: Array.from(receivedSet).filter(
      (id: string): boolean => !expectedSet.has(id),
    ),
  };

  if (
    coverage.expectedCount !== coverage.receivedCount ||
    coverage.missingIds.length > 0 ||
    coverage.unknownIds.length > 0 ||
    coverage.duplicateIds.length > 0
  ) {
    throw new BadRequestException(
      `整批分析覆盖不完整：期望 ${coverage.expectedCount} 条，收到 ${coverage.receivedCount} 条；` +
        `缺失 ID=${JSON.stringify(coverage.missingIds)}；` +
        `未知 ID=${JSON.stringify(coverage.unknownIds)}；` +
        `重复 ID=${JSON.stringify(coverage.duplicateIds)}`,
    );
  }

  analyses.forEach((item): void => {
    item.judgmentId = normalizedId(item.judgmentId);
  });
}
