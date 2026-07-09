/** 采集源类型 */
export type CaptureSource = 'mic' | 'system' | 'both';

/** 采集参数配置 */
export interface AudioCaptureConfig {
  /** 采样率 (Hz)，默认 16000 */
  sampleRate: number;
  /** 通道数，默认 1（system 模式下强制立体声） */
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

/** 双路音量电平 */
export interface AudioLevels {
  mic: number;
  system: number;
}

/** 原生模块接口 */
export interface IAudioCaptureNative {
  isSupported(): Promise<boolean>;
  hasMediaProjection(): Promise<boolean>;
  requestMediaProjection(): Promise<boolean>;
  setCaptureSource(source: string): Promise<void>;
  getCaptureSource(): Promise<string>;
  configure(config: AudioCaptureConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  getAudioLevels(): Promise<AudioLevels>;
}
