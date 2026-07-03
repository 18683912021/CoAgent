import type { ExpoConfig } from '@expo/config-types';

type EnvType = 'development' | 'testing' | 'staging' | 'production';

const APP_ENV: EnvType = (process.env.APP_ENV as EnvType) || 'development';

// 多环境配置表 —— 唯一的环境差异在这里
const ENV_CONFIG: Record<
  EnvType,
  {
    API_BASE_URL: string;
    CHANNEL: string;
    ENABLE_LOGGER: boolean;
    SENTRY_DSN: string;
    CODEPUSH_KEY: string;
  }
> = {
  development: {
    API_BASE_URL: 'https://dev-api.example.com',
    CHANNEL: 'development',
    ENABLE_LOGGER: true,
    SENTRY_DSN: '',
    CODEPUSH_KEY: '',
  },
  testing: {
    API_BASE_URL: 'https://test-api.example.com',
    CHANNEL: 'testing',
    ENABLE_LOGGER: true,
    SENTRY_DSN: '',
    CODEPUSH_KEY: '',
  },
  staging: {
    API_BASE_URL: 'https://staging-api.example.com',
    CHANNEL: 'staging',
    ENABLE_LOGGER: false,
    SENTRY_DSN: '',
    CODEPUSH_KEY: '',
  },
  production: {
    API_BASE_URL: 'https://api.example.com',
    CHANNEL: 'production',
    ENABLE_LOGGER: false,
    SENTRY_DSN: '',
    CODEPUSH_KEY: '',
  },
};

const currentEnv = ENV_CONFIG[APP_ENV];

const appConfig: ExpoConfig = {
  name: APP_ENV === 'production' ? 'AppShell' : `AppShell (${APP_ENV})`,
  slug: 'testapp',
  owner: 'wuyang_studio',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'rnappshell',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,

  // iOS
  ios: {
    supportsTablet: true,
    bundleIdentifier:
      APP_ENV === 'production'
        ? 'com.company.appshell'
        : `com.company.appshell.${APP_ENV}`,
    buildNumber: '1',
    infoPlist: {
      LSApplicationQueriesSchemes: ['rnappshell'],
    },
  },

  // Android
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },
    package:
      APP_ENV === 'production'
        ? 'com.company.appshell'
        : `com.company.appshell.${APP_ENV}`,
    versionCode: 1,
    intentFilters: [
      {
        action: 'VIEW',
        data: { scheme: 'rnappshell' },
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },

  // Web（可选，后续可扩展）
  web: {
    bundler: 'metro',
    output: 'single',
    favicon: './assets/images/favicon.png',
  },

  // 插件
  plugins: [
    'expo-router',
    'expo-localization',
    'expo-secure-store',
    'expo-font',
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
        dark: {
          image: './assets/images/splash-icon-dark.png',
          backgroundColor: '#1a1a1a',
        },
      },
    ],
    [
      'expo-updates',
      {
        username: 'company',
      },
    ],
  ],

  // 实验性功能
  experiments: {
    typedRoutes: true,
  },

  // 注入环境变量到客户端代码
  extra: {
    APP_ENV,
    API_BASE_URL: currentEnv.API_BASE_URL,
    ENABLE_LOGGER: currentEnv.ENABLE_LOGGER,
    SENTRY_DSN: currentEnv.SENTRY_DSN,
    eas: {
      projectId: 'dbd9cd37-38f6-40f5-8ad9-51efaead2c5d',
    },
  },

  // OTA 更新配置
  updates: {
    url: 'https://u.expo.dev/dbd9cd37-38f6-40f5-8ad9-51efaead2c5d',
    enabled: true,
    fallbackToCacheTimeout: 0,
    checkAutomatically: 'ON_LOAD',
  },

  // Runtime Version（EAS Update 核心）
  runtimeVersion: {
    policy: 'appVersion',
  },
};

export default appConfig;
