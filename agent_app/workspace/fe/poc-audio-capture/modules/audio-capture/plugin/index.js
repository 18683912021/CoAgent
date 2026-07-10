const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * AudioCapture Expo Config Plugin
 *
 * 注入必要的 Android 权限、前台服务声明（Android 14+ MediaProjection 要求）
 * 和 iOS 配置。
 */
const withAudioCapture = (config) => {
  // ── Android Manifest：注册 MediaProjectionService ──
  config = withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;

    // 确保 application 数组存在
    const applications = manifest.application;
    if (!applications || applications.length === 0) {
      // 正常情况下 expo prebuild 会生成，这里兜底
      manifest.application = [{ $: {}, service: [] }];
    }

    const app = manifest.application[0];

    // 确保 service 数组存在
    if (!app.service) {
      app.service = [];
    }

    // 检查是否已注册（幂等）
    const already = app.service.some(
      (s) => s?.$?.['android:name'] === 'expo.modules.audiocapture.MediaProjectionService'
    );

    if (!already) {
      app.service.push({
        $: {
          'android:name': 'expo.modules.audiocapture.MediaProjectionService',
          'android:foregroundServiceType': 'mediaProjection',
          'android:exported': 'false',
        },
      });
    }

    return modConfig;
  });

  // ── Android 权限 ──
  if (!config.android) config.android = {};
  if (!config.android.permissions) config.android.permissions = [];

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

  // ── iOS ──
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
