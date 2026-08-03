/**
 * ProfileScreen —— PC 桌面端个人中心
 *
 * 左菜单 + 右内容面板。包含：个人信息、时长、续费、自我介绍、简历上传、语言选择器。
 */
import { useContext, useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../utils/AuthContext';
import { getProfile, saveProfile } from '../utils/token';
import { hasResume, uploadResume, getIntro } from '../api/resume';
import { updateProfile as updateProfileApi } from '../api/auth';
import type { UserProfile } from '../api/auth';
import { setProgLang, type ProgLang } from '../config';
import SubscriptionScreen from './SubscriptionScreen';

const PROGRAMMING_LANGUAGES: ProgLang[] = ['JavaScript', 'Java', 'Python', 'C#', 'C++', 'Go'];
const LANG_MAP: Record<string, ProgLang> = {
  javascript: 'JavaScript', java: 'Java', python: 'Python',
  'c#': 'C#', csharp: 'C#', 'c++': 'C++', cpp: 'C++', go: 'Go', golang: 'Go',
};

function fmtTime(s: number) {
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function fmtDate(ts: number) {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ProfileScreen() {
  const { logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [resumeLabel, setResumeLabel] = useState('未上传');
  const [uploading, setUploading] = useState(false);
  const [lang, setLang] = useState<ProgLang>('JavaScript');
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showSubscription, setShowSubscription] = useState(false);
  const [intro, setIntro] = useState('');
  const [introLoading, setIntroLoading] = useState(false);

  useEffect(() => {
    getProfile().then(p => {
      if (p) { setProfile(p); const l = LANG_MAP[p.programming_language] || 'JavaScript'; setLang(l); setProgLang(l); }
    });
    hasResume().then(d => { if (d.has_intro) setResumeLabel('已上传'); }).catch(() => {});
  }, []);

  const handleLangChange = useCallback(async (l: ProgLang) => {
    setLang(l); setProgLang(l); setShowLangPicker(false);
    try { const d = await updateProfileApi({ programming_language: l.toLowerCase() }); if (d.user) { setProfile(d.user); await saveProfile(d.user); } } catch { /* ignore */ }
  }, []);

  const handleUpload = useCallback(async () => {
    const api = (window as any).electronAPI;
    if (!api?.fileConvert) return;
    try {
      const fp = await api.fileConvert.pickFile(['pdf']);
      if (!fp) return;
      setUploading(true); setResumeLabel('上传中…');
      const r = await fetch(`file://${fp}`);
      const blob = await r.blob();
      const fd = new FormData();
      fd.append('file', blob, fp.split(/[/\\]/).pop() || 'resume.pdf');
      await uploadResume(fd);
      setResumeLabel('已上传');
    } catch { setResumeLabel('失败'); }
    finally { setUploading(false); }
  }, []);

  const handleViewIntro = useCallback(async () => {
    setIntroLoading(true);
    try {
      const data = await getIntro();
      setIntro(data.ok && data.intro ? data.intro : '');
    } catch { setIntro(''); }
    finally { setIntroLoading(false); }
  }, []);

  const menuItems = [
    { icon: '📋', label: '面试历史', desc: `${profile?.interview_count ?? 0} 次`, action: () => navigate('/history') },
    { icon: '🌐', label: '面试赛道', desc: lang, action: () => setShowLangPicker(true) },
    { icon: '✍️', label: '答案风格', desc: profile?.answer_style ?? '标准书面', action: () => {} },
    { icon: '📄', label: '简历上传', desc: uploading ? '上传中…' : resumeLabel, action: handleUpload },
    { icon: '📝', label: '自我介绍', desc: resumeLabel === '已上传' ? '查看' : '需先上传简历', action: () => resumeLabel === '已上传' && handleViewIntro() },
  ];

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* ══════ 左 · 菜单 240px ══════ */}
      <nav className="w-60 shrink-0 bg-bg-surface border-r border-divider flex flex-col py-lg">
        <div className="px-lg mb-lg">
          <div className="flex items-center gap-md">
            <div className="w-11 h-11 rounded-xl bg-accent-light border-2 border-accent flex items-center justify-center text-xl shrink-0">
              {profile?.avatar || '👨‍💻'}
            </div>
            <div className="min-w-0">
              <div className="text-body-sm font-bold truncate">{profile?.name || '未登录'}</div>
              <span className="text-caption px-1.5 py-0.5 rounded-full bg-accent text-white font-bold">
                {profile?.membership || '会员'}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-0.5 px-md">
          {menuItems.map(item => (
            <button key={item.label} onClick={item.action}
              className="w-full flex items-center gap-md px-md py-2.5 rounded-lg hover:bg-bg text-left transition-colors group">
              <span className="w-8 h-8 rounded-lg bg-bg group-hover:bg-bg-surface flex items-center justify-center text-base shrink-0">{item.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="text-body-sm font-medium text-text-primary">{item.label}</div>
                <div className="text-caption text-text-tertiary truncate">{item.desc}</div>
              </div>
              <span className="text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity">›</span>
            </button>
          ))}
        </div>

        <div className="mt-auto px-md">
          <button onClick={() => setShowLogoutConfirm(true)}
            className="w-full flex items-center gap-md px-md py-2.5 rounded-lg hover:bg-danger-light text-left transition-colors group">
            <span className="w-8 h-8 rounded-lg bg-danger-light flex items-center justify-center text-base shrink-0">🚪</span>
            <span className="text-body-sm font-medium text-danger">退出登录</span>
          </button>
        </div>
      </nav>

      {/* ══════ 右 · 内容区 ══════ */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto p-2xl space-y-2xl">
          {/* 时长卡片 */}
          <div className="bg-bg-surface rounded-2xl p-xl shadow-sm border border-divider">
            <div className="text-caption text-text-tertiary font-semibold mb-sm">剩余时长</div>
            <div className="text-4xl font-extrabold tabular-nums text-accent tracking-wider">
              {profile ? fmtTime(profile.remaining_seconds) : '--:--:--'}
            </div>
            <div className="flex items-center justify-between mt-lg pt-lg border-t border-divider">
              <span className="text-body-sm text-text-secondary">有效期至 {profile ? fmtDate(profile.expires_at) : '----'}</span>
              <button onClick={() => setShowSubscription(true)}
                className="px-lg py-sm rounded-lg bg-accent text-white text-body-sm font-bold hover:opacity-90 shadow-sm">续费 ›</button>
            </div>
          </div>

          {/* 统计 */}
          <div className="grid grid-cols-3 gap-lg">
            <StatCard icon="🎯" value={`${profile?.interview_count ?? 0}`} label="面试次数" />
            <StatCard icon="📄" value={resumeLabel === '已上传' ? '✓' : '—'} label="简历" />
            <StatCard icon="🌐" value={lang} label="赛道" />
          </div>

          {/* 自我介绍预览 */}
          {intro && (
            <div className="bg-bg-surface rounded-2xl p-xl shadow-sm border border-divider">
              <h3 className="text-body font-bold text-text-primary mb-lg">📝 自我介绍</h3>
              <p className="text-body-sm text-text-primary leading-relaxed whitespace-pre-wrap">{intro}</p>
            </div>
          )}
        </div>
      </main>

      {/* 续费弹窗 */}
      {showSubscription && <SubscriptionScreen onClose={() => setShowSubscription(false)} />}

      {/* 自我介绍弹窗 */}
      {introLoading || (intro && (
        <div className="fixed inset-0 bg-backdrop flex items-center justify-center z-50" onClick={() => setIntro('')}>
          <div className="bg-bg-surface rounded-2xl p-xl max-w-lg w-full mx-lg shadow-xl max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-lg">
              <h3 className="text-heading font-bold">📝 自我介绍</h3>
              <button onClick={() => setIntro('')} className="text-text-tertiary hover:text-text-primary text-lg">✕</button>
            </div>
            {introLoading ? (
              <p className="text-body-sm text-text-secondary">加载中…</p>
            ) : intro ? (
              <p className="text-body text-text-primary leading-relaxed whitespace-pre-wrap">{intro}</p>
            ) : (
              <div className="text-center py-xl">
                <span className="text-4xl block mb-lg">📄</span>
                <p className="text-body-sm text-text-secondary">尚未上传简历</p>
                <p className="text-caption text-text-tertiary mt-sm">请在「简历上传」中上传 PDF 简历生成自我介绍</p>
              </div>
            )}
          </div>
        </div>
      ))}

      {/* 语言选择器弹窗 */}
      {showLangPicker && (
        <div className="fixed inset-0 bg-backdrop flex items-center justify-center z-50" onClick={() => setShowLangPicker(false)}>
          <div className="bg-bg-surface rounded-2xl p-xl w-80 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-heading text-center mb-lg">选择面试赛道</h3>
            <div className="space-y-sm">
              {PROGRAMMING_LANGUAGES.map(l => (
                <button key={l} onClick={() => handleLangChange(l)}
                  className={`w-full flex items-center justify-between p-md rounded-xl border-2 transition-colors ${
                    l === lang ? 'border-accent bg-accent-light text-accent font-bold' : 'border-transparent hover:bg-bg'
                  }`}>
                  <span>{l}</span>
                  {l === lang && <span className="w-2.5 h-2.5 rounded-full bg-accent" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 退出确认 */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-backdrop flex items-center justify-center z-50" onClick={() => setShowLogoutConfirm(false)}>
          <div className="bg-bg-surface rounded-2xl p-xl w-80 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-heading mb-md">退出登录</h3>
            <p className="text-body text-text-secondary mb-lg">确定要退出当前账号吗？</p>
            <div className="flex gap-md justify-end">
              <button onClick={() => setShowLogoutConfirm(false)} className="px-xl py-sm rounded-lg border border-divider text-body-sm hover:bg-bg">取消</button>
              <button onClick={logout} className="px-xl py-sm rounded-lg bg-danger text-white text-body-sm font-bold hover:bg-red-600">退出</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="bg-bg-surface rounded-xl p-lg border border-divider text-center shadow-sm">
      <div className="text-2xl mb-sm">{icon}</div>
      <div className="text-heading font-extrabold text-text-primary">{value}</div>
      <div className="text-caption text-text-tertiary mt-xs">{label}</div>
    </div>
  );
}
