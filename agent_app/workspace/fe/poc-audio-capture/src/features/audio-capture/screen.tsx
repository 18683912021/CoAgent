import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
  ScrollView,
  ActivityIndicator,
  PermissionsAndroid,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'react-native';
import AudioCapture, {
  type AudioCaptureConfig,
  type CaptureSource,
  type AudioLevels,
  type OutputFiles,
} from '../../../modules/audio-capture';
import AudioVisualizer from './components/AudioVisualizer';
import StatusLight, { type LightStatus } from './components/StatusLight';
import Timer from './components/Timer';
import VolumeBar from './components/VolumeBar';
import FileInfo from './components/FileInfo';
import StreamingControl from './components/StreamingControl';
import { useAudioStreamer } from './hooks/useAudioStreamer';

const SOURCES: { key: CaptureSource; label: string; desc: string }[] = [
  { key: 'mic', label: '🎤 麦克风', desc: '仅采集使用者声音' },
  { key: 'system', label: '🔊 系统音频', desc: '仅采集设备内部播放的声音' },
  { key: 'both', label: '🎤+🔊 双路', desc: '同时采集麦克风和系统音频' },
];

const TEST_CONFIG: AudioCaptureConfig = {
  sampleRate: 16000,
  channelCount: 1,
  encoding: 'pcm_16bit',
};

type AppStatus = 'idle' | 'need_auth' | 'authorizing' | 'starting' | 'capturing' | 'error' | 'stopping';

/** AppStatus → StatusLight 的 LightStatus */
function toLightStatus(s: AppStatus): LightStatus {
  if (s === 'capturing') return 'capturing';
  if (s === 'need_auth' || s === 'authorizing') return 'waiting';
  return 'stopped';
}

