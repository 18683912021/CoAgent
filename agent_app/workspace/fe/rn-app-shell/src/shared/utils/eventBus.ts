/**
 * 全局事件总线 — 轻量 pub/sub
 *
 * 用于跨模块通信（HTTP → Auth、推送 → 导航等），
 * 避免循环依赖。
 */

type EventHandler = (...args: any[]) => void;

const listeners = new Map<string, Set<EventHandler>>();

export const eventBus = {
  /** 订阅事件 */
  on(event: string, handler: EventHandler): () => void {
    if (!listeners.has(event)) {
      listeners.set(event, new Set());
    }
    listeners.get(event)!.add(handler);

    // 返回取消订阅函数
    return () => {
      listeners.get(event)?.delete(handler);
    };
  },

  /** 触发事件 */
  emit(event: string, ...args: any[]): void {
    listeners.get(event)?.forEach((handler) => {
      try {
        handler(...args);
      } catch (e) {
        console.error(`[EventBus] Error handling "${event}":`, e);
      }
    });
  },

  /** 取消所有订阅（用于测试清理） */
  clear(): void {
    listeners.clear();
  },
};

// ---- 事件名常量 ----

export const EventNames = {
  /** Token 刷新失败，需全局登出 */
  FORCE_LOGOUT: 'auth:force-logout',
  /** Token 已刷新，通知其他模块 */
  TOKEN_REFRESHED: 'auth:token-refreshed',
} as const;
