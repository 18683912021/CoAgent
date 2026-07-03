/**
 * SecurityScreen — 账号安全
 *
 * 显示：手机号、登录设备、密码状态
 * 操作：修改手机号、修改密码、注销账号
 */

import React, { useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppTheme } from '@design-system/theme';
import { spacing, fontSizes, fontWeights, radii } from '@design-system/tokens';
import { Loading, Empty } from '@shared/components';
import { toast } from '@shared/components/Toast';
import { useAccountSecurity } from '../hooks/useUserProfile';
import { useUserMutations } from '../hooks/useUserMutations';
import { useAuthStore } from '@core/auth';
import { MenuRow } from '../components/MenuRow';

export function SecurityScreen(): React.ReactElement {
  const theme = useAppTheme();
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);

  const { data: security, isLoading, isError, refetch } = useAccountSecurity();
  const { deleteAccount } = useUserMutations();

  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      '注销账号',
      '注销后所有数据将被永久删除，且不可恢复。确定要注销吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定注销',
          style: 'destructive',
          onPress: () => {
            deleteAccount.mutate(undefined, {
              onSuccess: async () => {
                await logout();
                router.replace('/(auth)/login');
              },
            });
          },
        },
      ],
    );
  }, [deleteAccount, logout, router]);

  if (isLoading) {
    return <Loading fullScreen text="加载安全信息..." />;
  }

  if (isError || !security) {
    return (
      <Empty
        icon="⚠️"
        title="加载失败"
        description="无法获取安全信息"
        actionText="重试"
        onAction={() => refetch()}
      />
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.semantic.background }]}
      contentContainerStyle={styles.content}
    >
      {/* 基本信息 */}
      <Text style={[styles.sectionTitle, { color: theme.colors.semantic.textTertiary }]}>基本信息</Text>
      <View style={styles.section}>
        <MenuRow
          icon="📱"
          title="手机号"
          rightText={security.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}
          position="first"
          onPress={() => toast.info('修改手机号功能开发中')}
        />
        <MenuRow
          icon="📧"
          title="邮箱"
          rightText={security.emailBound ? '已绑定' : '未绑定'}
          position="middle"
          onPress={() => toast.info('邮箱绑定功能开发中')}
        />
        <MenuRow
          icon="🔑"
          title="登录密码"
          rightText={security.hasPassword ? '已设置' : '未设置'}
          position="last"
          onPress={() => toast.info('修改密码功能开发中')}
        />
      </View>

      {/* 设备信息 */}
      <Text style={[styles.sectionTitle, { color: theme.colors.semantic.textTertiary }]}>登录信息</Text>
      <View style={styles.section}>
        <MenuRow
          icon="💻"
          title="最近登录设备"
          rightText={security.lastLoginDevice}
          position="first"
          showArrow={false}
        />
        <MenuRow
          icon="🕐"
          title="最近登录时间"
          rightText={security.lastLoginAt}
          position="last"
          showArrow={false}
        />
      </View>

      {/* 危险操作 */}
      <Text style={[styles.sectionTitle, { color: theme.colors.error }]}>危险操作</Text>
      <View style={styles.section}>
        <MenuRow
          icon="🗑️"
          title="注销账号"
          subtitle="所有数据将被永久删除"
          position="single"
          danger
          onPress={handleDeleteAccount}
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
  sectionTitle: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
    marginLeft: spacing.xl,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  section: {
    // MenuRow items handle their own margins
  },
});
