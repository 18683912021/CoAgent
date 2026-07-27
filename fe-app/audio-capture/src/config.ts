import {Platform} from 'react-native';

/**
 * WebSocket 地址配置
 *
 * 默认值按运行环境自动选择：
 * - Android 模拟器 → 10.0.2.2（映射到宿主机 localhost）
 * - iOS 模拟器 / 真机 → localhost（需要物理设备连同一个局域网时改为实际 IP）
 *
 * 可通过环境变量或直接修改 STREAM_URL_OVERRIDE 覆盖。
 */
const DEFAULT_HOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
const DEFAULT_PORT = 8010;
const DEFAULT_PATH = '/api/ws/audio/stream';

/** 联调时直接改这里的值即可覆盖默认地址 */
const STREAM_URL_OVERRIDE: string | null = 'ws://192.168.7.149:8010/api/ws/audio/stream';

export const STREAM_URL: string =
  STREAM_URL_OVERRIDE ??
  `ws://${DEFAULT_HOST}:${DEFAULT_PORT}${DEFAULT_PATH}`;

/** REST API 基础地址，简历上传等 HTTP 接口使用。联调时直接改此值。 */
const API_HOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
const API_PORT = 8010;
const API_OVERRIDE: string | null = 'http://192.168.7.149:8010';

export const API_BASE: string = API_OVERRIDE ?? `http://${API_HOST}:${API_PORT}`;

// ── 共享设置（跨 Tab 读写） ──
export type AppLanguage = 'zh' | 'en';

let _language: AppLanguage = 'zh';
const _listeners: Array<(lang: AppLanguage) => void> = [];

export function getLanguage(): AppLanguage {
  return _language;
}

export function setLanguage(lang: AppLanguage): void {
  if (_language === lang) { return; }
  _language = lang;
  _listeners.forEach(fn => fn(lang));
}

export function onLanguageChange(fn: (lang: AppLanguage) => void): () => void {
  _listeners.push(fn);
  return () => {
    const idx = _listeners.indexOf(fn);
    if (idx !== -1) { _listeners.splice(idx, 1); }
  };
}
