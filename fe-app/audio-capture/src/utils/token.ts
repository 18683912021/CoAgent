/**
 * Token 持久化工具 —— AsyncStorage + API 封装
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {verify as verifyApi} from '../api/auth';

const KEY = '@auth/token';

export async function saveToken(token: string): Promise<void> {
  try { await AsyncStorage.setItem(KEY, token); } catch {}
}

export async function getToken(): Promise<string | null> {
  try { return await AsyncStorage.getItem(KEY); } catch { return null; }
}

export async function clearToken(): Promise<void> {
  try { await AsyncStorage.removeItem(KEY); } catch {}
}

/** 验证本地 token 是否有效。有效返回 email，无效返回 null。 */
export async function verifyToken(): Promise<string | null> {
  try {
    const token = await getToken();
    if (!token) { return null; }
    const data = await verifyApi(token);
    return data.email;
  } catch {
    return null;
  }
}
