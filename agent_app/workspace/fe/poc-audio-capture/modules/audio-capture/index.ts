import AudioCaptureModule from './src/AudioCaptureModule';

/**
 * 系统音频采集模块
 *
 * Android: AudioPlaybackCapture API (Android 10+) + MIC
 * iOS: AVAudioSession (stub, 后续接 ReplayKit Broadcast Upload Extension)
 *
 * 支持三种采集模式：
 *  - mic:    仅麦克风
 *  - system: 仅系统内部音频（需 MediaProjection 授权）
 *  - both:   双路并行采集
 */
export default AudioCaptureModule;

export type {
  AudioCaptureConfig,
  AudioCaptureStatus,
  CaptureSource,
  AudioLevels,
  OutputFiles,
} from './src/AudioCapture.types';
