import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

export default function SeparatorLine() {
  return (
    <View style={styles.container}>
      <View style={styles.line} />
      <View style={styles.badge}>
        <Text style={styles.badgeText}>3s</Text>
      </View>
      <View style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginVertical: 6,
  },
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#BDC3C7',
  },
  badge: {
    marginHorizontal: 10,
    backgroundColor: '#ECF0F1',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    color: '#95A5A6',
    fontWeight: '600',
  },
});
