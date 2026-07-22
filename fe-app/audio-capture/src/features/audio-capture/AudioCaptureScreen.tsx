import React, {useMemo, useState} from 'react';
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import type {CaptureSource} from '../../native/audio-capture';
import {AudioVisualizer} from './components/AudioVisualizer';
import {StatusLight} from './components/StatusLight';
import {StreamingControl} from './components/StreamingControl';
import {Timer} from './components/Timer';
import {VolumeBar} from './components/VolumeBar';
import {useAudioCaptureController} from './hooks/useAudioCaptureController';

const SOURCES: Array<{key: CaptureSource; label: string; subtitle: string}> = [
  {key: 'mic', label: '麦克风', subtitle: '设备麦克风'},
  {key: 'system', label: '系统音频', subtitle: '播放采集'},
  {key: 'both', label: '双轨采集', subtitle: '独立双轨'},
];

export default function AudioCaptureScreen(): React.JSX.Element {
  const controller = useAudioCaptureController();
  const {state} = controller;
  const dark = useColorScheme() === 'dark';
  const [streamUrl, setStreamUrl] = useState(
    __DEV__ ? 'ws://192.168.7.149:8010/api/ws/audio/stream' : '',
  );

  const active = state.captureState === 'capturing';
  const actionDisabled = ['preparing', 'stopping', 'finalizing'].includes(
    state.captureState,
  );
  const canStart =
    !actionDisabled &&
    !active &&
    (state.source === 'mic' ||
      (controller.canUseSystem && state.projectionGranted));
  const systemUnavailable = state.capabilities?.systemAudio === false;

  const background = dark ? '#020617' : '#f1f5f9';
  const heading = dark ? '#f8fafc' : '#0f172a';

  const statusSummary = useMemo(() => {
    if (!state.capabilities) {return '正在检查 Android 音频能力…';}
    if (systemUnavailable) {
      return `Android API ${state.capabilities.apiLevel}：仅支持麦克风。系统音频需要 API 29+。`;
    }
    return `Android API ${state.capabilities.apiLevel}：麦克风、系统音频、双轨采集均可用。`;
  }, [state.capabilities, systemUnavailable]);

  return (
    <SafeAreaView style={[styles.safeArea, {backgroundColor: background}]} edges={['top', 'left', 'right']}>
      <StatusBar
        barStyle={dark ? 'light-content' : 'dark-content'}
        backgroundColor={background}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Text style={[styles.eyebrow, dark ? styles.eyebrowDark : styles.eyebrowLight]}>RN CLI · Android 原生</Text>
          <Text style={[styles.title, {color: heading}]}>音频采集实验室</Text>
          <Text style={[styles.subtitle, dark ? styles.secondaryDark : styles.secondaryLight]}>
            以独立 16 kHz 单声道 PCM 轨道采集麦克风和 Android 系统播放音频。
          </Text>
        </View>

        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <StatusLight state={state.captureState} />
            <Timer startedAtUtc={state.startedAtUtc} active={active} />
          </View>
          <Text style={styles.supportText}>{statusSummary}</Text>
        </View>

        <Section title="采集来源">
          <View style={styles.sourceGrid}>
            {SOURCES.map(item => {
              const selected = state.source === item.key;
              const disabled =
                controller.isBusy ||
                (item.key !== 'mic' && systemUnavailable);
              return (
                <TouchableOpacity
                  key={item.key}
                  accessibilityRole="button"
                  accessibilityState={{selected, disabled}}
                  disabled={disabled}
                  onPress={() => controller.setSource(item.key)}
                  style={[
                    styles.sourceButton,
                    selected && styles.sourceButtonSelected,
                    disabled && styles.disabled,
                  ]}>
                  <Text
                    style={[
                      styles.sourceLabel,
                      selected && styles.sourceLabelSelected,
                    ]}>
                    {item.label}
                  </Text>
                  <Text
                    style={[
                      styles.sourceSubtitle,
                      selected && styles.sourceSubtitleSelected,
                    ]}>
                    {item.subtitle}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {controller.needsProjection && !state.projectionGranted ? (
            <View style={styles.authorizationBox}>
              <Text style={styles.authorizationTitle}>需要系统音频授权</Text>
              <Text style={styles.authorizationText}>
                Android 将弹出屏幕采集授权对话框。每次 SYSTEM/BOTH 会话都需要新的授权。
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                style={[styles.authorizationButton, actionDisabled && styles.disabled]}
                disabled={actionDisabled || !controller.canUseSystem}
                onPress={controller.authorizeSystemAudio}>
                <Text style={styles.authorizationButtonText}>授权系统音频</Text>
              </TouchableOpacity>
            </View>
          ) : controller.needsProjection ? (
            <Text style={styles.authorizedText}>✓ 授权已就绪，可用于下一次采集</Text>
          ) : null}
        </Section>

        <Section title="实时电平">
          <VolumeBar label="麦克风" level={state.levels.mic} color="#f97316" />
          <AudioVisualizer level={state.levels.mic} color="#f97316" active={active && state.source !== 'system'} />
          {state.source !== 'mic' ? (
            <>
              <VolumeBar label="系统音频" level={state.levels.system} color="#2563eb" />
              <AudioVisualizer level={state.levels.system} color="#2563eb" active={active} />
            </>
          ) : null}
        </Section>

        {state.streamState === 'ready' || state.micTranscription ? (
          <Section title="麦克风识别">
            {state.micTranscription ? (
              <Text style={[styles.transcriptionText, state.micTranscriptionFinal && styles.transcriptionFinal]}>
                {state.micTranscription}
              </Text>
            ) : null}
            {!state.micTranscriptionFinal && (
              <Text style={styles.transcribingHint}>{state.micTranscription ? '识别中…' : '等待语音…'}</Text>
            )}
          </Section>
        ) : null}
        {state.source !== 'mic' && (state.streamState === 'ready' || state.sysTranscription) ? (
          <Section title="设备音频识别">
            {state.sysTranscription ? (
              <Text style={[styles.transcriptionText, state.sysTranscriptionFinal && styles.transcriptionFinal]}>
                {state.sysTranscription}
              </Text>
            ) : null}
            {!state.sysTranscriptionFinal && (
              <Text style={styles.transcribingHint}>{state.sysTranscription ? '识别中…' : '等待语音…'}</Text>
            )}
          </Section>
        ) : null}

        <Section title="规范化输出">
          <View style={styles.parameterGrid}>
            <Parameter label="采样率" value="16,000 Hz" />
            <Parameter label="编码" value="PCM 16-bit LE" />
            <Parameter label="声道" value="每轨单声道" />
            <Parameter label="网络分片" value="40 ms / 1280 B" />
          </View>
          <Text style={styles.parameterNote}>
            设备格式不规范时由原生层规范化后再推流和写入文件。双轨采集不会混音。
          </Text>
        </Section>

        <StreamingControl
          url={streamUrl}
          onChangeUrl={setStreamUrl}
          state={state.streamState}
          stats={state.streamStats}
          message={state.streamMessage}
          onConnect={() => controller.connect(streamUrl)}
          onDisconnect={controller.disconnect}
          disabled={state.streamState === 'connecting'}
        />

        {state.error ? (
          <View style={styles.errorCard} accessibilityRole="alert">
            <View style={styles.errorHeader}>
              <Text style={styles.errorTitle}>
                [AudioCapture] {state.error.code}
              </Text>
              <TouchableOpacity onPress={controller.clearError} accessibilityRole="button">
                <Text style={styles.errorDismiss}>关闭</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.errorMessage}>{state.error.message}</Text>
            <Text style={styles.errorMeta}>
              阶段：{state.error.stage}
              {state.error.source ? ` · 来源：${state.error.source}` : ''}
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={active ? 'Stop audio capture' : 'Start audio capture'}
          disabled={active ? false : !canStart}
          onPress={active ? controller.stop : controller.start}
          style={[
            styles.primaryButton,
            active ? styles.stopButton : styles.startButton,
            !active && !canStart && styles.disabled,
          ]}>
          <Text style={styles.primaryButtonText}>
            {state.captureState === 'preparing'
              ? '准备中…'
              : state.captureState === 'stopping'
                ? '停止中…'
                : state.captureState === 'finalizing'
                  ? '正在完成文件…'
                  : active
                    ? '停止采集'
                    : '开始采集'}
          </Text>
        </TouchableOpacity>

        <Text style={[styles.footnote, dark ? styles.footnoteDark : styles.footnoteLight]}>
          系统播放采集取决于源应用是否允许 AudioPlaybackCapture。受 DRM、通话和受保护媒体可能因 Android 策略而静音。
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({title, children}: React.PropsWithChildren<{title: string}>) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Parameter({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.parameter}>
      <Text style={styles.parameterLabel}>{label}</Text>
      <Text style={styles.parameterValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {flex: 1},
  content: {padding: 16, paddingBottom: 40, gap: 14},
  hero: {paddingHorizontal: 4, paddingVertical: 8},
  eyebrow: {fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1},
  eyebrowDark: {color: '#60a5fa'},
  eyebrowLight: {color: '#2563eb'},
  title: {fontSize: 31, fontWeight: '900', marginTop: 4},
  subtitle: {fontSize: 14, lineHeight: 20, marginTop: 5},
  secondaryDark: {color: '#94a3b8'},
  secondaryLight: {color: '#64748b'},
  statusCard: {backgroundColor: '#fff', borderRadius: 18, padding: 18, borderWidth: 1, borderColor: '#e2e8f0', gap: 12},
  statusRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  supportText: {fontSize: 12, lineHeight: 18, color: '#64748b'},
  section: {backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 13, borderWidth: 1, borderColor: '#e2e8f0'},
  sectionTitle: {fontSize: 17, fontWeight: '900', color: '#0f172a'},
  sourceGrid: {flexDirection: 'row', gap: 8},
  sourceButton: {flex: 1, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#f8fafc'},
  sourceButtonSelected: {backgroundColor: '#dbeafe', borderColor: '#2563eb'},
  sourceLabel: {fontSize: 13, fontWeight: '800', color: '#334155'},
  sourceLabelSelected: {color: '#1d4ed8'},
  sourceSubtitle: {fontSize: 10, color: '#64748b', marginTop: 3},
  sourceSubtitleSelected: {color: '#3b82f6'},
  disabled: {opacity: 0.42},
  authorizationBox: {backgroundColor: '#fff7ed', borderRadius: 12, padding: 13, gap: 8, borderWidth: 1, borderColor: '#fed7aa'},
  authorizationTitle: {fontSize: 14, fontWeight: '800', color: '#9a3412'},
  authorizationText: {fontSize: 12, lineHeight: 18, color: '#7c2d12'},
  authorizationButton: {backgroundColor: '#ea580c', borderRadius: 9, paddingVertical: 9, alignItems: 'center'},
  authorizationButtonText: {color: '#fff', fontWeight: '800'},
  authorizedText: {fontSize: 12, fontWeight: '700', color: '#15803d'},
  parameterGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  parameter: {width: '48%', borderRadius: 10, backgroundColor: '#f1f5f9', padding: 10},
  parameterLabel: {fontSize: 10, textTransform: 'uppercase', fontWeight: '700', color: '#64748b'},
  parameterValue: {fontSize: 13, fontWeight: '800', color: '#0f172a', marginTop: 3},
  parameterNote: {fontSize: 11, lineHeight: 17, color: '#64748b'},
  errorCard: {backgroundColor: '#fef2f2', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#fecaca', gap: 6},
  errorHeader: {flexDirection: 'row', justifyContent: 'space-between'},
  errorTitle: {fontSize: 14, fontWeight: '900', color: '#b91c1c'},
  errorDismiss: {fontSize: 12, fontWeight: '800', color: '#991b1b'},
  errorMessage: {fontSize: 13, lineHeight: 18, color: '#7f1d1d'},
  errorMeta: {fontSize: 11, color: '#b91c1c'},
  retryButton: {backgroundColor: '#f59e0b', borderRadius: 9, paddingVertical: 10, alignItems: 'center'},
  retryButtonText: {fontWeight: '800', color: '#fff'},
  transcriptionText: {fontSize: 16, lineHeight: 26, color: '#0f172a'},
  transcriptionFinal: {fontWeight: '700'},
  transcribingHint: {fontSize: 12, color: '#f59e0b', marginTop: 4},
  primaryButton: {borderRadius: 15, paddingVertical: 15, alignItems: 'center'},
  startButton: {backgroundColor: '#16a34a'},
  stopButton: {backgroundColor: '#dc2626'},
  primaryButtonText: {color: '#fff', fontSize: 16, fontWeight: '900'},
  footnote: {fontSize: 11, lineHeight: 16, textAlign: 'center', paddingHorizontal: 12},
  footnoteDark: {color: '#64748b'},
  footnoteLight: {color: '#94a3b8'},
});
