// 从 Expo extra 中读取编译时注入的环境变量
import Constants from 'expo-constants';

export type EnvType = 'development' | 'testing' | 'staging' | 'production';

export interface EnvConfig {
  APP_ENV: EnvType;
  API_BASE_URL: string;
  ENABLE_LOGGER: boolean;
  SENTRY_DSN: string;
}

const extra = Constants.expoConfig?.extra as {
  APP_ENV: EnvType;
  API_BASE_URL: string;
  ENABLE_LOGGER: boolean;
  SENTRY_DSN: string;
};

export const env: EnvConfig = {
  APP_ENV: extra?.APP_ENV ?? 'development',
  API_BASE_URL: extra?.API_BASE_URL ?? 'https://dev-api.example.com',
  ENABLE_LOGGER: extra?.ENABLE_LOGGER ?? true,
  SENTRY_DSN: extra?.SENTRY_DSN ?? '',
};

export const isDev = env.APP_ENV === 'development';
export const isTesting = env.APP_ENV === 'testing';
export const isStaging = env.APP_ENV === 'staging';
export const isProd = env.APP_ENV === 'production';
