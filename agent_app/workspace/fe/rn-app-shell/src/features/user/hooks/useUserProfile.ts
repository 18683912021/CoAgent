/**
 * useUserProfile — 用户资料 Hook
 */

import { useQuery } from '@tanstack/react-query';
import { fetchProfile, fetchAccountSecurity, fetchAppVersion, checkUpdate } from '../api';
import type { UserProfile, AccountSecurityInfo, AppVersion } from '../types';

/** 用户资料 */
export function useUserProfile() {
  return useQuery<UserProfile>({
    queryKey: ['user-profile'],
    queryFn: fetchProfile,
    staleTime: 5 * 60 * 1000, // 5 分钟
  });
}

/** 账号安全信息 */
export function useAccountSecurity() {
  return useQuery<AccountSecurityInfo>({
    queryKey: ['user-security'],
    queryFn: fetchAccountSecurity,
    staleTime: 60 * 1000,
  });
}

/** App 版本信息 */
export function useAppVersion() {
  return useQuery<AppVersion>({
    queryKey: ['app-version'],
    queryFn: fetchAppVersion,
    staleTime: 10 * 60 * 1000,
  });
}

/** 检查更新 */
export function useCheckUpdate() {
  return useQuery<AppVersion>({
    queryKey: ['app-check-update'],
    queryFn: checkUpdate,
    staleTime: 60 * 1000,
    enabled: false, // 手动触发
  });
}
