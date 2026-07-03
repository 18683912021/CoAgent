import { useState, useCallback, useRef } from 'react';
import { httpClient, type PaginatedData, type PaginationParams } from '@core/http/mod';
import { createLogger } from '@core/logger';

const logger = createLogger('usePagination');

interface UsePaginationOptions<T> {
  /** 接口 URL */
  url: string;
  /** 默认每页条数 */
  defaultPageSize?: number;
  /** 额外的查询参数 */
  extraParams?: Record<string, unknown>;
  /** 数据转换 */
  transform?: (data: PaginatedData<T>) => PaginatedData<T>;
}

interface UsePaginationResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  isLoading: boolean;
  isRefreshing: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;

  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  goToPage: (page: number) => Promise<void>;
}

/**
 * 统一分页 Hook
 * 覆盖：列表渲染、下拉刷新、上拉加载更多、跳页
 */
export function usePagination<T>(options: UsePaginationOptions<T>): UsePaginationResult<T> {
  const {
    url,
    defaultPageSize = 20,
    extraParams = {},
    transform,
  } = options;

  const [list, setList] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(defaultPageSize);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const extraParamsRef = useRef(extraParams);
  extraParamsRef.current = extraParams;

  const fetchData = useCallback(
    async (pageNum: number, mode: 'initial' | 'refresh' | 'loadMore') => {
      if (mode === 'initial') setIsLoading(true);
      else if (mode === 'refresh') setIsRefreshing(true);
      else setIsLoadingMore(true);
      setError(null);

      try {
        const params: PaginationParams & Record<string, unknown> = {
          page: pageNum,
          pageSize,
          ...extraParamsRef.current,
        };

        let result = await httpClient.get<PaginatedData<T>>(url, params);
        if (transform) result = transform(result);

        setList((prev) => (mode === 'loadMore' ? [...prev, ...result.list] : result.list));
        setTotal(result.total);
        setPage(result.page);
        setTotalPages(result.totalPages);
      } catch (e) {
        const message = e instanceof Error ? e.message : '加载失败';
        setError(message);
        logger.error('usePagination fetch error', e);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
        setIsLoadingMore(false);
      }
    },
    [url, pageSize, transform],
  );

  const refresh = useCallback(() => fetchData(1, 'refresh'), [fetchData]);
  const loadMore = useCallback(() => {
    if (page < totalPages && !isLoadingMore) {
      fetchData(page + 1, 'loadMore');
    }
  }, [page, totalPages, isLoadingMore, fetchData]);
  const goToPage = useCallback((p: number) => fetchData(p, 'initial'), [fetchData]);

  return {
    list,
    total,
    page,
    pageSize,
    totalPages,
    isLoading,
    isRefreshing,
    isLoadingMore,
    hasMore: page < totalPages,
    error,
    refresh,
    loadMore,
    goToPage,
  };
}
