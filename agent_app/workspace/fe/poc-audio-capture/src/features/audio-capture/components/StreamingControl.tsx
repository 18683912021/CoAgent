import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import type { StreamerState, StreamerStats } from '../hooks/useAudioStreamer';

interface Props {
  streamerState: StreamerState;
  stats: StreamerStats;
  onConnect: (url: string) => Promise<void>;
  onDisconnect: () => void;
  disabled: boolean;
}

const DEFAULT_URL = Platform.OS === 'android'
  ? 'ws://10.0.2.2:8010/api/ws/audio/stream'
  : 'ws://localhost:8010/api/ws/audio/stream';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

const STATE_LABELS: Record<StreamerState, string> = {
  idle: 'Not connected',
  connecting: 'Connecting...',
  connected: 'Connected',
  streaming: 'Streaming...',
  disconnected: 'Disconnected',
  error: 'Error',
};

const STATE_COLORS: Record<StreamerState, string> = {
  idle: '#9CA3AF',
  connecting: '#F59E0B',
  connected: '#10B981',
  streaming: '#3B82F6',
  disconnected: '#6B7280',
  error: '#EF4444',
};

export default function StreamingControl({ streamerState, stats, onConnect, onDisconnect, disabled }: Props) {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [connecting, setConnecting] = useState(false);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try {
      await onConnect(url.trim());
    } catch {
      // error handled by hook
    } finally {
      setConnecting(false);
    }
  }, [url, onConnect]);

  const isConnected = streamerState === 'connected' || streamerState === 'streaming';
  const isBusy = streamerState === 'connecting' || connecting;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>WebSocket Stream</Text>

      {/* Status indicator */}
      <View style={styles.statusRow}>
        <View style={[styles.dot, { backgroundColor: STATE_COLORS[streamerState] }]} />
        <Text style={[styles.statusText, { color: STATE_COLORS[streamerState] }]}>
          {STATE_LABELS[streamerState]}
        </Text>
        {isBusy && <ActivityIndicator size="small" color="#F59E0B" style={styles.spinner} />}
      </View>

      {/* URL input */}
      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, isConnected && styles.inputDisabled]}
          value={url}
          onChangeText={setUrl}
          placeholder="ws://host:8000/api/ws/audio/stream"
          placeholderTextColor="#9CA3AF"
          editable={!isConnected && !disabled}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        {!isConnected ? (
          <TouchableOpacity
            style={[styles.btn, styles.btnConnect, (isBusy || disabled) && styles.btnDisabled]}
            onPress={handleConnect}
            disabled={isBusy || disabled}
          >
            <Text style={styles.btnText}>Connect</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.btn, styles.btnDisconnect]} onPress={onDisconnect}>
            <Text style={styles.btnText}>Disconnect</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Stats */}
      {(isConnected || streamerState === 'disconnected') && (
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{stats.framesSent}</Text>
            <Text style={styles.statLabel}>Frames</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{formatBytes(stats.bytesSent)}</Text>
            <Text style={styles.statLabel}>Sent</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{formatDuration(stats.durationMs)}</Text>
            <Text style={styles.statLabel}>Duration</Text>
          </View>
        </View>
      )}

      {/* Error */}
      {streamerState === 'error' && stats.error && (
        <Text style={styles.errorText}>{stats.error}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1F2937',
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
  },
  title: {
    color: '#F3F4F6',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  spinner: {
    marginLeft: 8,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#374151',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#F3F4F6',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  inputDisabled: {
    opacity: 0.5,
  },
  btn: {
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnConnect: {
    backgroundColor: '#3B82F6',
  },
  btnDisconnect: {
    backgroundColor: '#EF4444',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#374151',
  },
  stat: {
    alignItems: 'center',
  },
  statValue: {
    color: '#F3F4F6',
    fontSize: 18,
    fontWeight: '700',
  },
  statLabel: {
    color: '#9CA3AF',
    fontSize: 11,
    marginTop: 2,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 12,
    marginTop: 8,
  },
});
