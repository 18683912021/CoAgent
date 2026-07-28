/**
 * API 请求基础层 —— 统一超时、错误处理、JSON 解析。
 *
 * 所有 API 模块通过此 client 发请求，后期改鉴权、加拦截器只改这里。
 */

import {API_BASE} from '../config';

const DEFAULT_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
    this.name = 'ApiError';
  }
}

async function request<T = any>(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body ? {'Content-Type': 'application/json'} : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new ApiError(res.status, data.detail || `请求失败 (${res.status})`);
    }

    return data as T;
  } catch (err: unknown) {
    if (err instanceof ApiError) { throw err; }
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError(0, '请求超时，请检查网络');
    }
    throw new ApiError(0, '网络错误，请检查网络连接');
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body?: Record<string, unknown>) =>
    request<T>('POST', path, body),
  upload: <T = any>(path: string, formData: FormData) => {
    // 上传不设 Content-Type，让浏览器自动带 boundary
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    return fetch(`${API_BASE}${path}`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    }).then(async res => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new ApiError(res.status, data.detail || '上传失败');
      }
      return data as T;
    }).finally(() => clearTimeout(timer));
  },
};
