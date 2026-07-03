/**
 * 用户中心 Feature — 桶导出
 */

// Screens
export { ProfileScreen } from './screens/ProfileScreen';
export { EditProfileScreen } from './screens/EditProfileScreen';
export { SecurityScreen } from './screens/SecurityScreen';
export { AboutScreen } from './screens/AboutScreen';

// Components
export { ProfileHeader } from './components/ProfileHeader';
export { MenuRow } from './components/MenuRow';

// API
export {
  fetchProfile,
  updateProfile,
  uploadAvatar,
  fetchAccountSecurity,
  changePhone,
  changePassword,
  deleteAccount,
  fetchAppVersion,
  checkUpdate,
} from './api';

// Types
export type { UserProfile, UpdateProfileParams, AccountSecurityInfo, AppVersion } from './types';

// Hooks
export { useUserProfile, useAccountSecurity, useAppVersion, useCheckUpdate } from './hooks/useUserProfile';
export { useUserMutations } from './hooks/useUserMutations';
