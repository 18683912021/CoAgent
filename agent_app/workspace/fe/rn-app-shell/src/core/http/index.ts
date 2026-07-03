import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import { env } from '@core/config';
import { createLogger } from '@core/logger';
import { storage } from '@core/storage';
import type { ApiResponse } from './types';

const logger = createLogger('HttpClient');

const TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

// 全局刷新锁：防止并发请求同时刷新 Token
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

function processQueue(error: unknown, token: string | null = null): void {
  failedQueue.forEach((promise) => {
    if (error) {
      promise.reject(error);
    } else {
      promise.resolve(token!);
    }
  });
  failedQueue = [];
}

class HttpClient {
  private instance: AxiosInstance;

  constructor() {
    this.instance = axios.create({
      baseURL: env.API_BASE_URL,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // 请求拦截器 — 自动挂 Token
    this.instance.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        const token = await storage.get<string>(TOKEN_KEY);
        if (token && config.headers) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        logger.debug(`[${config.method?.toUpperCase()}] ${config.url}`);
        return config;
      },
      (error) => Promise.reject(error),
    );

    // 响应拦截器 — 统一错误处理 + Token 刷新
    this.instance.interceptors.response.use(
      (response: AxiosResponse<ApiResponse>) => {
        // 业务码非 0 视为业务异常
        if (response.data.code !== 0 && response.data.code !== 200) {
          logger.warn(`Business error: ${response.data.code} ${response.data.message}`);
          return Promise.reject(new BusinessError(response.data.code, response.data.message));
        }
        return response;
      },
      async (error: AxiosError<ApiResponse>) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & {
          _retry?: boolean;
        };

        // 401 — 尝试刷新 Token
        if (error.response?.status === 401 && !originalRequest._retry) {
          if (isRefreshing) {
            // 已有刷新进行中，排队等待
            return new Promise<AxiosResponse>((resolve, reject) => {
              failedQueue.push({
                resolve: (token: string) => {
                  if (originalRequest.headers) {
                    originalRequest.headers.Authorization = `Bearer ${token}`;
                  }
                  resolve(this.instance(originalRequest));
                },
                reject,
              });
            });
          }

          originalRequest._retry = true;
          isRefreshing = true;

          try {
            const refreshToken = await storage.get<string>(REFRESH_TOKEN_KEY);
            if (!refreshToken) {
              throw new Error('No refresh token');
            }

            // 调用刷新接口
            const { data } = await axios.post<ApiResponse<{ accessToken: string; refreshToken: string }>>(
              `${env.API_BASE_URL}/auth/refresh`,
              { refreshToken },
            );

            const newAccessToken = data.data.accessToken;
            const newRefreshToken = data.data.refreshToken;

            await storage.set(TOKEN_KEY, newAccessToken);
            await storage.set(REFRESH_TOKEN_KEY, newRefreshToken);

            processQueue(null, newAccessToken);

            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
            }
            return this.instance(originalRequest);
          } catch (refreshError) {
            processQueue(refreshError, null);
            // Token 刷新失败 — 清除登录态
            await storage.remove(TOKEN_KEY);
            await storage.remove(REFRESH_TOKEN_KEY);
            // TODO: 触发全局登出事件
            throw refreshError;
          } finally {
            isRefreshing = false;
          }
        }

        // 网络错误
        if (!error.response) {
          logger.error('Network error', error.message);
          return Promise.reject(new NetworkError('网络连接失败，请检查网络'));
        }

        // HTTP 错误（非 401）
        const httpError = new HttpError(
          error.response.status,
          error.response.data?.message || '请求失败',
        );
        logger.error(`HTTP ${error.response.status}`, httpError);
        return Promise.reject(httpError);
      },
    );
  }

  async get<T>(url: string, params?: Record<string, unknown>, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.get<ApiResponse<T>>(url, { ...config, params });
    return response.data.data;
  }

  async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.post<ApiResponse<T>>(url, data, config);
    return response.data.data;
  }

  async put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.put<ApiResponse<T>>(url, data, config);
    return response.data.data;
  }

  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.delete<ApiResponse<T>>(url, config);
    return response.data.data;
  }

  // 文件上传专用
  async upload<T>(url: string, formData: FormData, onProgress?: (percent: number) => void): Promise<T> {
    const response = await this.instance.post<ApiResponse<T>>(url, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (event) => {
        if (event.total && onProgress) {
          onProgress(Math.round((event.loaded * 100) / event.total));
        }
      },
    });
    return response.data.data;
  }
}

// 自定义错误类
export class BusinessError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = 'BusinessError';
    this.code = code;
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export const httpClient = new HttpClient();
