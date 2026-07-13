import { requireNativeModule } from 'expo-modules-core';
import type { AudioCaptureConfig, AudioLevels, CaptureSource, OutputFiles } from './AudioCapture.types';

const MODULE_NAME = 'AudioCapture';

/**
 * Expo Native Module 桥接层
 *
 * 通过 requireNativeModule (Expo Modules API) 调用 Kotlin/Swift 层。
 * 如果原生模块不存在，所有方法返回 fallback。
 */
class AudioCaptureModule {
  private get nativeModule() {
    try {
      return requireNativeModule(MODULE_NAME);
    } catch {
      console.warn(`[AudioCapture] 原生模块 "${MODULE_NAME}" 未注册——当前运行在无原生支持的平台`);
      return null;
    }
  }

  /** 检查当前设备是否支持系统音频采集 (Android 10+) */
  async isSupported(): Promise<boolean> {
    if (!this.nativeModule) return false;
    try {
      return await this.nativeModule.isSupported();
    } catch {
      return false;
    }
  }

  /** 是否已获得 MediaProjection 授权 */
  async hasMediaProjection(): Promise<boolean> {
    if (!this.nativeModule) return false;
    try {
      return await this.nativeModule.hasMediaProjection();
    } catch {
      return false;
    }
  }

  /**
   * 请求系统音频采集授权（弹出系统级对话框）
   * @returns true=用户同意授权, false=用户拒绝
   */
  async requestMediaProjection(): Promise<boolean> {
    if (!this.nativeModule) {
      throw new Error('原生模块不可用，请在真机上运行');
    }
    return this.nativeModule.requestMediaProjection();
  }

  /** 设置采集源 */
  async setCaptureSource(source: CaptureSource): Promise<void> {
    if (!this.nativeModule) {
      throw new Error('原生模块不可用，请在真机上运行');
    }
    return this.nativeModule.setCaptureSource(source);
  }

  /** 获取当前采集源 */
  async getCaptureSource(): Promise<CaptureSource> {
    if (!this.nativeModule) return 'mic';
    return this.nativeModule.getCaptureSource();
  }

  /** 配置采集参数（必须在 start() 之前调用） */
  async configure(config: AudioCaptureConfig): Promise<void> {
    if (!this.nativeModule) {
      throw new Error('原生模块不可用，请在真机上运行');
    }
    return this.nativeModule.configure(config);
  }

  /** 开始采集 */
  async start(): Promise<void> {
    if (!this.nativeModule) {
      throw new Error('原生模块不可用，请在真机上运行');
    }
    return this.nativeModule.start();
  }

  /** 停止采集 */
  async stop(): Promise<void> {
    if (!this.nativeModule) return;
    return this.nativeModule.stop();
  }

  /** 获取双路音量电平 (0.0 ~ 1.0) */
  async getAudioLevels(): Promise<AudioLevels> {
    if (!this.nativeModule) return { mic: 0, system: 0 };
    try {
      return await this.nativeModule.getAudioLevels();
    } catch {
      return { mic: 0, system: 0 };
    }
  }

  /** 获取最后写入的 PCM 输出文件路径 */
  async getOutputFiles(): Promise<OutputFiles> {
    if (!this.nativeModule) return { mic: '', system: '' };
    try {
      return await this.nativeModule.getOutputFiles();
    } catch {
      return { mic: '', system: '' };
    }
  }
}

export default new AudioCaptureModule();
