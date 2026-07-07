import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useCallback } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';

import { ErrorBoundary, initMonitoring } from '@core/index';
import { useAuthStore } from '@core/auth';
import { initI18n } from '@i18n/index';
import { ToastRoot } from '@shared/components/ToastRoot';
import { initNotifications, setNotificationHandler, handleNotificationResponse } from '@shared/services/notifications';
import { setDeepLinkHandler, handleDeepLink } from '@shared/utils/deepLink';

// 阻止 Splash Screen 自动消失——我们手动控制时机
SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * 根布局 — Expo Router 自动读取此文件作为 App 入口
 */
export default function RootLayout(): React.ReactElement {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const initialize = useAuthStore((s) => s.initialize);
  const isInitializing = useAuthStore((s) => s.isInitializing);

  // 初始化完成后隐藏 Splash Screen
  const onInitComplete = useCallback(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    // 1. Sentry
    initMonitoring();

    // 2. i18n + 登录态
    initI18n();
    initialize().finally(onInitComplete);

    // 3. 推送（独立于登录态，fire-and-forget）
    initNotifications().then((token) => {
      if (token) {
        // TODO: 将 token 上报到后端
      }
    });

    // 4. 通知点击处理器
    setNotificationHandler((notification) => {
      const data = notification.request.content.data as Record<string, string> | undefined;
      if (data?.route) {
        router.push(data.route as any);
      }
    });

    // 5. Deep Link 处理器
    setDeepLinkHandler((path, _params) => {
      if (path.startsWith('/')) {
        router.push(path as any);
      }
    });
  }, [initialize, router, onInitComplete]);

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

  // 初始化中渲染空白——Splash Screen 还在上面，用户看不到
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
        <ToastRoot />
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
