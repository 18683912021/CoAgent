import React from 'react';
import {StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';

import type {StreamState, StreamStats} from '../../../native/audio-capture';

export function StreamingControl({
  url,
  onChangeUrl,
  state,
  stats,
  message,
  onConnect,
  onDisconnect,
  disabled,
}: {
  url: string;
  onChangeUrl(value: string): void;
  state: StreamState;
  stats: StreamStats;
  message: string | null;
  onConnect(): void;
  onDisconnect(): void;
  disabled: boolean;
}) {
  const connected = ['ready', 'degraded', 'backfilling'].includes(state);
  return (
    <View style={styles.card}>
      <View style={styles.headingRow}>
        <Text style={styles.title}>WebSocket 推流</Text>
        <Text style={[styles.badge, connected ? styles.ready : styles.offline]}>{state}</Text>
      </View>
      <TextInput
        style={styles.input}
        value={url}
        onChangeText={onChangeUrl}
        editable={!disabled && !connected}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="wss://host/api/ws/audio/stream"
        accessibilityLabel="WebSocket 地址"
      />
      <TouchableOpacity
        accessibilityRole="button"
        style={[styles.button, connected ? styles.disconnect : styles.connect, disabled && styles.disabled]}
        disabled={disabled}
        onPress={connected ? onDisconnect : onConnect}>
        <Text style={styles.buttonText}>{connected ? '断开' : '连接'}</Text>
      </TouchableOpacity>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <View style={styles.statsGrid}>
        <Stat label="已确认" value={formatBytes(stats.acknowledgedBytes)} />
        <Stat label="排队中" value={formatBytes(stats.queuedBytes)} />
        <Stat label="帧数" value={String(stats.realtimeFrames)} />
        <Stat label="丢弃" value={String(stats.droppedFrames)} />
        <Stat label="回传" value={formatBytes(stats.backfillBytes)} />
        <Stat label="传输" value={formatBytes(stats.transportBytes)} />
      </View>
    </View>
  );
}

function Stat({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;}
  if (bytes >= 1024) {return `${(bytes / 1024).toFixed(1)} KB`;}
  return `${Math.round(bytes)} B`;
}

const styles = StyleSheet.create({
  card: {backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: '#e2e8f0'},
  headingRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  title: {fontSize: 17, fontWeight: '800', color: '#0f172a'},
  badge: {fontSize: 11, fontWeight: '800', textTransform: 'uppercase', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20, overflow: 'hidden'},
  ready: {backgroundColor: '#dcfce7', color: '#166534'},
  offline: {backgroundColor: '#e2e8f0', color: '#475569'},
  input: {borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: '#0f172a', backgroundColor: '#f8fafc'},
  button: {paddingVertical: 11, borderRadius: 10, alignItems: 'center'},
  connect: {backgroundColor: '#2563eb'},
  disconnect: {backgroundColor: '#475569'},
  disabled: {opacity: 0.45},
  buttonText: {color: '#fff', fontWeight: '800'},
  message: {fontSize: 12, color: '#b45309'},
  statsGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  stat: {width: '31%', minWidth: 85, padding: 9, borderRadius: 9, backgroundColor: '#f1f5f9'},
  statLabel: {fontSize: 10, fontWeight: '700', color: '#64748b', textTransform: 'uppercase'},
  statValue: {marginTop: 3, fontSize: 13, fontWeight: '800', color: '#0f172a'},
});
