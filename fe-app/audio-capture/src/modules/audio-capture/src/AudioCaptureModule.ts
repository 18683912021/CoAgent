import { NativeModules } from 'react-native';
import type { AudioCaptureConfig, AudioLevels, CaptureSource, OutputFiles } from './AudioCapture.types';

const MODULE_NAME = 'AudioCapture';

interface AudioCaptureNative {
  isSupported(): Promise<boolean>;
  hasMediaProjection(): Promise<boolean>;
  requestMediaProjection(): Promise<boolean>;
  setCaptureSource(source: string): Promise<void>;
  getCaptureSource(): Promise<string>;
  configure(config: AudioCaptureConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  getAudioLevels(): Promise<AudioLevels>;
  getOutputFiles(): Promise<OutputFiles>;
}

const Native: AudioCaptureNative | null =
  NativeModules[MODULE_NAME] ?? null;

/**
 * RN Native Module 桥接层
 *
 * 通过 NativeModules 调用 Kotlin 层。
 * 如果原生模块不存在，所有方法返回 fallback。
 */
class AudioCaptureModule {
  /** 检查当前设备是否支持系统音频采集 (Android 10+) */
  async isSupported(): Promise<boolean> {
    if (!Native) return false;
    try {
      return await Native.isSupported();
    } catch {
      return false;
    }
  }

  /** 是否已获得 MediaProjection 授权 */
  async hasMediaProjection(): Promise<boolean> {
    if (!Native) return false;
    try {
      return await Native.hasMediaProjection();
    } catch {
      return false;
    }
  }

  /**
   * 请求系统音频采集授权（弹出系统级对话框）
   * @returns true=用户同意授权, false=用户拒绝
   */
  async requestMediaProjection(): Promise<boolean> {
    if (!Native) {
      throw new Error('原生模块不可用，请在真机上运行');
    }
    return Native.requestMediaProjection();
  }

  /** 设置采集源 */
  async setCaptureSource(source: CaptureSource): Promise<void> {
    if (!Native) {
      throw new Error('原生模块不可用，请在真机上运行');
    }
    return Native.setCaptureSource(source);
  }

  /** 获取当前采集源 */
  async getCaptureSource(): Promise<CaptureSource> {
    if (!Native) return 'mic';
    return Native.getCaptureSource() as Promise<CaptureSource>;
  }

  /** 配置采集参数（必须在 start() 之前调用） */
  async configure(config: AudioCaptureConfig): Promise<void> {
    if (!Native) {
      throw new Error('原生模块不可用，请在真机上运行');
    }
    return Native.configure(config);
  }

  /** 开始采集 */
  async start(): Promise<void> {
    if (!Native) {
      throw new Error('原生模块不可用，请在真机上运行');
    }
    return Native.start();
  }

  /** 停止采集 */
  async stop(): Promise<void> {
    if (!Native) return;
    return Native.stop();
  }

  /** 获取双路音量电平 (0.0 ~ 1.0) */
  async getAudioLevels(): Promise<AudioLevels> {
    if (!Native) return { mic: 0, system: 0 };
    try {
      return await Native.getAudioLevels();
    } catch {
      return { mic: 0, system: 0 };
    }
  }

  /** 获取最后写入的 PCM 输出文件路径 */
  async getOutputFiles(): Promise<OutputFiles> {
    if (!Native) return { mic: '', system: '' };
    try {
      return await Native.getOutputFiles();
    } catch {
      return { mic: '', system: '' };
    }
  }
}

export default new AudioCaptureModule();
