/**
 * AuthScreen —— PC 端登录 / 注册
 *
 * 桌面端布局：左品牌区 + 右表单区，而不是移动端的全屏堆叠。
 * 完整业务流程和移动端对齐：邮箱验证码登录、密码登录、注册、行内校验、协议。
 */
import { useState, useCallback } from 'react';
import { sendCode, checkEmail, login, loginPassword, register } from '../api/auth';
import { saveToken, refreshProfile } from '../utils/token';

type AuthMode = 'login' | 'register';
type LoginSubMode = 'code' | 'password';

interface Props { onLogin: () => void; }

export default function AuthScreen({ onLogin }: Props) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [subMode, setSubMode] = useState<LoginSubMode>('code');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [emailErr, setEmailErr] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [pwdErr, setPwdErr] = useState('');
  const [pwdTouched, setPwdTouched] = useState(false);
  const [agreedTouched, setAgreedTouched] = useState(false);

  const isLogin = mode === 'login';
  const usePwd = isLogin && subMode === 'password';
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emailOk = EMAIL_RE.test(email.trim());
  const canSend = emailOk && countdown === 0;

  const handleSendCode = useCallback(async () => {
    if (!email.trim()) { setEmailTouched(true); setEmailErr('请输入邮箱'); return; }
    if (!emailOk) { setEmailTouched(true); setEmailErr('邮箱格式不正确'); return; }
    if (countdown > 0) return;
    try {
      const { exists } = await checkEmail(email.trim());
      if (isLogin && !exists) { setEmailErr('该邮箱未注册'); return; }
      if (!isLogin && exists) { setEmailErr('该邮箱已注册'); return; }
      setEmailErr('');
    } catch (e: any) { setEmailErr(e.detail || '发送失败'); return; }
    try {
      await sendCode(email.trim());
      setCountdown(60);
      const id = setInterval(() => setCountdown(c => { if (c <= 1) { clearInterval(id); return 0; } return c - 1; }), 1000);
    } catch (e: any) { setEmailErr(e.detail || '发送失败'); }
  }, [email, emailOk, countdown, isLogin]);

  const submit = useCallback(async () => {
    if (!agreed) { setAgreedTouched(true); return; }
    if (!email.trim() || !emailOk) { setEmailTouched(true); setEmailErr(!email.trim() ? '请输入邮箱' : '邮箱格式不正确'); return; }
    if (usePwd) { if (!password.trim()) { setPwdTouched(true); setPwdErr('请输入密码'); return; } }
    else if (isLogin) { if (!code.trim()) return; }
    else {
      if (!code.trim()) return;
      if (!password.trim()) { setPwdTouched(true); setPwdErr('请设置密码'); return; }
      if (password.length < 6) { setPwdTouched(true); setPwdErr('密码至少 6 位'); return; }
      if (password !== confirmPwd) { setPwdTouched(true); setPwdErr('两次密码不一致'); return; }
    }
    setLoading(true);
    try {
      let data;
      if (usePwd) data = await loginPassword(email.trim(), password);
      else if (isLogin) data = await login(email.trim(), code.trim());
      else data = await register(email.trim(), code.trim(), password);
      if (data.token) { await saveToken(data.token); await refreshProfile(); }
      onLogin();
    } catch (_) { /* 静默 */ }
    finally { setLoading(false); }
  }, [isLogin, usePwd, email, code, password, confirmPwd, agreed, emailOk, onLogin]);

  const switchMode = () => { setMode(m => m === 'login' ? 'register' : 'login'); setCode(''); setPassword(''); setConfirmPwd(''); setEmailErr(''); setPwdErr(''); setEmailTouched(false); setPwdTouched(false); setAgreedTouched(false); setSubMode('code'); };

  return (
    <div className="h-full flex bg-bg">
      {/* ── 左品牌区 ── */}
      <div className="hidden lg:flex w-[45%] bg-bg-surface items-center justify-center border-r border-divider relative overflow-hidden">
        <div className="absolute top-[-20%] right-[-20%] w-80 h-80 rounded-full bg-accent opacity-[0.04]" />
        <div className="absolute bottom-[-15%] left-[-15%] w-60 h-60 rounded-full bg-accent opacity-[0.03]" />
        <div className="relative text-center space-y-xl">
          <div className="w-24 h-24 mx-auto rounded-3xl bg-accent-light border border-accent-soft flex items-center justify-center">
            <span className="text-5xl">🎯</span>
          </div>
          <div>
            <h1 className="text-3xl font-extrabold tracking-wide text-text-primary mb-sm">AI 面试助手</h1>
            <p className="text-body text-text-tertiary leading-relaxed max-w-xs mx-auto">
              实时转写面试对话，AI 即时生成高质量回答，助你轻松应对技术面试。
            </p>
          </div>
          <div className="flex justify-center gap-xl text-caption text-text-tertiary">
            <span>🎙️ 语音转写</span>
            <span>🤖 AI 回答</span>
            <span>📋 历史回顾</span>
          </div>
        </div>
      </div>

      {/* ── 右表单区 ── */}
      <div className="flex-1 flex items-center justify-center p-xl">
        <div className="w-full max-w-sm space-y-xl">
          {/* 移动端品牌（lg 以下可见） */}
          <div className="lg:hidden text-center mb-lg">
            <span className="text-4xl">🎯</span>
            <h1 className="text-xl font-extrabold text-text-primary mt-sm">AI 面试助手</h1>
          </div>

          <div className="bg-bg-surface rounded-2xl border border-divider p-2xl shadow-sm space-y-lg">
            {/* 邮箱 */}
            <div className="space-y-sm">
              <label className="text-caption font-semibold text-text-secondary ml-1">邮箱地址</label>
              <div>
                <input
                  type="email" value={email} autoCapitalize="off"
                  onChange={e => { setEmail(e.target.value); if (emailErr) setEmailErr(''); }}
                  onBlur={() => { setEmailTouched(true); if (!email.trim()) setEmailErr('请输入邮箱'); else if (!emailOk) setEmailErr('邮箱格式不正确'); }}
                  placeholder="name@example.com"
                  className={`w-full h-11 px-lg rounded-lg border bg-bg text-body placeholder:text-text-tertiary outline-none transition-all focus:ring-2 focus:ring-accent/20 ${emailTouched && emailErr ? 'border-danger ring-2 ring-danger/15' : 'border-divider focus:border-accent'}`}
                />
              </div>
              {emailTouched && emailErr && <p className="text-caption text-danger ml-1">{emailErr}</p>}
            </div>

            {/* 验证码（非密码模式） */}
            {!usePwd && (
              <div className="space-y-sm">
                <label className="text-caption font-semibold text-text-secondary ml-1">验证码</label>
                <div className="flex gap-sm">
                  <input
                    type="text" value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6 位数字" maxLength={6}
                    className="flex-1 h-11 px-lg rounded-lg border border-divider bg-bg text-body placeholder:text-text-tertiary outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                  <button onClick={handleSendCode} disabled={!canSend}
                    className="h-11 px-lg rounded-lg text-body-sm font-bold shrink-0 bg-accent-light text-accent hover:bg-accent-soft disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    {countdown > 0 ? `${countdown}s` : '发送'}
                  </button>
                </div>
              </div>
            )}

            {/* 密码 */}
            {(usePwd || !isLogin) && (
              <>
                <div className="space-y-sm">
                  <label className="text-caption font-semibold text-text-secondary ml-1">{usePwd ? '密码' : '设置密码'}</label>
                  <input
                    type="password" value={password}
                    onChange={e => { setPassword(e.target.value); if (pwdErr) setPwdErr(''); }}
                    placeholder={usePwd ? '输入密码' : '至少 6 位'}
                    className={`w-full h-11 px-lg rounded-lg border bg-bg text-body placeholder:text-text-tertiary outline-none focus:ring-2 transition-all ${pwdTouched && pwdErr ? 'border-danger ring-danger/15' : 'border-divider focus:border-accent focus:ring-accent/20'}`}
                  />
                </div>
                {!isLogin && (
                  <div className="space-y-sm">
                    <label className="text-caption font-semibold text-text-secondary ml-1">确认密码</label>
                    <input
                      type="password" value={confirmPwd}
                      onChange={e => { setConfirmPwd(e.target.value); if (pwdErr) setPwdErr(''); }}
                      placeholder="再次输入密码"
                      className={`w-full h-11 px-lg rounded-lg border bg-bg text-body placeholder:text-text-tertiary outline-none focus:ring-2 transition-all ${pwdTouched && pwdErr ? 'border-danger ring-danger/15' : 'border-divider focus:border-accent focus:ring-accent/20'}`}
                    />
                    {pwdTouched && pwdErr && <p className="text-caption text-danger ml-1">{pwdErr}</p>}
                  </div>
                )}
              </>
            )}

            {/* 登录模式切换 */}
            {isLogin && (
              <div className="flex justify-end items-center gap-sm text-caption">
                <button onClick={() => setSubMode('code')} className={`font-semibold ${subMode === 'code' ? 'text-accent' : 'text-text-tertiary hover:text-text-secondary'}`}>验证码登录</button>
                <span className="text-divider-strong">|</span>
                <button onClick={() => setSubMode('password')} className={`font-semibold ${subMode === 'password' ? 'text-accent' : 'text-text-tertiary hover:text-text-secondary'}`}>密码登录</button>
              </div>
            )}

            {/* 协议 */}
            <div>
              <button onClick={() => { setAgreed(!agreed); setAgreedTouched(false); }}
                className="flex items-start gap-sm group w-full text-left">
                <span className={`w-4 h-4 rounded border-2 flex items-center justify-center mt-0.5 shrink-0 transition-colors ${agreedTouched && !agreed ? 'border-danger' : agreed ? 'border-accent bg-accent' : 'border-divider-strong group-hover:border-accent'}`}>
                  {agreed && <span className="text-white text-[10px] font-bold">✓</span>}
                </span>
                <span className="text-caption text-text-tertiary leading-relaxed">
                  已阅读并同意 <span className="text-accent font-semibold cursor-pointer hover:underline">《服务协议》</span> 和 <span className="text-accent font-semibold cursor-pointer hover:underline">《隐私政策》</span>
                </span>
              </button>
              {agreedTouched && !agreed && <p className="text-caption text-danger ml-6 mt-1">请先同意协议</p>}
            </div>

            {/* 提交 */}
            <button onClick={submit} disabled={!agreed || loading}
              className="w-full h-12 rounded-xl bg-accent text-white text-body font-extrabold tracking-widest shadow-sm hover:shadow-md hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
              {loading ? '处理中…' : isLogin ? '登 录' : '注 册'}
            </button>
          </div>

          {/* 模式切换 */}
          <div className="flex justify-center gap-sm text-body-sm">
            <span className="text-text-secondary">{isLogin ? '还没有账号？' : '已有账号？'}</span>
            <button onClick={switchMode} className="font-bold text-accent hover:underline">{isLogin ? '创建账号' : '去登录'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
