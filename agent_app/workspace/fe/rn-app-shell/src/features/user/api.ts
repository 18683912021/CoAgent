/**
 * 用户中心 Feature — API 层
 */

import { httpClient } from '@core/http';
import type { UserProfile, UpdateProfileParams, AccountSecurityInfo, AppVersion, ApiResponse } from './types';

/** 获取用户资料 */
export async function fetchProfile(): Promise<UserProfile> {
  const res = await httpClient.get<ApiResponse<UserProfile>>('/api/user/profile');
  return res.data;
}

/** 更新用户资料 */
export async function updateProfile(params: UpdateProfileParams): Promise<UserProfile> {
  const res = await httpClient.put<ApiResponse<UserProfile>>('/api/user/profile', params);
  return res.data;
}

/** 上传头像 */
export async function uploadAvatar(uri: string): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append('file', {
    uri,
    type: 'image/jpeg',
    name: 'avatar.jpg',
  } as any);

  const res = await httpClient.post<ApiResponse<{ url: string }>>('/api/user/avatar', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}

/** 获取账号安全信息 */
export async function fetchAccountSecurity(): Promise<AccountSecurityInfo> {
  const res = await httpClient.get<ApiResponse<AccountSecurityInfo>>('/api/user/security');
  return res.data;
}

/** 修改手机号 */
export async function changePhone(params: { phone: string; code: string }): Promise<void> {
  await httpClient.post('/api/user/change-phone', params);
}

/** 修改密码 */
export async function changePassword(params: { oldPassword: string; newPassword: string }): Promise<void> {
  await httpClient.put('/api/user/password', params);
}

/** 注销账号 */
export async function deleteAccount(reason?: string): Promise<void> {
  await httpClient.post('/api/user/delete-account', { reason });
}

/** 获取 App 版本信息 */
export async function fetchAppVersion(): Promise<AppVersion> {
  const res = await httpClient.get<ApiResponse<AppVersion>>('/api/app/version');
  return res.data;
}

/** 检查更新 */
export async function checkUpdate(): Promise<AppVersion> {
  const res = await httpClient.get<ApiResponse<AppVersion>>('/api/app/check-update');
  return res.data;
}
