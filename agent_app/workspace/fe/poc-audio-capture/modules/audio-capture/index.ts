import AudioCaptureModule from './src/AudioCaptureModule';

/**
 * 系统音频采集模块
 *
 * Android: AudioPlaybackCapture API (Android 10+)
 * iOS: AVAudioSession (stub, 后续接 ReplayKit Broadcast Upload Extension)
 */
export default AudioCaptureModule;

export type {
  AudioCaptureConfig,
  AudioCaptureStatus,
} from './src/AudioCapture.types';
