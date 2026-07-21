import React from 'react';
import {StyleSheet, View} from 'react-native';

const MULTIPLIERS = [0.55, 0.8, 1, 0.72, 0.48];

export function AudioVisualizer({level, color, active}: {level: number; color: string; active: boolean}) {
  const normalized = active ? Math.max(0.03, Math.min(1, level)) : 0.03;
  return (
    <View style={styles.container} accessibilityElementsHidden>
      {MULTIPLIERS.map((multiplier, index) => (
        <View
          key={index}
          style={[
            styles.bar,
            {
              height: 8 + normalized * multiplier * 46,
              backgroundColor: color,
            },
            active ? styles.active : styles.inactive,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6},
  bar: {width: 8, borderRadius: 4},
  active: {opacity: 0.9},
  inactive: {opacity: 0.25},
});
