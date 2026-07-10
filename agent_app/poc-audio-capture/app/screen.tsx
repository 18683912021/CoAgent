import React, { useCallback, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AudioCapture } from '../modules/audio-capture';
import type { AudioCaptureStatus } from '../modules/audio-capture';
import { ErrorBoundary } from '../components/ErrorBoundary';

// ── 状态标签样式 ──────────────────────────────────
type LogEntry = { ts: string; text: string; level: 'info' | 'warn' | 'error' };
type AuthState = 'idle' | 'requesting' | 'granted' | 'denied';

export default function Screen() {
  const [captureStatus, setCaptureStatus] = useState<AudioCaptureStatus>('idle');
  const [systemAuth, setSystemAuth] = useState<AuthState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  const addLog = useCallback((text: string, level: LogEntry['level'] = 'info') => {
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setLogs((prev) => [...prev.slice(-99), { ts, text, level }]);
  }, []);

  // ── 普通录音权限 ──────────────────────────
  const requestRecordPermission = useCallback(async () => {
    try {
      addLog('请求麦克风权限...');
      const granted = await AudioCapture.requestRecordPermission();
      if (granted) {
        setCaptureStatus('ready');
        addLog('✅ 录音权限已授权');
      } else {
        setCaptureStatus('denied');
        addLog('❌ 录音权限被拒绝', 'warn');
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setErrorMsg(msg);
      addLog(`权限异常: ${msg}`, 'error');
    }
  }, [addLog]);

  // ── 系统音频权限 (MediaProjection) ──────────
  const requestSystemAudioPermission = useCallback(async () => {
    if (Platform.OS !== 'android') {
      addLog('系统音频采集仅支持 Android 10+', 'warn');
      return;
    }
    try {
      setSystemAuth('requesting');
      addLog('请求系统音频权限 (MediaProjection)...');
      const granted = await AudioCapture.requestSystemAudioPermission();
      if (granted) {
        setSystemAuth('granted');
        addLog('✅ 系统音频权限已授权');
      } else {
        setSystemAuth('denied');
        addLog('❌ 系统音频权限被拒绝', 'warn');
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setSystemAuth('idle');
      setErrorMsg(msg);
      addLog(`系统音频授权异常: ${msg}`, 'error');
    }
  }, [addLog]);

  // ── 开始采集 ─────────────────────────────
  const startCapture = useCallback(async () => {
    setErrorMsg(null);
    try {
      setCaptureStatus('starting');
      addLog('开始采集...');
      await AudioCapture.start({
        sampleRate: 16000,
        channelConfig: 1, // mono
        audioFormat: 2,   // PCM_16BIT
        bufferSize: 1280, // 40ms @ 16kHz
      });
      setCaptureStatus('capturing');
      addLog('✅ 采集已启动 (16kHz/16bit/mono → PCM)');
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setCaptureStatus('ready');
      setErrorMsg(msg);
      addLog(`启动失败: ${msg}`, 'error');
    }
  }, [addLog]);

  // ── 停止采集 ─────────────────────────────
  const stopCapture = useCallback(async () => {
    try {
      addLog('停止采集...');
      AudioCapture.stop();
      setCaptureStatus('ready');
      addLog('✅ 采集已停止');
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setErrorMsg(msg);
      addLog(`停止异常: ${msg}`, 'error');
    }
  }, [addLog]);

  // ── 清除错误 ─────────────────────────────
  const clearError = useCallback(() => setErrorMsg(null), []);

  // ── UI 状态派生 ──────────────────────────
  const canStart = captureStatus === 'ready' && systemAuth === 'granted';
  const isCapturing = captureStatus === 'capturing';
  const isStarting = captureStatus === 'starting';

  return (
    <ErrorBoundary>
      <SafeAreaView style={styles.root}>
        {/* 标题 */}
        <Text style={styles.title}>PoC · 系统音频采集</Text>

        {/* 全局错误横幅 */}
        {errorMsg && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText} numberOfLines={3}>
              {errorMsg}
            </Text>
            <TouchableOpacity onPress={clearError} style={styles.errorDismiss}>
              <Text style={styles.errorDismissText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 控制面板 */}
        <View style={styles.card}>
          {/* 麦克风权限 */}
          <View style={styles.row}>
            <Text style={styles.label}>录音权限</Text>
            <PermissionBadge state={captureStatus === 'ready' || isCapturing || isStarting ? 'granted' : captureStatus === 'denied' ? 'denied' : 'idle'} />
            {captureStatus === 'idle' && (
              <TouchableOpacity style={styles.btnSmall} onPress={requestRecordPermission}>
                <Text style={styles.btnSmallText}>授权</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* 系统音频权限 */}
          {Platform.OS === 'android' && (
            <View style={styles.row}>
              <Text style={styles.label}>系统音频</Text>
              <PermissionBadge state={systemAuth} />
              <TouchableOpacity
                style={[styles.btnSmall, systemAuth === 'requesting' && styles.btnDisabled]}
                onPress={requestSystemAudioPermission}
                disabled={systemAuth === 'requesting'}
              >
                {systemAuth === 'requesting' ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.btnSmallText}>授权</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* 采集控制 */}
          <View style={styles.divider} />
          <TouchableOpacity
            style={[
              styles.btnPrimary,
              isCapturing && styles.btnDanger,
              (!canStart && !isCapturing) && styles.btnDisabled,
              isStarting && styles.btnDisabled,
            ]}
            onPress={isCapturing ? stopCapture : startCapture}
            disabled={(!canStart && !isCapturing) || isStarting}
          >
            {isStarting ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text style={styles.btnPrimaryText}>
                {isCapturing ? '⏹ 停止采集' : '▶ 开始采集'}
              </Text>
            )}
          </TouchableOpacity>

          {/* 状态指示器 */}
          <View style={styles.statusRow}>
            <View style={[styles.dot, isCapturing ? styles.dotActive : styles.dotInactive]} />
            <Text style={styles.statusText}>
              {isCapturing ? '采集中 (16kHz PCM)' : isStarting ? '启动中...' : '待命'}
            </Text>
          </View>
        </View>

        {/* 日志区 */}
        <View style={styles.logCard}>
          <Text style={styles.logTitle}>事件日志</Text>
          <ScrollView
            ref={scrollRef}
            style={styles.logScroll}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          >
            {logs.length === 0 ? (
              <Text style={styles.logEmpty}>暂无日志，点击上方按钮开始</Text>
            ) : (
              logs.map((log, i) => (
                <Text
                  key={i}
                  style={[
                    styles.logLine,
                    log.level === 'error' && styles.logError,
                    log.level === 'warn' && styles.logWarn,
                  ]}
                >
                  <Text style={styles.logTs}>[{log.ts}]</Text> {log.text}
                </Text>
              ))
            )}
          </ScrollView>
        </View>
      </SafeAreaView>
    </ErrorBoundary>
  );
}

// ── 权限状态小圆标 ────────────────────────────
function PermissionBadge({ state }: { state: AuthState }) {
  const config: Record<AuthState, { color: string; label: string }> = {
    idle: { color: '#666', label: '未授权' },
    requesting: { color: '#F59E0B', label: '请求中' },
    granted: { color: '#10B981', label: '已授权' },
    denied: { color: '#EF4444', label: '已拒绝' },
  };
  const { color, label } = config[state];
  return (
    <View style={[badgeStyles.badge, { backgroundColor: color + '22', borderColor: color }]}>
      <Text style={[badgeStyles.text, { color }]}>{label}</Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    marginRight: 8,
  },
  text: { fontSize: 11, fontWeight: '600' },
});

// ── 样式 ──────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F0F0F',
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F0F0F0',
    textAlign: 'center',
    marginBottom: 16,
  },

  // 错误横幅
  errorBanner: {
    flexDirection: 'row',
    backgroundColor: '#7F1D1D',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  errorBannerText: {
    flex: 1,
    color: '#FCA5A5',
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  errorDismiss: { paddingLeft: 12 },
  errorDismissText: { color: '#FCA5A5', fontSize: 16, fontWeight: '700' },

  // 控制卡片
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  label: {
    flex: 1,
    color: '#CCC',
    fontSize: 15,
  },
  divider: {
    height: 1,
    backgroundColor: '#2A2A2A',
    marginVertical: 12,
  },
  btnSmall: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  btnSmallText: { color: '#FFF', fontSize: 13, fontWeight: '600' },
  btnPrimary: {
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 12,
  },
  btnDanger: { backgroundColor: '#EF4444' },
  btnDisabled: { backgroundColor: '#374151', opacity: 0.6 },
  btnPrimaryText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  dotActive: { backgroundColor: '#10B981' },
  dotInactive: { backgroundColor: '#666' },
  statusText: { color: '#999', fontSize: 13 },

  // 日志
  logCard: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  logTitle: { color: '#999', fontSize: 13, fontWeight: '600', marginBottom: 8 },
  logScroll: { flex: 1 },
  logEmpty: { color: '#555', fontSize: 13, textAlign: 'center', marginTop: 20 },
  logLine: {
    color: '#CCC',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 4,
    lineHeight: 18,
  },
  logTs: { color: '#666' },
  logError: { color: '#FCA5A5' },
  logWarn: { color: '#FCD34D' },
});
