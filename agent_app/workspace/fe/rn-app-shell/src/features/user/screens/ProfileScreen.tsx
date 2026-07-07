/**
 * ProfileScreen — 用户中心首页
 *
 * 四态：loading / error / normal / 空 profile
 * 包含：头像 + 资料卡片、菜单列表（账号安全、设置、关于）
 */

import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, View, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppTheme } from '@design-system/theme';
import { spacing } from '@design-system/tokens';
import { Empty } from '@shared/components';
import { useAuthStore } from '@core/auth';
import { useUserProfile } from '../hooks/useUserProfile';
import { ProfileHeader } from '../components/ProfileHeader';
import { MenuRow } from '../components/MenuRow';

export function ProfileScreen(): React.ReactElement {
  const theme = useAppTheme();
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);

  const { data: profile, isLoading, isError, refetch, isRefetching } = useUserProfile();

  const handleEditProfile = useCallback(() => {
    router.push('/(user)/edit-profile' as any);
  }, [router]);

  const handleSecurity = useCallback(() => {
    router.push('/(user)/security' as any);
  }, [router]);

  const handleAbout = useCallback(() => {
    router.push('/(user)/about' as any);
  }, [router]);

  const handleLogout = useCallback(async () => {
    await logout();
    router.replace('/(auth)/login');
  }, [logout, router]);

  // ---- Full-page Error ----
  if (isError && !profile) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.semantic.background }]}>
        <ProfileHeader profile={undefined} isLoading={false} isError onEdit={handleEditProfile} onRetry={() => refetch()} />
        <Empty
          icon="⚠️"
          title="加载失败"
          description="请检查网络后重试"
          actionText="重试"
          onAction={() => refetch()}
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.semantic.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor={theme.colors.primary} />
      }
    >
      {/* 头像区 */}
      <ProfileHeader
        profile={profile}
        isLoading={isLoading}
        isError={false}
        onEdit={handleEditProfile}
        onRetry={() => refetch()}
      />

      {/* 菜单区 */}
      <View style={styles.section}>
        <MenuRow
          icon="🔐"
          title="账号安全"
          subtitle="密码、手机号管理"
          position="first"
          onPress={handleSecurity}
        />
        <MenuRow
          icon="⚙️"
          title="通用设置"
          position="middle"
          onPress={() => router.push('/(tabs)/settings' as any)}
        />
        <MenuRow
          icon="ℹ️"
          title="关于"
          subtitle={`v1.0.0`}
          position="last"
          onPress={handleAbout}
        />
      </View>

      {/* 退出登录 */}
      <View style={styles.section}>
        <MenuRow
          icon="🚪"
          title="退出登录"
          position="single"
          danger
          onPress={handleLogout}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: spacing.huge,
  },
  section: {
    marginTop: spacing.xl,
  },
});
