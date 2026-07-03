/**
 * useFeatureList — 列表数据 Hook
 *
 * 基于 TanStack Query，自动管理缓存、分页、刷新。
 */

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { fetchList, fetchDetail, type ListParams } from '../api';
import type { FeatureItem } from '../types';
import { PAGE_SIZE } from '../constants';

/** 无限滚动列表 */
export function useFeatureList(params: Omit<ListParams, 'page'>) {
  return useInfiniteQuery({
    queryKey: ['feature-list', params],
    queryFn: ({ pageParam = 1 }) =>
      fetchList({ ...params, page: pageParam as number, pageSize: PAGE_SIZE }),
    getNextPageParam: (lastPage) => {
      if (lastPage.page < lastPage.totalPages) {
        return lastPage.page + 1;
      }
      return undefined;
    },
    initialPageParam: 1,
    staleTime: 30_000, // 30s 内不重新请求
  });
}

/** 详情 */
export function useFeatureDetail(id: string | undefined) {
  return useQuery<FeatureItem>({
    queryKey: ['feature-detail', id],
    queryFn: () => fetchDetail(id!),
    enabled: !!id,
    staleTime: 60_000,
  });
}
