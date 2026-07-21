import {
  NativeEventEmitter,
  NativeModules,
  type EmitterSubscription,
} from 'react-native';

import type {
  AudioCaptureNativeModule,
  AudioCapabilities,
  AudioLevels,
  CaptureResult,
  CaptureSnapshot,
  CaptureSource,
  CaptureStartInfo,
  NativeCaptureError,
  NativeCaptureStateEvent,
  NativeStreamStateEvent,
  StreamStats,
  TrackSource,
} from './AudioCapture.types';

const nativeModule = NativeModules.AudioCapture as
  | AudioCaptureNativeModule
  | undefined;
const emitter = nativeModule
  ? new NativeEventEmitter(NativeModules.AudioCapture)
  : null;

function requireNative(): AudioCaptureNativeModule {
  if (!nativeModule) {
    throw new Error(
      'AudioCapture native module is unavailable. Rebuild the Android app after installing the native code.',
    );
  }
  return nativeModule;
}

function subscribe<T>(
  eventName: string,
  listener: (event: T) => void,
): EmitterSubscription | {remove(): void} {
  return emitter?.addListener(eventName, listener) ?? {remove: () => undefined};
}

export const AudioCapture = {
  isAvailable: nativeModule != null,

  getCapabilities(): Promise<AudioCapabilities> {
    return requireNative().getCapabilities();
  },

  requestProjectionConsent(): Promise<boolean> {
    return requireNative().requestProjectionConsent();
  },

  startCapture(
    operationId: string,
    source: CaptureSource,
  ): Promise<CaptureStartInfo> {
    return requireNative().startCapture({operationId, source});
  },

  stopCapture(): Promise<CaptureResult> {
    return requireNative().stopCapture();
  },

  getSnapshot(): Promise<CaptureSnapshot> {
    return requireNative().getSnapshot();
  },

  connectStream(url: string): Promise<void> {
    return requireNative().connectStream(url);
  },

  disconnectStream(): Promise<void> {
    return requireNative().disconnectStream();
  },

  retryBackfill(): Promise<void> {
    return requireNative().retryBackfill();
  },

  shareOutput(
    sessionId: string,
    source: TrackSource,
    kind: 'pcm' | 'wav',
  ): Promise<void> {
    return requireNative().shareOutput(sessionId, source, kind);
  },

  onCaptureState(listener: (event: NativeCaptureStateEvent) => void) {
    return subscribe('AudioCaptureState', listener);
  },

  onLevels(listener: (event: AudioLevels) => void) {
    return subscribe('AudioCaptureLevels', listener);
  },

  onStreamState(listener: (event: NativeStreamStateEvent) => void) {
    return subscribe('AudioStreamState', listener);
  },

  onStreamStats(listener: (event: StreamStats) => void) {
    return subscribe('AudioStreamStats', listener);
  },

  onError(listener: (event: NativeCaptureError) => void) {
    return subscribe('AudioCaptureError', listener);
  },
};
