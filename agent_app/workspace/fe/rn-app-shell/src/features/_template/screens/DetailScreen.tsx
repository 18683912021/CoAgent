/**
 * DetailScreen — 详情页
 *
 * 四态覆盖：
 * - loading: Skeleton
 * - success: 详情内容
 * - empty: id 不存在时的 Empty
 * - error: 错误提示 + 重试
 */

import React, { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAppTheme } from '@design-system/theme';
import { spacing, radii, fontSizes, fontWeights, shadows } from '@design-system/tokens';
import { Skeleton, Empty } from '@shared/components';
import { useFeatureDetail } from '../hooks/useFeatureList';
import { useFeatureMutations } from '../hooks/useFeatureMutations';
import { STATUS_MAP } from '../constants';

export function DetailScreen(): React.ReactElement {
  const theme = useAppTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: item, isLoading, isError, refetch } = useFeatureDetail(id);
  const { remove } = useFeatureMutations();

  const handleDelete = () => {
    Alert.alert('确认删除', '删除后不可恢复，确定要删除吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          remove.mutate(id!, {
            onSuccess: () => router.back(),
          });
        },
      },
    ]);
  };

  // ---- Loading ----
  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.semantic.background }]}>
        <View style={[styles.card, { backgroundColor: theme.colors.semantic.surface }]}>
          <Skeleton height={24} width="60%" />
          <Skeleton height={14} width="40%" style={{ marginTop: 12 }} />
          <Skeleton height={100} style={{ marginTop: 12 }} />
        </View>
      </View>
    );
  }

  // ---- Error ----
  if (isError || !item) {
    return (
      <Empty
        icon="⚠️"
        title="加载失败"
        description="请检查网络连接后重试"
        actionText="重试"
        onAction={() => refetch()}
      />
    );
  }

  const statusInfo = STATUS_MAP[item.status];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.semantic.background }]}
      contentContainerStyle={styles.content}
    >
      {/* 主体卡片 */}
      <View style={[styles.card, { backgroundColor: theme.colors.semantic.surface }, shadows.sm]}>
        {/* 标题行 */}
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: theme.colors.semantic.textPrimary }]}>{item.title}</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusInfo.color + '1A' }]}>
            <Text style={[styles.statusText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
          </View>
        </View>

        {/* 描述 */}
        {item.description ? (
          <Text style={[styles.desc, { color: theme.colors.semantic.textSecondary }]}>{item.description}</Text>
        ) : null}

        {/* 元信息 */}
        <View style={[styles.meta, { borderTopColor: theme.colors.semantic.divider }]}>
          <View style={styles.metaRow}>
            <Text style={[styles.metaLabel, { color: theme.colors.semantic.textTertiary }]}>创建时间</Text>
            <Text style={[styles.metaValue, { color: theme.colors.semantic.textSecondary }]}>{item.createdAt}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={[styles.metaLabel, { color: theme.colors.semantic.textTertiary }]}>更新时间</Text>
            <Text style={[styles.metaValue, { color: theme.colors.semantic.textSecondary }]}>{item.updatedAt}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={[styles.metaLabel, { color: theme.colors.semantic.textTertiary }]}>ID</Text>
            <Text style={[styles.metaValue, { color: theme.colors.semantic.textSecondary }]}>{item.id}</Text>
          </View>
        </View>
      </View>

      {/* 操作按钮 */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.editBtn, { backgroundColor: theme.colors.primary }]}
          onPress={() => router.push(`/feature/${id}/edit` as any)}
        >
          <Text style={styles.editBtnText}>编辑</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.deleteBtn, { borderColor: theme.colors.error }]}
          onPress={handleDelete}
        >
          <Text style={[styles.deleteBtnText, { color: theme.colors.error }]}>删除</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  card: {
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.bold,
    flex: 1,
    marginRight: spacing.sm,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: radii.xs,
  },
  statusText: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
  },
  desc: {
    fontSize: fontSizes.md,
    lineHeight: 22,
    marginTop: spacing.md,
  },
  meta: {
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  metaLabel: {
    fontSize: fontSizes.md,
  },
  metaValue: {
    fontSize: fontSizes.md,
  },
  actions: {
    marginTop: spacing.xxl,
    gap: spacing.md,
  },
  editBtn: {
    height: 48,
    borderRadius: radii.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editBtnText: {
    color: '#fff',
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
  },
  deleteBtn: {
    height: 48,
    borderRadius: radii.md,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  deleteBtnText: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
  },
});
