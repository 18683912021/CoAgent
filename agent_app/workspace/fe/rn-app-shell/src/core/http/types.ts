/**
 * 统一的 API 响应结构
 * 业务层只需 import 这个类型，后端返回什么就以什么为准
 */
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

/** 分页请求参数 */
export interface PaginationParams {
  page: number;
  pageSize: number;
}

/** 分页响应 */
export interface PaginatedData<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** 通用 ID 参数 */
export interface IdParam {
  id: string | number;
}
