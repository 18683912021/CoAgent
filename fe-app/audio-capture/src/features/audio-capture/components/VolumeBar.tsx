import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

export function VolumeBar({label, level, color}: {label: string; level: number; color: string}) {
  const percentage = Math.round(Math.max(0, Math.min(1, level)) * 100);
  return (
    <View style={styles.container} accessible accessibilityLabel={`${label} 电平 ${percentage}%`}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{percentage}%</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, {width: `${percentage}%`, backgroundColor: color}]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {gap: 6},
  header: {flexDirection: 'row', justifyContent: 'space-between'},
  label: {fontSize: 13, fontWeight: '700', color: '#334155'},
  value: {fontSize: 12, fontWeight: '700', color: '#64748b'},
  track: {height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: '#e2e8f0'},
  fill: {height: '100%', borderRadius: 5},
});
