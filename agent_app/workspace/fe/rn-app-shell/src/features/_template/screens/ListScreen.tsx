/**
 * ListScreen — 列表页
 *
 * 四态覆盖：
 * - loading: SkeletonList
 * - success: FlatList
 * - empty: Empty 组件
 * - error: 错误提示 + 重试
 *
 * 支持下拉刷新、无限滚动、搜索。
 */

import React, { useCallback, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAppTheme } from '@design-system/theme';
import { spacing, radii, fontSizes, fontWeights, shadows } from '@design-system/tokens';
import { SkeletonList, Empty } from '@shared/components';
import { useFeatureList } from '../hooks/useFeatureList';
import type { FeatureItem } from '../types';
import { STATUS_MAP } from '../constants';

export function ListScreen(): React.ReactElement {
  const theme = useAppTheme();
  const router = useRouter();
  const [keyword, setKeyword] = useState('');
  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isRefetching,
  } = useFeatureList({ keyword: keyword || undefined });

  // 扁平化所有页数据
  const items = data?.pages.flatMap((page) => page.list) ?? [];

  const renderItem = useCallback(
    ({ item }: { item: FeatureItem }) => (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: theme.colors.semantic.surface }, shadows.sm]}
        onPress={() => router.push(`/feature/${item.id}` as any)}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: theme.colors.semantic.textPrimary }]} numberOfLines={1}>
            {item.title}
          </Text>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: STATUS_MAP[item.status].color + '1A' },
            ]}
          >
            <Text style={[styles.statusText, { color: STATUS_MAP[item.status].color }]}>
              {STATUS_MAP[item.status].label}
            </Text>
          </View>
        </View>
        {item.description ? (
          <Text style={[styles.cardDesc, { color: theme.colors.semantic.textSecondary }]} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        <Text style={[styles.cardDate, { color: theme.colors.semantic.textTertiary }]}>
          {item.updatedAt}
        </Text>
      </TouchableOpacity>
    ),
    [theme, router],
  );

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  // ---- Loading ----
  if (isLoading) {
    return <SkeletonList count={5} />;
  }

  // ---- Error ----
  if (isError) {
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

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.semantic.background }]}>
      {/* 搜索栏 */}
      <View style={[styles.searchBar, { backgroundColor: theme.colors.semantic.surface }]}>
        <Text style={[styles.searchIcon, { color: theme.colors.semantic.textTertiary }]}>🔍</Text>
        <TextInput
          style={[styles.searchInput, { color: theme.colors.semantic.textPrimary }]}
          placeholder="搜索..."
          placeholderTextColor={theme.colors.semantic.textTertiary}
          value={keyword}
          onChangeText={setKeyword}
          returnKeyType="search"
        />
      </View>

      {/* 列表 */}
      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} tintColor={theme.colors.primary} />
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          <Empty
            icon="📋"
            title="暂无数据"
            description={keyword ? '没有匹配的结果，试试其他关键词' : '点击下方按钮创建第一条记录'}
          />
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.footerLoading}>
              <Text style={{ color: theme.colors.semantic.textTertiary }}>加载更多...</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: spacing.lg,
    paddingHorizontal: spacing.md,
    height: 40,
    borderRadius: radii.md,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSizes.md,
    paddingVertical: 0,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxxl,
    flexGrow: 1,
  },
  card: {
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  cardTitle: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.medium,
    flex: 1,
    marginRight: spacing.sm,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.xs,
  },
  statusText: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.medium,
  },
  cardDesc: {
    fontSize: fontSizes.md,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  cardDate: {
    fontSize: fontSizes.xs,
  },
  footerLoading: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
});
