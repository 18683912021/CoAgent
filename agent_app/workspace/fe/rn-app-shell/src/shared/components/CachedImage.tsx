/**
 * CachedImage — 图片加载封装
 *
 * 基于 expo-image，覆盖四态：
 * - loading: 骨架占位
 * - success: 正常展示
 * - error: 错误占位 + 重试按钮
 * - empty: 无 uri 时占位
 */

import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View, Text } from 'react-native';
import { Image, ImageContentPosition, ImageTransition } from 'expo-image';
import { useAppTheme } from '@design-system/theme';
import { radii } from '@design-system/tokens';

interface CachedImageProps {
  uri?: string | null;
  /** 宽高比，用于占位。不传则撑满父容器 */
  aspectRatio?: number;
  /** 图片填充模式 */
  contentFit?: 'cover' | 'contain' | 'fill' | 'none';
  /** 图片焦点（contentFit=cover 时有效） */
  contentPosition?: ImageContentPosition;
  /** 圆角 */
  borderRadius?: number;
  /** 外部样式 */
  style?: object;
  /** 过渡动画时长，默认 200ms */
  transition?: number;
  /** 兜底图 uri（本地 require 或远程 url） */
  fallbackUri?: string;
}

const blurhash = 'L6PZfSi_.AyE_3t7t7R**0o#DgR4';

export function CachedImage({
  uri,
  aspectRatio,
  contentFit = 'cover',
  contentPosition = 'center',
  borderRadius = radii.md,
  style,
  transition = 200,
  fallbackUri,
}: CachedImageProps): React.ReactElement {
  const theme = useAppTheme();
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [retryKey, setRetryKey] = useState(0);

  // 无 URI
  if (!uri) {
    return (
      <View
        style={[
          styles.placeholder,
          {
            aspectRatio: aspectRatio ?? 1,
            borderRadius,
            backgroundColor: theme.isDark ? '#1a1a1a' : '#f0f0f0',
          },
          style,
        ]}
      >
        <Text style={[styles.placeholderText, { color: theme.colors.semantic.textTertiary }]}>暂无图片</Text>
      </View>
    );
  }

  const source = retryKey > 0 ? { uri: `${uri}${uri.includes('?') ? '&' : '?'}_retry=${retryKey}` } : uri;

  return (
    <View
      style={[
        {
          aspectRatio: aspectRatio ?? undefined,
          borderRadius,
          overflow: 'hidden',
          backgroundColor: theme.isDark ? '#1a1a1a' : '#f0f0f0',
        },
        style,
      ]}
    >
      {/* 骨架占位层（loading / error 时可见） */}
      {status !== 'loaded' && (
        <View style={[styles.placeholder, StyleSheet.absoluteFill]}>
          {status === 'loading' && (
            <Text style={[styles.placeholderText, { color: theme.colors.semantic.textTertiary }]}>加载中...</Text>
          )}
          {status === 'error' && (
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => {
                setStatus('loading');
                setRetryKey((k) => k + 1);
              }}
            >
              <Text style={styles.retryIcon}>↻</Text>
              <Text style={[styles.retryText, { color: theme.colors.primary }]}>重试</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <Image
        key={`img_${retryKey}`}
        source={source}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
        contentPosition={contentPosition}
        placeholder={{ blurhash }}
        transition={transition as ImageTransition}
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
        cachePolicy="memory-disk"
        recyclingKey={typeof uri === 'string' ? uri : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 12,
  },
  retryBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  retryIcon: {
    fontSize: 24,
    color: '#999',
  },
  retryText: {
    fontSize: 12,
  },
});
