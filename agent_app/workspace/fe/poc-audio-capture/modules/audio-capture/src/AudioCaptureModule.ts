import { requireNativeModule } from 'expo-modules-core';
import type { AudioCaptureConfig } from './AudioCapture.types';

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

  /** 检查当前设备是否支持系统音频采集 */
  async isSupported(): Promise<boolean> {
    if (!this.nativeModule) return false;
    try {
      return await this.nativeModule.isSupported();
    } catch {
      return false;
    }
  }

  /** 配置采集参数（必须在 start() 之前调用） */
  async configure(config: AudioCaptureConfig): Promise<void> {
    if (!this.nativeModule) {
      throw new Error('原生模块不可用，请在真机上运行');
    }
    return this.nativeModule.configure(config);
  }

  /** 开始采集系统音频 */
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

  /** 获取当前音量等级 (0.0 ~ 1.0) */
  async getAudioLevel(): Promise<number> {
    if (!this.nativeModule) return 0;
    try {
      return await this.nativeModule.getAudioLevel();
    } catch {
      return 0;
    }
  }
}

export default new AudioCaptureModule();
