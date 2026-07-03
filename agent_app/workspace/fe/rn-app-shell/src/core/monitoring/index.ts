/**
 * 监控模块 — Sentry 初始化 + 性能追踪
 *
 * 集成 @sentry/react-native，覆盖：
 * - JS 异常自动捕获
 * - Native 崩溃上报
 * - 性能追踪（路由切换、HTTP 请求、用户交互）
 * - 自定义 Breadcrumb
 */

import * as Sentry from '@sentry/react-native';
import { env, isDev } from '@core/config';
import { createLogger } from '@core/logger';

const logger = createLogger('Monitoring');

const routingInstrumentation = new Sentry.ReactNavigationInstrumentation();

/**
 * 初始化 Sentry
 * 必须在 App 入口最早期调用（在 RootLayout useEffect 中）
 */
export function initMonitoring(): void {
  if (!env.SENTRY_DSN) {
    logger.info('Sentry DSN not configured, skipping');
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.APP_ENV,
    debug: isDev,

    // 采样率
    tracesSampleRate: isDev ? 1.0 : 0.2,
    profilesSampleRate: isDev ? 1.0 : 0.1,

    // 路由变化自动创建 Transaction
    integrations: [
      new Sentry.ReactNativeTracing({
        routingInstrumentation,
        tracingOrigins: ['localhost', env.API_BASE_URL],
      }),
    ],

    // 过滤不需要上报的数据
    beforeSend(event) {
      // 开发环境不上报
      if (isDev) return null;
      return event;
    },

    // PII 脱敏
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === 'http') {
        // 过滤敏感 header
        if (breadcrumb.data?.url) {
          breadcrumb.data.url = breadcrumb.data.url.replace(/token=[^&]+/, 'token=***');
        }
      }
      return breadcrumb;
    },

    // 最大 Breadcrumb 数量
    maxBreadcrumbs: 100,
  });

  logger.info('Sentry initialized');
}

/**
 * 手动上报错误
 */
export function captureError(error: Error, context?: Record<string, unknown>): void {
  if (context) {
    Sentry.withScope((scope) => {
      scope.setExtras(context);
      Sentry.captureException(error);
    });
  } else {
    Sentry.captureException(error);
  }
}

/**
 * 手动上报消息
 */
export function captureMessage(message: string, level: Sentry.SeverityLevel = 'info'): void {
  Sentry.captureMessage(message, level);
}

/**
 * 添加 Breadcrumb（用户行为追踪）
 */
export function addBreadcrumb(
  message: string,
  category: string = 'custom',
  data?: Record<string, unknown>,
): void {
  Sentry.addBreadcrumb({
    message,
    category,
    data,
    level: 'info',
  });
}

/**
 * 设置用户信息（登录后调用）
 */
export function setUser(user: { id: string; email?: string; username?: string }): void {
  Sentry.setUser({
    id: user.id,
    email: user.email,
    username: user.username,
  });
}

/**
 * 清除用户信息（登出时调用）
 */
export function clearUser(): void {
  Sentry.setUser(null);
}

// 导出 Sentry 原生 API 和路由 Instrumentation
export { Sentry, routingInstrumentation };
export { withProfiler, withErrorBoundary } from '@sentry/react-native';
