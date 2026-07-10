import { NativeModules, Platform, PermissionsAndroid } from 'react-native';

// ── 类型定义 ──────────────────────────────────
export type AudioCaptureStatus = 'idle' | 'ready' | 'starting' | 'capturing' | 'denied';

export interface AudioCaptureConfig {
  sampleRate: number;       // 采样率，推荐 16000
  channelConfig: number;    // 1 = mono, 2 = stereo
  audioFormat: number;      // 2 = PCM_16BIT
  bufferSize: number;       // 每帧字节数，如 1280（40ms @ 16kHz mono 16bit）
}

interface AudioCaptureNative {
  requestRecordPermission(): Promise<boolean>;
  requestSystemAudioPermission(): Promise<boolean>;
  start(config: AudioCaptureConfig): Promise<void>;
  stop(): void;
}

// ── NativeModule 引用 ─────────────────────────
const Native: AudioCaptureNative | null =
  Platform.OS === 'android'
    ? (NativeModules.AudioCaptureModule as AudioCaptureNative | null)
    : null;

function requireNative(): AudioCaptureNative {
  if (!Native) {
    throw new Error('AudioCaptureModule 仅在 Android 平台可用');
  }
  return Native;
}

// ── 公开 API（所有方法都带 try/catch，绝不抛未捕获异常）─

async function requestRecordPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    // iOS 用系统权限弹窗，这里简单返回 true（实际需要 Info.plist 配置）
    return true;
  }
  try {
    const apiLevel = Platform.Version as number;
    if (apiLevel >= 33) {
      const result = await PermissionsAndroid.request(
        'android.permission.RECORD_AUDIO' as any,
      );
      return result === 'granted';
    }
    // Android < 13：可能在模块内部处理
    return requireNative().requestRecordPermission();
  } catch (e) {
    console.error('[AudioCapture] requestRecordPermission 异常:', e);
    throw e;
  }
}

async function requestSystemAudioPermission(): Promise<boolean> {
  try {
    return requireNative().requestSystemAudioPermission();
  } catch (e) {
    console.error('[AudioCapture] requestSystemAudioPermission 异常:', e);
    throw e;
  }
}

async function start(config: AudioCaptureConfig): Promise<void> {
  try {
    return requireNative().start(config);
  } catch (e: any) {
    // 增强错误信息，帮助排查
    const baseMsg = e?.message ?? String(e);
    if (baseMsg.includes('SecurityException') || baseMsg.includes('permission')) {
      throw new Error(`权限不足: ${baseMsg}`);
    }
    if (baseMsg.includes('UnsupportedOperation') || baseMsg.includes('not supported')) {
      throw new Error(`设备不支持: ${baseMsg}`);
    }
    throw e;
  }
}

function stop(): void {
  try {
    requireNative().stop();
  } catch (e) {
    console.error('[AudioCapture] stop 异常:', e);
    // stop 失败不抛异常——已经是关闭操作，抛了也没意义
  }
}

export const AudioCapture = {
  requestRecordPermission,
  requestSystemAudioPermission,
  start,
  stop,
} as const;
