import React, {useEffect, useRef} from 'react';
import {Animated, StyleSheet, Text, View} from 'react-native';

import type {CaptureState} from '../../../native/audio-capture';

const COLORS: Record<CaptureState, string> = {
  idle: '#ef4444',
  preparing: '#f59e0b',
  capturing: '#22c55e',
  stopping: '#f59e0b',
  finalizing: '#3b82f6',
  completed: '#64748b',
  error: '#dc2626',
};

const LABELS: Record<CaptureState, string> = {
  idle: 'Stopped',
  preparing: 'Preparing',
  capturing: 'Capturing',
  stopping: 'Stopping',
  finalizing: 'Finalizing files',
  completed: 'Completed',
  error: 'Error',
};

export function StatusLight({state}: {state: CaptureState}) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (state !== 'capturing') {
      scale.stopAnimation();
      scale.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.45,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [scale, state]);

  return (
    <View style={styles.container} accessibilityRole="text">
      <View style={styles.dotSlot}>
        <Animated.View
          style={[
            styles.halo,
            {backgroundColor: COLORS[state], transform: [{scale}]},
          ]}
        />
        <View style={[styles.dot, {backgroundColor: COLORS[state]}]} />
      </View>
      <Text style={styles.label}>{LABELS[state]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flexDirection: 'row', alignItems: 'center', gap: 10},
  dotSlot: {width: 20, height: 20, alignItems: 'center', justifyContent: 'center'},
  halo: {position: 'absolute', width: 16, height: 16, borderRadius: 8, opacity: 0.2},
  dot: {width: 10, height: 10, borderRadius: 5},
  label: {fontSize: 15, fontWeight: '700', color: '#0f172a'},
});
