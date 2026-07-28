/**
 * 认证 API —— 邮箱验证码登录 / 注册 / Token 校验
 */

import {api} from './client';

export interface SendCodeResult {
  ok: boolean;
  message: string;
  cooldown: number;
}

export interface CheckEmailResult {
  ok: boolean;
  exists: boolean;
}

export interface LoginResult {
  ok: boolean;
  token: string;
  email: string;
  is_new: boolean;
  expires_in: number;
  expires_at: number;
}

export interface VerifyResult {
  ok: boolean;
  email: string;
}

/** 发送邮箱验证码 */
export function sendCode(email: string): Promise<SendCodeResult> {
  return api.post<SendCodeResult>('/api/auth/send-code', {email});
}

/** 检查邮箱是否已注册 */
export function checkEmail(email: string): Promise<CheckEmailResult> {
  return api.post<CheckEmailResult>('/api/auth/check-email', {email});
}

/** 验证码登录 */
export function login(email: string, code: string): Promise<LoginResult> {
  return api.post<LoginResult>('/api/auth/login', {email, code});
}

/** 验证码注册（带密码） */
export function register(email: string, code: string, password: string): Promise<LoginResult> {
  return api.post<LoginResult>('/api/auth/register', {email, code, password});
}

/** 校验 Token 有效性 */
export function verify(token: string): Promise<VerifyResult> {
  return api.post<VerifyResult>('/api/auth/verify', {token});
}
