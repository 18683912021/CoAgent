import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import type {TrackOutput} from '../../../native/audio-capture';

export function FileInfo({track, onShare}: {track: TrackOutput; onShare(kind: 'pcm' | 'wav'): void}) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{track.source.toUpperCase()} 输出</Text>
        <Text style={styles.duration}>{(track.durationMs / 1000).toFixed(1)}s</Text>
      </View>
      <Text style={styles.meta}>
        {track.outputFormat.sampleRate} Hz · {track.outputFormat.bitsPerSample} bit · {track.outputFormat.channelCount} ch · {formatBytes(track.pcmBytes)}
      </Text>
      <Text style={styles.path} numberOfLines={2}>{track.wavPath}</Text>
      <Text style={styles.hash} numberOfLines={1}>SHA-256 {track.pcmSha256}</Text>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.action} onPress={() => onShare('wav')} accessibilityRole="button">
          <Text style={styles.actionText}>分享 WAV</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionSecondary} onPress={() => onShare('pcm')} accessibilityRole="button">
          <Text style={styles.actionSecondaryText}>分享 PCM</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;
}

const styles = StyleSheet.create({
  card: {backgroundColor: '#f8fafc', borderRadius: 12, padding: 14, gap: 7, borderWidth: 1, borderColor: '#e2e8f0'},
  header: {flexDirection: 'row', justifyContent: 'space-between'},
  title: {fontSize: 15, fontWeight: '800', color: '#0f172a'},
  duration: {fontSize: 13, fontWeight: '700', color: '#475569'},
  meta: {fontSize: 12, color: '#475569'},
  path: {fontSize: 11, color: '#64748b'},
  hash: {fontSize: 10, color: '#94a3b8'},
  actions: {flexDirection: 'row', gap: 8, marginTop: 4},
  action: {flex: 1, backgroundColor: '#2563eb', paddingVertical: 9, borderRadius: 9, alignItems: 'center'},
  actionText: {color: '#fff', fontWeight: '800'},
  actionSecondary: {flex: 1, backgroundColor: '#e2e8f0', paddingVertical: 9, borderRadius: 9, alignItems: 'center'},
  actionSecondaryText: {color: '#334155', fontWeight: '800'},
});
