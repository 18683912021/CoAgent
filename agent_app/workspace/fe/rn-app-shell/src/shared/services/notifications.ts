/**
 * Notifications — 推送通知服务
 *
 * 职责：
 * 1. 请求通知权限
 * 2. 获取 Expo Push Token
 * 3. 处理通知点击（前台 + 后台冷启动）
 * 4. 提供全局通知处理器注册
 */

import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { createLogger } from '@core/logger';
import { storage } from '@core/storage';

const logger = createLogger('Notifications');

const PUSH_TOKEN_KEY = 'expo_push_token';
const NOTIFICATION_ENABLED_KEY = 'notification_enabled';

type NotificationHandler = (notification: Notifications.Notification) => void;

let globalHandler: NotificationHandler | null = null;
let isInitialized = false;

// ---- 配置默认通知行为 ----

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ---- 注册推送 ----

/**
 * 初始化推送服务
 * 需在 App 启动时调用一次（RootLayout useEffect 中）
 */
export async function initNotifications(): Promise<string | null> {
  if (isInitialized) {
    logger.debug('Notifications already initialized');
    return null;
  }

  if (!Device.isDevice) {
    logger.warn('Push notifications not available on simulator/emulator');
    return null;
  }

  try {
    // 请求权限
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      logger.warn('Notification permission denied');
      await storage.set(NOTIFICATION_ENABLED_KEY, false);
      return null;
    }

    await storage.set(NOTIFICATION_ENABLED_KEY, true);

    // Android 需要设置 channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: '默认通知',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#1677ff',
      });
    }

    // 获取 Expo Push Token
    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;

    // 缓存 token
    const cachedToken = await storage.get<string>(PUSH_TOKEN_KEY);
    if (cachedToken !== token) {
      await storage.set(PUSH_TOKEN_KEY, token);
      logger.info('Push token updated', { token: token.slice(0, 8) + '...' });
    }

    isInitialized = true;
    return token;
  } catch (error) {
    logger.error('Failed to initialize notifications', error);
    return null;
  }
}

/**
 * 获取缓存的 Push Token
 */
export async function getPushToken(): Promise<string | null> {
  return storage.get<string>(PUSH_TOKEN_KEY);
}

/**
 * 通知是否已启用
 */
export async function isNotificationEnabled(): Promise<boolean> {
  const enabled = await storage.get<boolean>(NOTIFICATION_ENABLED_KEY);
  return enabled ?? false;
}

// ---- 通知点击处理 ----

/**
 * 注册全局通知点击处理器
 *
 * 调用时机：RootLayout 初始化时
 * 支持场景：
 * - 前台收到通知并点击
 * - App 在后台，点击通知唤醒
 * - App 已杀死，点击通知冷启动
 */
export function setNotificationHandler(handler: NotificationHandler): void {
  globalHandler = handler;
}

/**
 * 处理通知响应（点击）
 * 由 RootLayout 中的事件监听器调用
 */
export function handleNotificationResponse(response: Notifications.NotificationResponse): void {
  const { notification } = response;
  logger.info('Notification tapped', {
    title: notification.request.content.title,
    data: notification.request.content.data,
  });

  // 将通知数据持久化（冷启动恢复用）
  storage.set('last_notification', {
    title: notification.request.content.title,
    body: notification.request.content.body,
    data: notification.request.content.data,
    timestamp: Date.now(),
  });

  globalHandler?.(notification);
}

/**
 * 获取最近一次通知数据（冷启动恢复用）
 */
export async function getLastNotification(): Promise<Record<string, unknown> | null> {
  return storage.get<Record<string, unknown>>('last_notification');
}

/**
 * 清除最近通知
 */
export async function clearLastNotification(): Promise<void> {
  await storage.remove('last_notification');
}

// ---- 本地通知 ----

/**
 * 发送本地通知
 */
export async function scheduleLocalNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>,
  seconds?: number,
): Promise<string> {
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: data ?? {},
      sound: true,
    },
    trigger: seconds ? { seconds, type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL } : null,
  });

  return id;
}

/**
 * 取消所有已排期的通知
 */
export async function cancelAllNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}
