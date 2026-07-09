import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';

interface AudioVisualizerProps {
  /** 0~1 的音频电平 */
  level: number;
  /** 是否正在采集中 */
  isActive: boolean;
}

const BAR_COLORS = ['#FF6B6B', '#FFA94D', '#FFD43B', '#69DB7C', '#4DABF7'];

/**
 * 均衡器风格音频可视化
 * 5根柱子随音量跳动，采集中有波浪动画
 */
export default function AudioVisualizer({
  level,
  isActive,
}: AudioVisualizerProps): React.ReactElement {
  // ===== 所有 Hook 在组件顶层调用，不在循环/回调中 =====

  // 5 根柱子独立共享值
  const h0 = useSharedValue(0.05);
  const h1 = useSharedValue(0.05);
  const h2 = useSharedValue(0.05);
  const h3 = useSharedValue(0.05);
  const h4 = useSharedValue(0.05);
  const barHeights = [h0, h1, h2, h3, h4];

  // 5 根柱子的 animated style，也在顶层
  const barStyle0 = useAnimatedStyle(() => ({ height: `${h0.value * 100}%` }));
  const barStyle1 = useAnimatedStyle(() => ({ height: `${h1.value * 100}%` }));
  const barStyle2 = useAnimatedStyle(() => ({ height: `${h2.value * 100}%` }));
  const barStyle3 = useAnimatedStyle(() => ({ height: `${h3.value * 100}%` }));
  const barStyle4 = useAnimatedStyle(() => ({ height: `${h4.value * 100}%` }));
  const barStyles = [barStyle0, barStyle1, barStyle2, barStyle3, barStyle4];

  // 每次 level 变化时，驱动柱子跳动（加微小随机偏移做出波浪感）
  useEffect(() => {
    if (!isActive) {
      barHeights.forEach((h) => {
        h.value = withTiming(0.05, { duration: 300, easing: Easing.out(Easing.quad) });
      });
      return;
    }

    barHeights.forEach((h, i) => {
      const jitter = Math.random() * 0.15;
      const target = Math.max(0.05, Math.min(1, level + jitter));
      h.value = withDelay(
        i * 40,
        withTiming(target, {
          duration: 200,
          easing: Easing.out(Easing.quad),
        }),
      );
    });
  }, [level, isActive, barHeights]);

  const pulseOpacity = useSharedValue(0.4);

  useEffect(() => {
    if (!isActive) {
      pulseOpacity.value = 0;
      return;
    }
    // 脉冲呼吸效果
    const loop = () => {
      pulseOpacity.value = withTiming(1, { duration: 600 }, () => {
        pulseOpacity.value = withTiming(0.4, { duration: 600 }, () => {
          if (isActive) loop();
        });
      });
    };
    loop();
  }, [isActive, pulseOpacity]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  return (
    <View style={styles.container}>
      {/* 脉冲指示器 */}
      <View style={styles.indicatorRow}>
        {isActive && (
          <Animated.View style={[styles.pulseDot, pulseStyle]} />
        )}
        <Text style={styles.levelText}>
          {isActive ? `🔴 采集中 · ${(level * 100).toFixed(0)}%` : '⏸️ 未采集'}
        </Text>
      </View>

      {/* 均衡器柱子 */}
      <View style={styles.barContainer}>
        {barHeights.map((_heightSv, i) => (
          <View key={i} style={styles.barTrack}>
            <Animated.View
              style={[
                styles.bar,
                barStyles[i],
                { backgroundColor: BAR_COLORS[i] },
              ]}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  indicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 8,
  },
  pulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FF3B30',
  },
  levelText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  barContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    height: 120,
    gap: 8,
  },
  barTrack: {
    flex: 1,
    maxWidth: 40,
    height: '100%',
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  bar: {
    width: '100%',
    borderRadius: 8,
    minHeight: 4,
  },
});
