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
import {FileInfo} from './components/FileInfo';
import {StatusLight} from './components/StatusLight';
import {StreamingControl} from './components/StreamingControl';
import {Timer} from './components/Timer';
import {VolumeBar} from './components/VolumeBar';
import {useAudioCaptureController} from './hooks/useAudioCaptureController';

const SOURCES: Array<{key: CaptureSource; label: string; subtitle: string}> = [
  {key: 'mic', label: 'Microphone', subtitle: 'Device microphone'},
  {key: 'system', label: 'System', subtitle: 'Playback capture'},
  {key: 'both', label: 'Both', subtitle: 'Independent dual tracks'},
];

export default function AudioCaptureScreen(): React.JSX.Element {
  const controller = useAudioCaptureController();
  const {state} = controller;
  const dark = useColorScheme() === 'dark';
  const [streamUrl, setStreamUrl] = useState(
    __DEV__ ? 'ws://10.0.2.2:8010/api/ws/audio/stream' : '',
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
  const outputTracks = state.result?.tracks ?? [];
  const systemUnavailable = state.capabilities?.systemAudio === false;

  const background = dark ? '#020617' : '#f1f5f9';
  const heading = dark ? '#f8fafc' : '#0f172a';

  const statusSummary = useMemo(() => {
    if (!state.capabilities) {return 'Checking Android audio capabilities…';}
    if (systemUnavailable) {
      return `Android API ${state.capabilities.apiLevel}: microphone only. System audio requires API 29+.`;
    }
    return `Android API ${state.capabilities.apiLevel}: MIC, SYSTEM and BOTH are available.`;
  }, [state.capabilities, systemUnavailable]);

  return (
    <SafeAreaView style={[styles.safeArea, {backgroundColor: background}]} edges={['top', 'left', 'right']}>
      <StatusBar
        barStyle={dark ? 'light-content' : 'dark-content'}
        backgroundColor={background}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Text style={[styles.eyebrow, dark ? styles.eyebrowDark : styles.eyebrowLight]}>RN CLI · Android native</Text>
          <Text style={[styles.title, {color: heading}]}>Audio Capture Lab</Text>
          <Text style={[styles.subtitle, dark ? styles.secondaryDark : styles.secondaryLight]}>
            Capture microphone and Android playback audio as independent 16 kHz mono PCM tracks.
          </Text>
        </View>

        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <StatusLight state={state.captureState} />
            <Timer startedAtUtc={state.startedAtUtc} active={active} />
          </View>
          <Text style={styles.supportText}>{statusSummary}</Text>
        </View>

        <Section title="Capture source">
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
              <Text style={styles.authorizationTitle}>System authorization required</Text>
              <Text style={styles.authorizationText}>
                Android will show its screen-capture consent dialog. A fresh authorization is consumed by each SYSTEM/BOTH session.
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                style={[styles.authorizationButton, actionDisabled && styles.disabled]}
                disabled={actionDisabled || !controller.canUseSystem}
                onPress={controller.authorizeSystemAudio}>
                <Text style={styles.authorizationButtonText}>Authorize system audio</Text>
              </TouchableOpacity>
            </View>
          ) : controller.needsProjection ? (
            <Text style={styles.authorizedText}>✓ Authorization is ready for the next session</Text>
          ) : null}
        </Section>

        <Section title="Live levels">
          <VolumeBar label="Microphone" level={state.levels.mic} color="#f97316" />
          <AudioVisualizer level={state.levels.mic} color="#f97316" active={active && state.source !== 'system'} />
          {state.source !== 'mic' ? (
            <>
              <VolumeBar label="System audio" level={state.levels.system} color="#2563eb" />
              <AudioVisualizer level={state.levels.system} color="#2563eb" active={active} />
            </>
          ) : null}
        </Section>

        <Section title="Canonical output">
          <View style={styles.parameterGrid}>
            <Parameter label="Sample rate" value="16,000 Hz" />
            <Parameter label="Encoding" value="PCM 16-bit LE" />
            <Parameter label="Channels" value="Mono per track" />
            <Parameter label="Network chunk" value="40 ms / 1280 B" />
          </View>
          <Text style={styles.parameterNote}>
            Unsupported device formats are normalized natively before streaming and file output. BOTH never mixes the two tracks.
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
              <Text style={styles.errorTitle}>{state.error.code}</Text>
              <TouchableOpacity onPress={controller.clearError} accessibilityRole="button">
                <Text style={styles.errorDismiss}>Dismiss</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.errorMessage}>{state.error.message}</Text>
            <Text style={styles.errorMeta}>
              Stage: {state.error.stage}
              {state.error.source ? ` · Source: ${state.error.source}` : ''}
            </Text>
          </View>
        ) : null}

        {outputTracks.length > 0 ? (
          <Section title="Captured files">
            {outputTracks.map(track => (
              <FileInfo
                key={track.source}
                track={track}
                onShare={kind => controller.shareOutput(track.source, kind)}
              />
            ))}
            {state.pendingBackfill ? (
              <TouchableOpacity
                accessibilityRole="button"
                style={styles.retryButton}
                onPress={controller.retryBackfill}>
                <Text style={styles.retryButtonText}>Retry complete-file backfill</Text>
              </TouchableOpacity>
            ) : null}
          </Section>
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
              ? 'Preparing…'
              : state.captureState === 'stopping'
                ? 'Stopping…'
                : state.captureState === 'finalizing'
                  ? 'Finalizing files…'
                  : active
                    ? 'Stop capture'
                    : 'Start capture'}
          </Text>
        </TouchableOpacity>

        <Text style={[styles.footnote, dark ? styles.footnoteDark : styles.footnoteLight]}>
          System playback capture depends on the source app allowing AudioPlaybackCapture. DRM, calls and protected media may remain silent by Android policy.
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
  primaryButton: {borderRadius: 15, paddingVertical: 15, alignItems: 'center'},
  startButton: {backgroundColor: '#16a34a'},
  stopButton: {backgroundColor: '#dc2626'},
  primaryButtonText: {color: '#fff', fontSize: 16, fontWeight: '900'},
  footnote: {fontSize: 11, lineHeight: 16, textAlign: 'center', paddingHorizontal: 12},
  footnoteDark: {color: '#64748b'},
  footnoteLight: {color: '#94a3b8'},
});
