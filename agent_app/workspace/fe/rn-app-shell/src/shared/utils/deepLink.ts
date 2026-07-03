import { createLogger } from '@core/logger';
import { storage } from '@core/storage';

const logger = createLogger('DeepLink');

type DeepLinkHandler = (url: string, params: Record<string, string>) => void;

let handler: DeepLinkHandler | null = null;

/**
 * 注册全局 Deep Link 处理器
 */
export function setDeepLinkHandler(fn: DeepLinkHandler): void {
  handler = fn;
}

/**
 * 解析并处理 Deep Link URL
 *
 * 支持格式：
 * - rnappshell://user/123
 * - rnappshell://order?id=456
 * - https://app.example.com/user/123
 */
export function handleDeepLink(url: string): void {
  if (!url) return;

  logger.info('Deep link received', { url });

  // 提取路径和参数
  let path = url;
  let queryString = '';

  if (url.includes('?')) {
    [path, queryString] = url.split('?');
  }

  // 去掉 scheme 前缀
  path = path.replace(/^rnappshell:\/\//, '').replace(/^https?:\/\/[^/]+/, '');

  // 解析参数
  const params: Record<string, string> = {};
  if (queryString) {
    queryString.split('&').forEach((pair) => {
      const [key, val] = pair.split('=');
      if (key) params[decodeURIComponent(key)] = decodeURIComponent(val ?? '');
    });
  }

  // 持久化最近一次 Deep Link（用于冷启动时恢复）
  storage.set('last_deep_link', { url, path, params, timestamp: Date.now() });

  handler?.(path, params);
}
