/**
 * ProfileHeader — 用户头像 + 信息区
 *
 * 四态：正常 / loading(骨架) / error(重试) / 编辑入口
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { CachedImage, Skeleton } from '@shared/components';
import { useAppTheme } from '@design-system/theme';
import { spacing, fontSizes, fontWeights, radii } from '@design-system/tokens';
import type { UserProfile } from '../types';
import { GENDER_MAP } from '../constants';

interface ProfileHeaderProps {
  profile: UserProfile | undefined;
  isLoading: boolean;
  isError: boolean;
  onEdit: () => void;
  onRetry: () => void;
}

export function ProfileHeader({
  profile,
  isLoading,
  isError,
  onEdit,
  onRetry,
}: ProfileHeaderProps): React.ReactElement {
  const theme = useAppTheme();

  // Loading
  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.semantic.surface }]}>
        <Skeleton width={72} height={72} borderRadius={36} />
        <View style={styles.infoLoading}>
          <Skeleton width={120} height={22} />
          <Skeleton width={80} height={14} style={{ marginTop: 8 }} />
          <Skeleton width="80%" height={14} style={{ marginTop: 8 }} />
        </View>
      </View>
    );
  }

  // Error
  if (isError) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.semantic.surface }]}>
        <View style={styles.avatarPlaceholder} />
        <View style={styles.infoError}>
          <Text style={[styles.errorText, { color: theme.colors.error }]}>加载失败</Text>
          <TouchableOpacity onPress={onRetry}>
            <Text style={[styles.retryText, { color: theme.colors.primary }]}>重试</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Normal
  if (!profile) return <></>;

  const genderInfo = GENDER_MAP[profile.gender];

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: theme.colors.semantic.surface }]}
      onPress={onEdit}
      activeOpacity={0.7}
    >
      <CachedImage
        uri={profile.avatar}
        borderRadius={36}
        style={styles.avatar}
      />
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: theme.colors.semantic.textPrimary }]}>
            {profile.name}
          </Text>
          <Text style={[styles.gender, { color: theme.colors.semantic.textSecondary }]}>
            {genderInfo.icon}
          </Text>
        </View>
        <Text style={[styles.phone, { color: theme.colors.semantic.textSecondary }]}>
          {profile.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}
        </Text>
        {profile.bio ? (
          <Text style={[styles.bio, { color: theme.colors.semantic.textTertiary }]} numberOfLines={1}>
            {profile.bio}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.arrow, { color: theme.colors.semantic.textTertiary }]}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.xl,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    borderRadius: radii.lg,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  avatarPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#e8e8e8',
  },
  info: {
    flex: 1,
    marginLeft: spacing.lg,
  },
  infoLoading: {
    flex: 1,
    marginLeft: spacing.lg,
  },
  infoError: {
    flex: 1,
    marginLeft: spacing.lg,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.semibold,
  },
  gender: {
    fontSize: fontSizes.lg,
    marginLeft: spacing.sm,
  },
  phone: {
    fontSize: fontSizes.md,
    marginTop: spacing.xs,
  },
  bio: {
    fontSize: fontSizes.sm,
    marginTop: spacing.xs,
  },
  arrow: {
    fontSize: 24,
    marginLeft: spacing.md,
  },
  errorText: {
    fontSize: fontSizes.md,
    marginBottom: spacing.xs,
  },
  retryText: {
    fontSize: fontSizes.md,
    fontWeight: fontWeights.medium,
  },
});
