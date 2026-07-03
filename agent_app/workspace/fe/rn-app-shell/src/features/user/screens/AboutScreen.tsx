/**
 * AboutScreen — 关于页面
 *
 * 显示：版本号、更新检查、开源许可、隐私政策等
 */

import React, { useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { useAppTheme } from '@design-system/theme';
import { spacing, fontSizes, fontWeights, radii } from '@design-system/tokens';
import { toast } from '@shared/components/Toast';
import { useAppVersion, useCheckUpdate } from '../hooks/useUserProfile';
import { MenuRow } from '../components/MenuRow';

export function AboutScreen(): React.ReactElement {
  const theme = useAppTheme();
  const { data: versionInfo, isLoading: versionLoading } = useAppVersion();
  const { refetch: checkUpdate, isFetching: checkingUpdate } = useCheckUpdate();

  const handleCheckUpdate = useCallback(async () => {
    const result = await checkUpdate();
    if (result.data?.updateAvailable) {
      toast.info(`发现新版本 ${result.data.latestVersion}`, 3000);
    } else {
      toast.success('已是最新版本');
    }
  }, [checkUpdate]);

  const handleOpenUrl = useCallback(async (url: string) => {
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
    }
  }, []);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.semantic.background }]}
      contentContainerStyle={styles.content}
    >
      {/* Logo + 版本号 */}
      <View style={styles.logoSection}>
        <Text style={styles.logo}>🛠️</Text>
        <Text style={[styles.appName, { color: theme.colors.semantic.textPrimary }]}>AppShell</Text>
        <Text style={[styles.version, { color: theme.colors.semantic.textTertiary }]}>
          v{versionInfo?.version ?? '1.0.0'} (build {versionInfo?.buildNumber ?? '1'})
        </Text>
        <TouchableOpacity
          style={[styles.updateBtn, { borderColor: theme.colors.primary }]}
          onPress={handleCheckUpdate}
          disabled={checkingUpdate}
        >
          <Text style={[styles.updateText, { color: theme.colors.primary }]}>
            {checkingUpdate ? '检查中...' : '检查更新'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 链接区 */}
      <View style={styles.section}>
        <MenuRow
          icon="📄"
          title="用户协议"
          position="first"
          onPress={() => handleOpenUrl('https://example.com/terms')}
        />
        <MenuRow
          icon="🔒"
          title="隐私政策"
          position="middle"
          onPress={() => handleOpenUrl('https://example.com/privacy')}
        />
        <MenuRow
          icon="📜"
          title="开源许可"
          position="last"
          onPress={() => handleOpenUrl('https://example.com/licenses')}
        />
      </View>

      {/* 版权 */}
      <Text style={[styles.copyright, { color: theme.colors.semantic.textTertiary }]}>
        © {new Date().getFullYear()} Company. All rights reserved.
      </Text>
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
  logoSection: {
    alignItems: 'center',
    paddingVertical: spacing.xxxl,
  },
  logo: {
    fontSize: 64,
    marginBottom: spacing.lg,
  },
  appName: {
    fontSize: fontSizes.title,
    fontWeight: fontWeights.bold,
    marginBottom: spacing.xs,
  },
  version: {
    fontSize: fontSizes.md,
  },
  updateBtn: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  updateText: {
    fontSize: fontSizes.md,
    fontWeight: fontWeights.medium,
  },
  section: {
    marginTop: spacing.lg,
  },
  copyright: {
    textAlign: 'center',
    fontSize: fontSizes.sm,
    marginTop: spacing.xxxl,
  },
});
