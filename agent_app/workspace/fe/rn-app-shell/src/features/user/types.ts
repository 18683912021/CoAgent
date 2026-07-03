/**
 * 用户中心 Feature — 类型定义
 */

export interface UserProfile {
  id: string;
  name: string;
  avatar: string;
  phone: string;
  email?: string;
  gender: 'male' | 'female' | 'other';
  birthday?: string;
  bio?: string;
  createdAt: string;
}

export interface UpdateProfileParams {
  name?: string;
  avatar?: string;
  email?: string;
  gender?: UserProfile['gender'];
  birthday?: string;
  bio?: string;
}

export interface AccountSecurityInfo {
  phone: string;
  hasPassword: boolean;
  lastLoginAt: string;
  lastLoginDevice: string;
  emailBound: boolean;
}

export interface AppVersion {
  version: string;
  buildNumber: string;
  updateAvailable: boolean;
  latestVersion?: string;
  releaseNotes?: string;
}

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}
