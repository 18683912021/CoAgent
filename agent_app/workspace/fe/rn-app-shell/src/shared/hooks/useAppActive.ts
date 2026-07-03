import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

/**
 * App 从后台切回前台时触发回调。
 * 常用于刷新数据、检查 Token 过期等。
 */
export function useAppActive(callback: () => void, enabled = true): void {
  const appState = useRef(AppState.currentState);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;

    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        callbackRef.current();
      }
      appState.current = nextState;
    });

    return () => subscription.remove();
  }, [enabled]);
}
