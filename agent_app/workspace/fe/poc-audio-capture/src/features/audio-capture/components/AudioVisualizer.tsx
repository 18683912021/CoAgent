import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withRepeat,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';

interface AudioVisualizerProps {
  /** 0~1 的音频电平 */
  level: number;
  /** 是否正在采集中 */
  isActive: boolean;
  /** 标签（如 "麦克风" / "系统音频"） */
  label: string;
  /** 配色方案 */
  colorScheme: 'warm' | 'cool';
}

const WARM_COLORS = ['#FF6B6B', '#FFA94D', '#FFD43B', '#FCC419', '#FF922B'];
const COOL_COLORS = ['#4DABF7', '#748FFC', '#9775FA', '#5C7CFA', '#3BC9DB'];

/**
 * 均衡器风格音频可视化
 * 5根柱子随音量跳动
 */
export default function AudioVisualizer({
  level,
  isActive,
  label,
  colorScheme,
}: AudioVisualizerProps): React.ReactElement {
  const colors = colorScheme === 'warm' ? WARM_COLORS : COOL_COLORS;
  const indicatorColor = colorScheme === 'warm' ? '#FF6B6B' : '#4DABF7';

  // 5 根柱子独立共享值 — 必须在组件顶层调用
  const h0 = useSharedValue(0.05);
  const h1 = useSharedValue(0.05);
  const h2 = useSharedValue(0.05);
  const h3 = useSharedValue(0.05);
  const h4 = useSharedValue(0.05);
  const barHeights = [h0, h1, h2, h3, h4];

  const barStyle0 = useAnimatedStyle(() => ({ height: `${h0.value * 100}%` }));
  const barStyle1 = useAnimatedStyle(() => ({ height: `${h1.value * 100}%` }));
  const barStyle2 = useAnimatedStyle(() => ({ height: `${h2.value * 100}%` }));
  const barStyle3 = useAnimatedStyle(() => ({ height: `${h3.value * 100}%` }));
  const barStyle4 = useAnimatedStyle(() => ({ height: `${h4.value * 100}%` }));
  const barStyles = [barStyle0, barStyle1, barStyle2, barStyle3, barStyle4];

  // ── 柱子动画（用 useEffect + JS 线程驱动，避免 worklet 里调非 worklet 函数） ──
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

  // ── 脉冲呼吸动画：直接在 JS 线程启动 withRepeat，避免 worklet 回调 ──
  const pulseOpacity = useSharedValue(0);

  useEffect(() => {
    if (!isActive) {
      cancelAnimation(pulseOpacity);
      pulseOpacity.value = withTiming(0, { duration: 200 });
      return;
    }

    // 先跳到 0.4，再从 0.4↔1.0 无限脉冲（反向循环）
    pulseOpacity.value = 0.4;
    pulseOpacity.value = withRepeat(
      withTiming(1, { duration: 600, easing: Easing.inOut(Easing.quad) }),
      -1,   // 无限循环
      true, // 反向（0.4 → 1 → 0.4 → 1 ...）
    );
  }, [isActive, pulseOpacity]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  return (
    <View style={styles.container}>
      {/* 标签行 */}
      <View style={styles.headerRow}>
        <View style={styles.indicatorRow}>
          {isActive && (
            <Animated.View style={[styles.pulseDot, { backgroundColor: indicatorColor }, pulseStyle]} />
          )}
          <Text style={styles.labelText}>{label}</Text>
        </View>
        <Text style={styles.levelText}>
          {isActive ? `${(level * 100).toFixed(0)}%` : '—'}
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
                { backgroundColor: colors[i] },
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
    padding: 16,
    alignItems: 'center',
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 12,
  },
  indicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  labelText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  levelText: {
    color: '#aaa',
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  barContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    height: 100,
    gap: 6,
    width: '100%',
  },
  barTrack: {
    flex: 1,
    maxWidth: 36,
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
