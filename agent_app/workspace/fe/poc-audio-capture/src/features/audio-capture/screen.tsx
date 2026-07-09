import React, { useCallback, useEffect, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AudioCapture, {
  type AudioCaptureConfig,
  type AudioCaptureStatus,
} from '../../../modules/audio-capture';
import AudioVisualizer from './components/AudioVisualizer';

const TEST_CONFIG: AudioCaptureConfig = {
  sampleRate: 16000,
  channelCount: 1,
  encoding: 'pcm_16bit',
};

export default function AudioCaptureScreen(): React.ReactElement {
  const [status, setStatus] = useState<AudioCaptureStatus>('idle');
  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    AudioCapture.isSupported()
      .then(setIsSupported)
      .catch(() => setIsSupported(false));
  }, []);

  const handleStart = useCallback(async () => {
    try {
      setErrorMsg(null);

      // Android 6.0+ 运行时权限：RECORD_AUDIO 必须动态申请
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: '麦克风权限',
            message: '系统音频采集需要麦克风权限来验证采集管道',
            buttonPositive: '允许',
            buttonNegative: '拒绝',
          },
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert('权限被拒绝', '麦克风权限是采集音频的必要条件，请在系统设置中手动开启');
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

  const handleStop = useCallback(async () => {
    try {
      await AudioCapture.stop();
      setStatus('idle');
      setAudioLevel(0);
    } catch (err: any) {
      setErrorMsg(err.message ?? '停止失败');
    }
  }, []);

  useEffect(() => {
    if (status !== 'capturing') return;

    const timer = setInterval(() => {
      AudioCapture.getAudioLevel()
        .then(setAudioLevel)
        .catch(() => {});
    }, 100);

    return () => clearInterval(timer);
  }, [status]);

  const isBusy = status === 'starting' || status === 'capturing';
  const isActive = status === 'capturing';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* 标题 */}
        <Text style={styles.title}>🎙️ Audio Capture PoC</Text>
        <Text style={styles.subtitle}>系统音频采集验证</Text>

        {/* 可视化区域 */}
        <AudioVisualizer level={audioLevel} isActive={isActive} />

        {/* 设备支持 & 状态（双列） */}
        <View style={styles.rowCards}>
          <View style={styles.miniCard}>
            <Text style={styles.miniCardTitle}>设备检测</Text>
            {isSupported === null ? (
              <View style={styles.row}>
                <ActivityIndicator size="small" color="#007AFF" />
                <Text style={styles.miniCardValue}>检测中...</Text>
              </View>
            ) : (
              <Text
                style={[
                  styles.miniCardValue,
                  { color: isSupported ? '#34C759' : '#FF3B30' },
                ]}
              >
                {isSupported ? '✅ 支持' : '❌ 不支持'}
              </Text>
            )}
          </View>

          <View style={styles.miniCard}>
            <Text style={styles.miniCardTitle}>运行状态</Text>
            <Text style={styles.miniCardValue}>
              {status === 'idle' && '⏸️ 空闲'}
              {status === 'starting' && '🔄 启动中...'}
              {status === 'capturing' && '🔴 采集中'}
              {status === 'error' && '⚠️ 错误'}
              {status === 'stopping' && '🔄 停止中...'}
            </Text>
          </View>
        </View>

        {/* 错误信息 */}
        {errorMsg && (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>⚠️ 错误详情</Text>
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        {/* 配置信息 */}
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

        {/* 控制按钮 */}
        <TouchableOpacity
          style={[styles.button, isBusy ? styles.buttonStop : styles.buttonStart]}
          onPress={isBusy ? handleStop : handleStart}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>
            {isBusy ? '⏹️ 停止采集' : '▶️ 开始采集'}
          </Text>
        </TouchableOpacity>

        {!isSupported && (
          <Text style={styles.warning}>
            ⚠️ 设备不支持系统音频采集，请使用 Android 10+ 或 iOS 15+ 真机测试
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
    marginBottom: 24,
  },

  // 双列卡片
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

  // 错误卡片
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

  // 配置卡片
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

  // 通用
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  // 按钮
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
  buttonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },

  // 警告
  warning: {
    marginTop: 16,
    fontSize: 13,
    color: '#FF9500',
    textAlign: 'center',
    lineHeight: 18,
  },
});
