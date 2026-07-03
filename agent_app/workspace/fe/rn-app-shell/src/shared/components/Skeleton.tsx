import React, { useEffect } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { useAppTheme } from '@design-system/theme';

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: object;
}

/**
 * 骨架屏占位块
 * 带 shimmer 呼吸动画
 */
export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius = 4,
  style,
}: SkeletonProps): React.ReactElement {
  const theme = useAppTheme();
  const animatedValue = new Animated.Value(0);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(animatedValue, {
        toValue: 1,
        duration: 1200,
        easing: Easing.ease,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [animatedValue]);

  const opacity = animatedValue.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.3, 0.6, 0.3],
  });

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width: width as number | undefined,
          height,
          borderRadius,
          backgroundColor: theme.isDark ? '#2a2a2a' : '#e8e8e8',
          opacity,
        },
        style,
      ]}
    />
  );
}

/**
 * 卡片骨架屏
 */
export function SkeletonCard(): React.ReactElement {
  return (
    <View style={styles.card}>
      <Skeleton height={180} borderRadius={8} />
      <View style={styles.cardBody}>
        <Skeleton width="60%" height={20} />
        <Skeleton width="40%" height={14} style={{ marginTop: 8 }} />
        <Skeleton width="80%" height={14} style={{ marginTop: 8 }} />
      </View>
    </View>
  );
}

/**
 * 列表骨架屏（N 个卡片）
 */
export function SkeletonList({ count = 3 }: { count?: number }): React.ReactElement {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    overflow: 'hidden',
  },
  card: {
    marginBottom: 16,
  },
  cardBody: {
    padding: 12,
  },
  list: {
    padding: 16,
  },
});
