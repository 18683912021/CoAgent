import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';

export type LightStatus = 'capturing' | 'stopped' | 'waiting';

interface StatusLightProps {
  status: LightStatus;
}

const CONFIG: Record<LightStatus, { color: string; label: string; pulse: boolean }> = {
  capturing: { color: '#34C759', label: '采集中', pulse: true },
  stopped: { color: '#FF3B30', label: '已停止', pulse: false },
  waiting: { color: '#FFD43B', label: '等待授权', pulse: false },
};

export default function StatusLight({ status }: StatusLightProps): React.ReactElement {
  const cfg = CONFIG[status];

  const pulseOpacity = useSharedValue(status === 'capturing' ? 0.6 : 1);
  const pulseScale = useSharedValue(1);

  useEffect(() => {
    if (status === 'capturing') {
      pulseOpacity.value = withRepeat(
        withSequence(
          withTiming(0.3, { duration: 800, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.6, { duration: 800, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      );
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.25, { duration: 800, easing: Easing.inOut(Easing.quad) }),
          withTiming(1, { duration: 800, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(pulseOpacity);
      cancelAnimation(pulseScale);
      pulseOpacity.value = withTiming(1, { duration: 300 });
      pulseScale.value = withTiming(1, { duration: 300 });
    }

    return () => {
      cancelAnimation(pulseOpacity);
      cancelAnimation(pulseScale);
    };
  }, [status, pulseOpacity, pulseScale]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
    transform: [{ scale: pulseScale.value }],
  }));

  return (
    <View style={styles.container}>
      <View style={styles.dotWrapper}>
        {cfg.pulse && <Animated.View style={[styles.pulseRing, { borderColor: cfg.color }, ringStyle]} />}
        <View style={[styles.dot, { backgroundColor: cfg.color }]} />
      </View>
      <Text style={[styles.label, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dotWrapper: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
  },
});
