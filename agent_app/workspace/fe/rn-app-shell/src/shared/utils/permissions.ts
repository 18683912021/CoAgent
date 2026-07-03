import { Platform, PermissionsAndroid, Alert, Linking } from 'react-native';
import { createLogger } from '@core/logger';

const logger = createLogger('Permissions');

export type PermissionType = 'camera' | 'photo' | 'location' | 'notification' | 'storage';

const androidPermissionMap: Record<PermissionType, string> = {
  camera: 'android.permission.CAMERA',
  photo: 'android.permission.READ_MEDIA_IMAGES',
  location: 'android.permission.ACCESS_FINE_LOCATION',
  notification: 'android.permission.POST_NOTIFICATIONS',
  storage: 'android.permission.READ_EXTERNAL_STORAGE',
};

/**
 * 请求 Android 权限
 */
async function requestAndroidPermission(type: PermissionType): Promise<boolean> {
  const permission = androidPermissionMap[type];
  if (!permission) return true;

  try {
    const result = await PermissionsAndroid.request(permission as any, {
      title: `${type} 权限`,
      message: `AppShell 需要访问您的${type}权限以提供完整功能`,
      buttonPositive: '允许',
      buttonNegative: '拒绝',
    });

    if (result === PermissionsAndroid.RESULTS.GRANTED) {
      return true;
    }

    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      Alert.alert('权限被拒绝', `请在系统设置中允许 AppShell 的${type}权限`, [
        { text: '取消', style: 'cancel' },
        { text: '去设置', onPress: () => Linking.openSettings() },
      ]);
    }

    return false;
  } catch (error) {
    logger.error(`Android permission request failed: ${type}`, error);
    return false;
  }
}

/**
 * 统一权限请求入口
 *
 * iOS 的权限在 Info.plist 中声明，运行时由系统自动弹出。
 * Android 需要动态请求。
 */
export async function requestPermission(type: PermissionType): Promise<boolean> {
  if (Platform.OS === 'ios') {
    // iOS: 各类型权限需通过对应原生模块请求（expo-camera / expo-image-picker 等）
    // 这里返回 true，由具体 Feature 自行处理 iOS 权限
    return true;
  }

  return requestAndroidPermission(type);
}

/**
 * 批量请求权限
 */
export async function requestPermissions(types: PermissionType[]): Promise<Record<PermissionType, boolean>> {
  const results: Partial<Record<PermissionType, boolean>> = {};

  for (const type of types) {
    results[type] = await requestPermission(type);
  }

  return results as Record<PermissionType, boolean>;
}
