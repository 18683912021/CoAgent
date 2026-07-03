/**
 * Toast 轻提示（全局单例）
 *
 * 使用方式：
 *   import { toast } from '@shared/components/Toast';
 *   toast.show('操作成功');
 *   toast.show('网络错误', 'error');
 *
 * 注意：需要在 App 顶层渲染 <ToastRoot /> 来挂载 Toast 容器。
 * 目前先导出 API，UI 容器在 app 入口中挂载。
 */

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastOptions {
  type?: ToastType;
  duration?: number;
}

type ToastListener = (message: string, options: ToastOptions) => void;

let listener: ToastListener | null = null;

export const toast = {
  show(message: string, typeOrOptions?: ToastType | ToastOptions): void {
    if (!listener) {
      console.warn('[Toast] No listener registered. Did you mount <ToastRoot />?');
      return;
    }

    const options: ToastOptions =
      typeof typeOrOptions === 'string'
        ? { type: typeOrOptions }
        : (typeOrOptions ?? {});

    listener(message, { type: 'info', duration: 2000, ...options });
  },

  success(message: string, duration?: number): void {
    this.show(message, { type: 'success', duration });
  },

  error(message: string, duration?: number): void {
    this.show(message, { type: 'error', duration: duration ?? 3000 });
  },

  info(message: string, duration?: number): void {
    this.show(message, { type: 'info', duration });
  },

  /** 注册监听器（由 ToastRoot 调用） */
  _setListener(fn: ToastListener): void {
    listener = fn;
  },

  /** 注销监听器 */
  _removeListener(): void {
    listener = null;
  },
};
