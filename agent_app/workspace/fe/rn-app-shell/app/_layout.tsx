import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';

import { ErrorBoundary, initMonitoring } from '@core/index';
import { useAuthStore } from '@core/auth';
import { initI18n } from '@i18n/index';
import { ToastRoot } from '@shared/components/ToastRoot';
import { initNotifications, setNotificationHandler, handleNotificationResponse } from '@shared/services/notifications';
import { setDeepLinkHandler, handleDeepLink } from '@shared/utils/deepLink';

/**
 * 根布局 — Expo Router 自动读取此文件作为 App 入口
 *
 * 职责：
 * 1. 初始化 Sentry 监控
 * 2. 初始化 i18n
 * 3. 恢复登录态
 * 4. 初始化推送通知
 * 5. 注册 Deep Link 处理器
 * 6. 提供全局 ErrorBoundary
 * 7. 挂载 ToastRoot
 * 8. 配置 Stack 导航器全局样式
 */
export default function RootLayout(): React.ReactElement {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const initialize = useAuthStore((s) => s.initialize);
  const isInitializing = useAuthStore((s) => s.isInitializing);

  useEffect(() => {
    // 1. Sentry 初始化 — 必须最先执行
    initMonitoring();

    // 2. i18n + 登录态
    initI18n();
    initialize();

    // 3. 推送初始化
    initNotifications().then((token) => {
      if (token) {
        // TODO: 将 token 上报到后端
      }
    });

    // 4. 注册通知点击处理器
    setNotificationHandler((notification) => {
      const data = notification.request.content.data as Record<string, string> | undefined;
      if (data?.route) {
        router.push(data.route as any);
      }
    });

    // 5. 注册 Deep Link 处理器
    setDeepLinkHandler((path, params) => {
      if (path.startsWith('/')) {
        router.push(path as any);
      }
    });
  }, [initialize, router]);

  // ---- 通知点击监听 ----
  useEffect(() => {
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        handleNotificationResponse(response);
      }
    });

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotificationResponse(response);
    });

    return () => subscription.remove();
  }, []);

  // ---- Deep Link 监听 ----
  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink(url);
    });

    const subscription = Linking.addEventListener('url', (event) => {
      handleDeepLink(event.url);
    });

    return () => subscription.remove();
  }, []);

  // 初始化中保持 splash screen
  if (isInitializing) {
    return <></>;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
            contentStyle: {
              backgroundColor: colorScheme === 'dark' ? '#0a0a0a' : '#f5f5f5',
            },
          }}
        />
        {/* Toast 必须挂在最顶层，在 Stack 外面 */}
        <ToastRoot />
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