export default function AudioCaptureScreen(): React.ReactElement {
  const [status, setStatus] = useState<AppStatus>('idle');
  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const [captureSource, setCaptureSource] = useState<CaptureSource>('mic');
  const [hasAuth, setHasAuth] = useState<boolean>(false);
  const [levels, setLevels] = useState<AudioLevels>({ mic: 0, system: 0 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [outputFiles, setOutputFiles] = useState<OutputFiles | null>(null);
  const sourceRef = useRef<CaptureSource>('mic');

  // ── WebSocket streaming ──
  const {
    state: streamerState,
    stats: streamerStats,
    connect: streamerConnect,
    disconnect: streamerDisconnect,
    streamPcmFile,
  } = useAudioStreamer();

  // ── 初始化 ──
  useEffect(() => {
    AudioCapture.isSupported()
      .then(setIsSupported)
      .catch(() => setIsSupported(false));
  }, []);

  // ── 切换采集源 ──
  const handleSourceChange = useCallback(async (source: CaptureSource) => {
    setCaptureSource(source);
    sourceRef.current = source;
    setErrorMsg(null);
    setOutputFiles(null);

    try {
      await AudioCapture.setCaptureSource(source);
    } catch {
      // 非关键路径
    }

    if (source === 'system' || source === 'both') {
      const authed = await AudioCapture.hasMediaProjection();
      setHasAuth(authed);
      if (!authed) setStatus('need_auth');
    } else {
      setHasAuth(false);
      setStatus('idle');
    }
  }, []);

  // ── MediaProjection 授权 ──
  const handleAuthorize = useCallback(async () => {
    try {
      setStatus('authorizing');
      setErrorMsg(null);
      const ok = await AudioCapture.requestMediaProjection();
      setHasAuth(ok);
      if (ok) {
        setStatus('idle');
      } else {
        setStatus('need_auth');
        Alert.alert('授权被拒绝', '系统音频采集需要屏幕录制权限，请在下次弹窗中允许');
      }
    } catch (err: any) {
      setStatus('need_auth');
      setErrorMsg(err.message ?? '授权失败');
      Alert.alert('授权失败', err.message ?? '未知错误');
    }
  }, []);

  // ── 开始采集 ──
  const handleStart = useCallback(async () => {
    try {
      setErrorMsg(null);
      setOutputFiles(null);

      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: '麦克风权限',
            message: '音频采集需要麦克风权限',
            buttonPositive: '允许',
            buttonNegative: '拒绝',
          },
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert('权限被拒绝', '请在系统设置中开启麦克风权限');
          return;
        }
      }

      setStatus('starting');
      await AudioCapture.configure(TEST_CONFIG);
      await AudioCapture.start();
      setStatus('capturing');
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message ?? '启动失败');
      Alert.alert('启动失败', err.message ?? '未知错误');
    }
  }, []);

  // ── 停止采集 ──
  const handleStop = useCallback(async () => {
    try {
      setStatus('stopping');
      await AudioCapture.stop();
      // 获取输出文件路径
      const files = await AudioCapture.getOutputFiles();
      setOutputFiles(files);
      setStatus('idle');
      setLevels({ mic: 0, system: 0 });
    } catch (err: any) {
      setErrorMsg(err.message ?? '停止失败');
      setStatus('error');
    }
  }, []);

  // ── 电平轮询 ──
  useEffect(() => {
    if (status !== 'capturing') return;
    const timer = setInterval(() => {
      AudioCapture.getAudioLevels()
        .then(setLevels)
        .catch(() => {});
    }, 100);
    return () => clearInterval(timer);
  }, [status]);

  // ── 派生状态 ──
  const isBusy = status === 'starting' || status === 'capturing' || status === 'stopping';
  const isActive = status === 'capturing';
  const needsAuth = (captureSource === 'system' || captureSource === 'both') && !hasAuth;
  const canStart = (status === 'idle' || status === 'error') && !needsAuth;

  // WebSocket streaming: send PCM file
  const handleStreamFile = useCallback(async (source: 'mic' | 'system') => {
    if (!outputFiles) return;
    const fileUri = outputFiles[source];
    if (!fileUri) return;
    try {
      await streamPcmFile(fileUri);
    } catch (e) {
      console.error('[Stream]', e);
    }
  }, [outputFiles, streamPcmFile]);
  const showDualViz = captureSource === 'both';
  const lightStatus = toLightStatus(status);

  // VolumeBar 使用的电平：根据采集源选 mic/system，both 取 max
  const volumeLevel =
    captureSource === 'mic'
      ? levels.mic
      : captureSource === 'system'
        ? levels.system
        : Math.max(levels.mic, levels.system);

  const isDark = useColorScheme() === 'dark';

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={isDark ? '#0a0a0a' : '#f0f2f5'}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {/* 标题 */}
        <Text style={styles.title}>🎙️ Audio Capture PoC</Text>
        <Text style={styles.subtitle}>双路音频采集验证（麦克风 + 系统内部音频）</Text>

        {/* ── 状态灯 + 计时器 ── */}
        <View style={styles.statusRow}>
          <StatusLight status={lightStatus} />
          <Timer isActive={isActive} />
        </View>

        {/* ── 采集源选择 ── */}
        <Text style={styles.sectionTitle}>采集源</Text>
        <View style={styles.sourceRow}>
          {SOURCES.map((s) => {
            const active = captureSource === s.key;
            return (
              <TouchableOpacity
                key={s.key}
                style={[styles.sourceChip, active && styles.sourceChipActive]}
                onPress={() => handleSourceChange(s.key)}
                disabled={isBusy}
                activeOpacity={0.7}
              >
                <Text style={[styles.sourceChipText, active && styles.sourceChipTextActive]}>
                  {s.label}
                </Text>
                <Text style={[styles.sourceChipDesc, active && styles.sourceChipDescActive]}>
                  {s.desc}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── MediaProjection 授权横幅 ── */}
        {needsAuth && status !== 'authorizing' && (
          <View style={styles.authBanner}>
            <Text style={styles.authBannerIcon}>🔐</Text>
            <Text style={styles.authBannerText}>
              系统音频采集需要"屏幕录制"授权，Android 会弹出系统对话框
            </Text>
            <TouchableOpacity style={styles.authButton} onPress={handleAuthorize} activeOpacity={0.8}>
              <Text style={styles.authButtonText}>授权系统音频</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 音量条 ── */}
        <View style={styles.volumeSection}>
          <VolumeBar level={volumeLevel} isActive={isActive} />
        </View>

        {/* ── 可视化区域 ── */}
        {showDualViz ? (
          <View style={styles.dualVizRow}>
            <AudioVisualizer
              level={levels.mic}
              isActive={isActive}
              label="麦克风"
              colorScheme="warm"
            />
            <AudioVisualizer
              level={levels.system}
              isActive={isActive}
              label="系统音频"
              colorScheme="cool"
            />
          </View>
        ) : (
          <AudioVisualizer
            level={captureSource === 'mic' ? levels.mic : levels.system}
            isActive={isActive}
            label={captureSource === 'mic' ? '麦克风' : '系统音频'}
            colorScheme={captureSource === 'mic' ? 'warm' : 'cool'}
          />
        )}

        {/* ── 状态双列卡片 ── */}
        <View style={styles.rowCards}>
          <View style={styles.miniCard}>
            <Text style={styles.miniCardTitle}>设备</Text>
            {isSupported === null ? (
              <View style={styles.row}>
                <ActivityIndicator size="small" color="#007AFF" />
                <Text style={styles.miniCardValue}>检测中...</Text>
              </View>
            ) : (
              <Text style={[styles.miniCardValue, { color: isSupported ? '#34C759' : '#FF3B30' }]}>
                {isSupported ? '✅ Android 10+' : '❌ 不兼容'}
              </Text>
            )}
          </View>
          <View style={styles.miniCard}>
            <Text style={styles.miniCardTitle}>运行状态</Text>
            <Text style={styles.miniCardValue}>
              {status === 'idle' && '⏸️ 空闲'}
              {status === 'need_auth' && '🔐 待授权'}
              {status === 'authorizing' && '🔄 授权中...'}
              {status === 'starting' && '🔄 启动中...'}
              {status === 'capturing' && '🔴 采集中'}
              {status === 'error' && '⚠️ 错误'}
              {status === 'stopping' && '🔄 停止中...'}
            </Text>
          </View>
        </View>

        {/* ── 错误信息 ── */}
        {errorMsg && (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>⚠️ 错误详情</Text>
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        {/* ── 配置卡片 ── */}
        <View style={styles.configCard}>
          <Text style={styles.configTitle}>采集参数</Text>
          <View style={styles.configGrid}>
            <View style={styles.configItem}>
              <Text style={styles.configLabel}>采样率</Text>
              <Text style={styles.configValue}>{TEST_CONFIG.sampleRate} Hz</Text>
            </View>
            <View style={styles.configItem}>
              <Text style={styles.configLabel}>声道</Text>
              <Text style={styles.configValue}>{TEST_CONFIG.channelCount}</Text>
            </View>
            <View style={styles.configItem}>
              <Text style={styles.configLabel}>编码</Text>
              <Text style={styles.configValue}>{TEST_CONFIG.encoding}</Text>
            </View>
            <View style={styles.configItem}>
              <Text style={styles.configLabel}>平台</Text>
              <Text style={styles.configValue}>
                {Platform.OS} {Platform.Version}
              </Text>
            </View>
          </View>
        </View>

        {/* ── 文件信息 ── */}
        <FileInfo files={outputFiles} captureSource={captureSource} />

        {/* ── WebSocket Streaming ── */}
        <StreamingControl
          streamerState={streamerState}
          stats={streamerStats}
          onConnect={streamerConnect}
          onDisconnect={streamerDisconnect}
          disabled={isBusy}
        />

        {/* Stream PCM button: visible when WS connected and files ready */}
        {streamerState === 'connected' && outputFiles && (
          <View style={styles.streamButtons}>
            {outputFiles.mic ? (
              <TouchableOpacity
                style={[styles.button, styles.buttonStream]}
                onPress={() => handleStreamFile('mic')}
                activeOpacity={0.8}
              >
                <Text style={styles.buttonText}>{'📤 Stream MIC PCM'}</Text>
              </TouchableOpacity>
            ) : null}
            {outputFiles.system ? (
              <TouchableOpacity
                style={[styles.button, styles.buttonStream]}
                onPress={() => handleStreamFile('system')}
                activeOpacity={0.8}
              >
                <Text style={styles.buttonText}>{'📤 Stream System PCM'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {/* ── 控制按钮 ── */}
        {isBusy ? (
          <TouchableOpacity
            style={[styles.button, styles.buttonStop]}
            onPress={handleStop}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>⏹️ 停止采集</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.button, styles.buttonStart, !canStart && styles.buttonDisabled]}
            onPress={canStart ? handleStart : undefined}
            activeOpacity={0.8}
          >
            {status === 'authorizing' ? (
              <View style={styles.row}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.buttonText}>  授权中...</Text>
              </View>
            ) : (
              <Text style={styles.buttonText}>
                {needsAuth ? '🔐 请先授权系统音频' : '▶️ 开始采集'}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {!isSupported && (
          <Text style={styles.warning}>
            ⚠️ 设备不支持系统音频采集，请使用 Android 10+ 真机测试
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f2f5',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1a1a2e',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 20,
  },

  // ── 状态灯 + 计时器行 ──
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },

  // ── 采集源 ──
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  sourceRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  sourceChip: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  sourceChipActive: {
    borderColor: '#1a1a2e',
    backgroundColor: '#1a1a2e',
  },
  sourceChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
    marginBottom: 2,
  },
  sourceChipTextActive: {
    color: '#fff',
  },
  sourceChipDesc: {
    fontSize: 10,
    color: '#aaa',
    textAlign: 'center',
  },
  sourceChipDescActive: {
    color: 'rgba(255,255,255,0.7)',
  },

  // ── 音量条区域 ──
  volumeSection: {
    marginBottom: 16,
  },

  // ── 授权 ──
  authBanner: {
    backgroundColor: '#FFF9E6',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#FFD43B',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  authBannerIcon: {
    fontSize: 24,
  },
  authBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#8B6914',
    lineHeight: 18,
  },
  authButton: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    width: '100%',
    marginTop: 8,
    alignItems: 'center',
  },
  authButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },

  // ── 双路可视化 ──
  dualVizRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },

  // ── 双列卡片 ──
  rowCards: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  miniCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  miniCardTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  miniCardValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
  },

  // ── 错误 ──
  errorCard: {
    backgroundColor: '#fff2f0',
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#FF3B30',
  },
  errorTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FF3B30',
    marginBottom: 4,
  },
  errorText: {
    fontSize: 13,
    color: '#8b0000',
    lineHeight: 18,
  },

  // ── 配置 ──
  configCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  configTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  configGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  configItem: {
    flex: 1,
    minWidth: '40%',
  },
  configLabel: {
    fontSize: 11,
    color: '#aaa',
  },
  configValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginTop: 2,
  },

  // ── 通用 ──
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  // ── 按钮 ──
  button: {
    marginTop: 24,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonStart: {
    backgroundColor: '#1a1a2e',
  },
  buttonStop: {
    backgroundColor: '#FF3B30',
  },
  buttonDisabled: {
    backgroundColor: '#999',
  },
  buttonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },

  warning: {
    marginTop: 16,
    fontSize: 13,
    color: '#FF9500',
    textAlign: 'center',
    lineHeight: 18,
  },

  // ── Stream buttons ──
  streamButtons: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  buttonStream: {
    backgroundColor: '#8B5CF6',
    flex: 1,
  },
});
