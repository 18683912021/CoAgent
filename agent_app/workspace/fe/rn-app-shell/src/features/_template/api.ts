/**
 * Feature API 层
 *
 * 所有 HTTP 请求集中在这里，消费 @core/http 的 httpClient。
 */

import { httpClient } from '@core/http';
import type { ApiResponse, FeatureItem, PaginatedResponse } from './types';

export interface ListParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
}

/** 获取列表 */
export async function fetchList(params: ListParams): Promise<PaginatedResponse<FeatureItem>> {
  const res = await httpClient.get<ApiResponse<PaginatedResponse<FeatureItem>>>('/api/feature', { params });
  return res.data;
}

/** 获取详情 */
export async function fetchDetail(id: string): Promise<FeatureItem> {
  const res = await httpClient.get<ApiResponse<FeatureItem>>(`/api/feature/${id}`);
  return res.data;
}

/** 创建 */
export async function createItem(data: Omit<FeatureItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<FeatureItem> {
  const res = await httpClient.post<ApiResponse<FeatureItem>>('/api/feature', data);
  return res.data;
}

/** 更新 */
export async function updateItem(id: string, data: Partial<FeatureItem>): Promise<FeatureItem> {
  const res = await httpClient.put<ApiResponse<FeatureItem>>(`/api/feature/${id}`, data);
  return res.data;
}

/** 删除 */
export async function deleteItem(id: string): Promise<void> {
  await httpClient.delete(`/api/feature/${id}`);
}
