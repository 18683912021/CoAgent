/**
 * AudioCapture Expo Config Plugin
 *
 * 注入必要的 Android 权限和 iOS 配置。
 * 在 app.config.ts 的 plugins 数组中引用。
 */
const withAudioCapture = (config) => {
  // Android 权限 & SDK 版本
  if (!config.android) config.android = {};
  if (!config.android.permissions) config.android.permissions = [];

  // AudioPlaybackCapture API 硬需求，覆盖 Expo 默认的 minSdk 24
  config.android.minSdkVersion = 29;

  const androidPermissions = [
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
    'android.permission.RECORD_AUDIO',
  ];

  for (const perm of androidPermissions) {
    if (!config.android.permissions.includes(perm)) {
      config.android.permissions.push(perm);
    }
  }

  // iOS 权限
  if (!config.ios) config.ios = {};
  if (!config.ios.infoPlist) config.ios.infoPlist = {};

  config.ios.infoPlist = {
    ...config.ios.infoPlist,
    NSMicrophoneUsageDescription:
      'AudioCapture PoC 需要麦克风权限以验证系统音频采集管道',
    UIBackgroundModes: [
      ...(config.ios.infoPlist.UIBackgroundModes ?? []),
      'audio',
    ],
  };

  return config;
};

module.exports = withAudioCapture;
