import axios from 'axios';
import type {
  MetaOperationOverview,
  MetaAdEntity,
} from '@shared/api.interface';

export async function getMetaOperations(
  page = 1,
): Promise<MetaOperationOverview> {
  return (
    await axios.get<MetaOperationOverview>(
      '/api/growth-decision/meta-operations',
      { params: { page } },
    )
  ).data;
}
export async function getMetaEntities(): Promise<MetaAdEntity[]> {
  return (
    await axios.get<MetaAdEntity[]>(
      '/api/growth-decision/meta-operations/entities',
    )
  ).data;
}
