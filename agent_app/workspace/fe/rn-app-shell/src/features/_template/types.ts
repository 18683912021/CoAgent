/**
 * Feature 数据类型
 */

export interface FeatureItem {
  id: string;
  title: string;
  description?: string;
  status: 'active' | 'inactive' | 'archived';
  createdAt: string;
  updatedAt: string;
}

/** API 返回的通用分页结构 */
export interface PaginatedResponse<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** API 通用响应包装 */
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}
