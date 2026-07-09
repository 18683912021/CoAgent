/** 采集参数配置 */
export interface AudioCaptureConfig {
  /** 采样率 (Hz)，默认 16000 */
  sampleRate: number;
  /** 通道数，默认 1 */
  channelCount: number;
  /** 编码格式 */
  encoding: 'pcm_16bit' | 'pcm_8bit' | 'pcm_float';
}

/** 模块运行状态 */
export type AudioCaptureStatus =
  | 'idle'
  | 'starting'
  | 'capturing'
  | 'stopping'
  | 'error';

/** 原生模块接口 */
export interface IAudioCaptureNative {
  isSupported(): Promise<boolean>;
  configure(config: AudioCaptureConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  getAudioLevel(): Promise<number>;
}
