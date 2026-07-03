import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from '@core/logger';

const logger = createLogger('Storage');

// 存储键名前缀，防止与其他库冲突
const KEY_PREFIX = '@app:';

/**
 * 本地缓存抽象层
 *
 * 当前使用 AsyncStorage，后续可无缝切换为 MMKV。
 * 对外暴露统一 API，业务层不感知底层实现。
 */
class StorageService {
  private prefixKey(key: string): string {
    return `${KEY_PREFIX}${key}`;
  }

  async get<T = string>(key: string): Promise<T | null> {
    try {
      const value = await AsyncStorage.getItem(this.prefixKey(key));
      if (value === null) return null;
      return JSON.parse(value) as T;
    } catch (error) {
      logger.error(`get failed for key: ${key}`, error);
      return null;
    }
  }

  async set<T = string>(key: string, value: T): Promise<boolean> {
    try {
      await AsyncStorage.setItem(this.prefixKey(key), JSON.stringify(value));
      return true;
    } catch (error) {
      logger.error(`set failed for key: ${key}`, error);
      return false;
    }
  }

  async remove(key: string): Promise<boolean> {
    try {
      await AsyncStorage.removeItem(this.prefixKey(key));
      return true;
    } catch (error) {
      logger.error(`remove failed for key: ${key}`, error);
      return false;
    }
  }

  async clear(): Promise<boolean> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const appKeys = keys.filter((k) => k.startsWith(KEY_PREFIX));
      if (appKeys.length > 0) {
        await AsyncStorage.multiRemove(appKeys);
      }
      return true;
    } catch (error) {
      logger.error('clear failed', error);
      return false;
    }
  }
}

export const storage = new StorageService();
