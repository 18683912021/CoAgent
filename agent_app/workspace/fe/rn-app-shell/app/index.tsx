import { Redirect } from 'expo-router';
import { useAuthStore } from '@core/auth';

/**
 * 首页路由 — 根据登录态分发
 */
export default function Index(): React.ReactElement {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitializing = useAuthStore((s) => s.isInitializing);

  if (isInitializing) return <></>;

  // 未登录 → 跳转登录页；已登录 → 跳转主页
  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  return <Redirect href="/(tabs)/home" />;
}
