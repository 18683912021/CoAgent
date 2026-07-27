/**
 * AuthScreen — 登录 / 注册 / 找回密码
 *
 * 当前仅前端样式，预留 onLogin / onRegister 回调接入后端 API。
 */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {useTheme, space, radius, type} from '../theme';
import AgreementScreen from './AgreementScreen';

// ── Types ──
type AuthMode = 'login' | 'register' | 'forgot';
type AgreementType = 'service' | 'privacy' | null;

interface Props {
  onLogin?: () => void;
  onRegister?: () => void;
}

// ── Screen ──
export default function AuthScreen({onLogin, onRegister}: Props) {
  const dark = useColorScheme() === 'dark';
  const t = useTheme(dark);
  const [mode, setMode] = useState<AuthMode>('login');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [codeSending, setCodeSending] = useState(false);
  const [codeCountdown, setCodeCountdown] = useState(0);
  const [showAgreement, setShowAgreement] = useState<AgreementType>(null);

  const pwdRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true); // 防止卸载后 setState

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) { clearInterval(timerRef.current); }
    };
  }, []);

  const isLogin = mode === 'login';
  const isRegister = mode === 'register';
  const isForgot = mode === 'forgot';

  // 切换模式时清空敏感字段
  const switchMode = useCallback((m: AuthMode) => {
    setMode(m);
    setCode('');
    setPassword('');
    setConfirmPwd('');
  }, []);

  // ── 发送验证码 ──
  const sendCode = useCallback(() => {
    if (codeCountdown > 0) { return; }
    setCodeSending(true);
    setTimeout(() => { if (mountedRef.current) { setCodeSending(false); } }, 600);
    setCodeCountdown(60);
    if (timerRef.current) { clearInterval(timerRef.current); }
    timerRef.current = setInterval(() => {
      setCodeCountdown(prev => {
        if (prev <= 1) { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } return 0; }
        return prev - 1;
      });
    }, 1000);
  }, [codeCountdown]);

  // ── 提交 ──
  const submit = useCallback(() => {
    Keyboard.dismiss();
    if (mode === 'login') { onLogin?.(); }
    else if (mode === 'register') { onRegister?.(); }
  }, [mode, onLogin, onRegister]);

  // ── 一键登录 ──
  const oneClickLogin = useCallback(() => {
    onLogin?.();
  }, [onLogin]);

  return (
    <SafeAreaView style={[styles.root, {backgroundColor: t.bg}]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>

          {/* ── Brand ── */}
          <View style={styles.brand}>
            <View style={[styles.logo, {backgroundColor: t.accentLight}]}>
              <Text style={styles.logoText}>🎯</Text>
            </View>
            <Text style={[styles.appName, {color: t.textPrimary}]}>AI面试助手</Text>
            <Text style={[styles.brandSub, {color: t.textTertiary}]}>
              实时转写 · AI 辅助 · 面试无忧
            </Text>
          </View>

          {/* ── Mode Tabs ── */}
          <View style={[styles.tabRow, {backgroundColor: t.divider}]}>
            {(['login', 'register'] as AuthMode[]).map(m => (
              <Pressable
                key={m}
                style={[
                  styles.tab,
                  mode === m && {backgroundColor: t.bgSurface, ...t.shadowSm},
                ]}
                onPress={() => switchMode(m)}>
                <Text style={[styles.tabText, {color: mode === m ? t.accent : t.textTertiary}]}>
                  {m === 'login' ? '登录' : '注册'}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* ── Form ── */}
          <View style={[styles.form, {backgroundColor: t.bgSurface}, t.shadowMd]}>
            {/* 手机号 */}
            <View style={[styles.inputRow, {borderColor: t.divider}]}>
              <Text style={[styles.countryCode, {color: t.textPrimary}]}>+86</Text>
              <View style={[styles.inputDivider, {backgroundColor: t.divider}]} />
              <TextInput
                style={[styles.input, {color: t.textPrimary}]}
                placeholder="请输入手机号"
                placeholderTextColor={t.textTertiary}
                keyboardType="phone-pad"
                maxLength={11}
                value={phone}
                onChangeText={setPhone}
                returnKeyType={isForgot ? 'done' : 'next'}
                onSubmitEditing={() => pwdRef.current?.focus()}
              />
            </View>

            {/* 验证码 */}
            {!isForgot && (
              <View style={[styles.inputRow, {borderColor: t.divider}]}>
                <TextInput
                  style={[styles.input, {color: t.textPrimary}]}
                  placeholder="验证码"
                  placeholderTextColor={t.textTertiary}
                  keyboardType="number-pad"
                  maxLength={6}
                  value={code}
                  onChangeText={setCode}
                />
                <TouchableOpacity
                  style={[styles.codeBtn, {backgroundColor: codeCountdown > 0 ? t.divider : t.accent}]}
                  onPress={sendCode}
                  activeOpacity={0.7}
                  disabled={codeCountdown > 0 || !phone}>
                  <Text style={[styles.codeBtnText, {color: codeCountdown > 0 ? t.textTertiary : '#FFF'}]}>
                    {codeSending ? '发送中…' : codeCountdown > 0 ? `${codeCountdown}s` : '获取验证码'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* 密码（注册 / 找回密码） */}
            {(isRegister || isForgot) && (
              <View style={[styles.inputRow, {borderColor: t.divider}]}>
                <TextInput
                  ref={pwdRef}
                  style={[styles.input, {color: t.textPrimary}]}
                  placeholder={isForgot ? '设置新密码' : '设置密码（6-20位）'}
                  placeholderTextColor={t.textTertiary}
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  returnKeyType={isRegister ? 'next' : 'done'}
                  onSubmitEditing={() => isRegister ? confirmRef.current?.focus() : undefined}
                />
              </View>
            )}

            {/* 确认密码（仅注册） */}
            {isRegister && (
              <View style={[styles.inputRow, {borderColor: t.divider}]}>
                <TextInput
                  ref={confirmRef}
                  style={[styles.input, {color: t.textPrimary}]}
                  placeholder="确认密码"
                  placeholderTextColor={t.textTertiary}
                  secureTextEntry
                  value={confirmPwd}
                  onChangeText={setConfirmPwd}
                  returnKeyType="done"
                />
              </View>
            )}

            {/* 服务协议 */}
            <Pressable style={styles.agreeRow} onPress={() => setAgreed(!agreed)}>
              <View style={[styles.checkbox, {borderColor: agreed ? t.accent : t.dividerStrong, backgroundColor: agreed ? t.accent : 'transparent'}]}>
                {agreed && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={[styles.agreeText, {color: t.textSecondary}]}>
                已阅读并同意
              </Text>
              <Text
                style={[styles.agreeLink, {color: t.accent}]}
                onPress={() => setShowAgreement('service')}>
                《服务协议》
              </Text>
              <Text style={[styles.agreeText, {color: t.textSecondary}]}>和</Text>
              <Text
                style={[styles.agreeLink, {color: t.accent}]}
                onPress={() => setShowAgreement('privacy')}>
                《隐私政策》
              </Text>
            </Pressable>

            {/* 提交按钮 */}
            <TouchableOpacity
              style={[styles.submitBtn, {backgroundColor: t.accent}]}
              onPress={submit}
              activeOpacity={0.8}>
              <Text style={styles.submitText}>
                {isLogin ? '登录' : isRegister ? '注册' : '重置密码'}
              </Text>
            </TouchableOpacity>

            {/* 一键登录（仅登录模式） */}
            {isLogin && (
              <TouchableOpacity
                style={[styles.oneClickBtn, {borderColor: t.divider}]}
                onPress={oneClickLogin}
                activeOpacity={0.7}>
                <Text style={[styles.oneClickText, {color: t.accent}]}>
                  📱 手机号一键登录
                </Text>
              </TouchableOpacity>
            )}

            {/* 找回密码（仅登录模式） */}
            {isLogin && (
              <TouchableOpacity
                style={styles.forgotBtn}
                onPress={() => setMode('forgot')}
                activeOpacity={0.6}>
                <Text style={[styles.forgotText, {color: t.textTertiary}]}>忘记密码？</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* ── 底部切换 ── */}
          {!isForgot && (
            <View style={styles.footer}>
              <Text style={[styles.footerText, {color: t.textSecondary}]}>
                {isLogin ? '还没有账号？' : '已有账号？'}
              </Text>
              <TouchableOpacity onPress={() => switchMode(isLogin ? 'register' : 'login')} activeOpacity={0.6}>
                <Text style={[styles.footerLink, {color: t.accent}]}>
                  {isLogin ? '去注册' : '去登录'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── 忘记密码模式：返回登录 ── */}
          {isForgot && (
            <View style={styles.footer}>
              <TouchableOpacity onPress={() => setMode('login')} activeOpacity={0.6}>
                <Text style={[styles.footerLink, {color: t.accent}]}>← 返回登录</Text>
              </TouchableOpacity>
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── 协议弹窗 ── */}
      <Modal visible={showAgreement != null} animationType="slide" presentationStyle="pageSheet">
        {showAgreement != null && (
          <AgreementScreen type={showAgreement} onClose={() => setShowAgreement(null)} />
        )}
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ──
const styles = StyleSheet.create({
  root: {flex: 1},
  flex: {flex: 1},
  scroll: {paddingBottom: 40, alignItems: 'center', paddingHorizontal: space.lg},

  // Brand
  brand: {
    alignItems: 'center',
    marginTop: space['3xl'],
    marginBottom: space['2xl'],
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: space.lg,
  },
  logoText: {fontSize: 34},
  appName: {
    ...type.title,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  brandSub: {
    ...type.bodySm,
  },

  // Mode tabs
  tabRow: {
    flexDirection: 'row',
    borderRadius: radius.md,
    padding: 3,
    width: 220,
    marginBottom: space.xl,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.sm + 2,
    alignItems: 'center',
  },
  tabText: {
    fontSize: 15,
    fontWeight: '700',
  },

  // Form card
  form: {
    width: '100%',
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space['2xl'],
    borderRadius: radius.xl,
    gap: space.md,
  },

  // Inputs
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    height: 50,
  },
  countryCode: {
    ...type.body,
    fontWeight: '700',
    paddingHorizontal: space.md,
  },
  inputDivider: {
    width: 1,
    height: 24,
  },
  input: {
    flex: 1,
    ...type.body,
    paddingHorizontal: space.md,
    height: '100%',
    ...(Platform.OS === 'android' ? {textAlignVertical: 'center'} : {}),
  },
  codeBtn: {
    paddingHorizontal: 14,
    height: 36,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 7,
  },
  codeBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },

  // Agreement
  agreeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingVertical: 4,
    gap: 3,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  checkmark: {
    fontSize: 11,
    color: '#FFF',
    fontWeight: '800',
    lineHeight: 14,
  },
  agreeText: {
    ...type.caption,
    lineHeight: 18,
  },
  agreeLink: {
    ...type.caption,
    fontWeight: '700',
    lineHeight: 18,
  },

  // Submit
  submitBtn: {
    height: 50,
    borderRadius: radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: space.xs,
  },
  submitText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },

  // One-click
  oneClickBtn: {
    height: 46,
    borderRadius: radius.lg,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  oneClickText: {
    fontSize: 15,
    fontWeight: '600',
  },

  // Forgot password
  forgotBtn: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  forgotText: {
    ...type.bodySm,
  },

  // Footer
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: space.xl,
    gap: 4,
  },
  footerText: {
    ...type.bodySm,
  },
  footerLink: {
    ...type.bodySm,
    fontWeight: '700',
  },
});
