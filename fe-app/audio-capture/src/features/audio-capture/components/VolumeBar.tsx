import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';

interface VolumeBarProps {
  /** 0~1 音频电平 */
  level: number;
  isActive: boolean;
}

const CLAMP_LEVEL = (v: number) => Math.min(1, Math.max(0, v));

/**
 * 简易音量条：一根会跳的横条 + 百分比，肉眼看出"有声音"即可
 */
export default function VolumeBar({ level, isActive }: VolumeBarProps): React.ReactElement {
  const width = useSharedValue(0);

  useEffect(() => {
    if (!isActive) {
      width.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.quad) });
      return;
    }

    // 做一点平滑，让跳动看起来自然
    const target = CLAMP_LEVEL(level * 1.15);
    width.value = withTiming(target, {
      duration: 150,
      easing: Easing.out(Easing.quad),
    });
  }, [level, isActive, width]);

  const barStyle = useAnimatedStyle(() => ({
    width: `${width.value * 100}%`,
  }));

  // 颜色随电平变化
  const hue = isActive ? 120 - level * 60 : 0; // green(120) → yellow(60) → red(0)
  const barColor = isActive ? `hsl(${hue}, 80%, 50%)` : '#ccc';
  const label = isActive ? `${(level * 100).toFixed(0)}%` : '—';

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>📊 音量</Text>
        <Text style={[styles.value, { color: barColor }]}>{label}</Text>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, barStyle, { backgroundColor: barColor }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  track: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#e8e8e8',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 5,
    minWidth: 0,
  },
});
