/**
 * 用户中心 Feature — 常量
 */

export const FEATURE_NAME = 'user';

export const GENDER_MAP = {
  male: { label: '男', icon: '♂' },
  female: { label: '女', icon: '♀' },
  other: { label: '其他', icon: '⚧' },
} as const;

export const MAX_BIO_LENGTH = 200;

export const MAX_AVATAR_SIZE_MB = 5;

export const SUPPORTED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
