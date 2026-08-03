/**
 * InterviewScreen —— PC 桌面端面试页
 *
 * 三栏可拖拽布局：左控制面板 | 中对话区 | 右上下文面板
 */
import { useState, useEffect, useCallback } from 'react';
import { useAudioCapture } from '../hooks/useAudioCapture';
import { saveInterview } from '../api/interview';
import { hasResume, getIntro } from '../api/resume';
import { getProgLang, setProgLang, type ProgLang } from '../config';
import ConversationBubble from '../components/ConversationBubble';
import MicLevelBar from '../components/MicLevelBar';
import PulsingDot from '../components/PulsingDot';

const LANGUAGES: ProgLang[] = ['JavaScript', 'Python', 'Java', 'C++', 'C#', 'Go'];

function fmtTimer(s: number) {
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function InterviewScreen() {
  const { state, start, stop, sendLLMQuery, retryLLM } = useAudioCapture();
  const [timer, setTimer] = useState(0);
  const [style, setStyle] = useState('标准');
  const [saved, setSaved] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [intro, setIntro] = useState('');
  const [introLoading, setIntroLoading] = useState(false);
  const [hasIntro, setHasIntro] = useState(false);
  const capturing = state.captureState === 'capturing';

  useEffect(() => { hasResume().then(d => setHasIntro(d.has_intro)).catch(() => {}); }, []);

  const handleViewIntro = async () => {
    if (!hasIntro) return;
    setShowIntro(true);
    if (intro) return;
    setIntroLoading(true);
    try {
      const data = await getIntro();
      setIntro(data.ok && data.intro ? data.intro : '');
    } catch { setIntro(''); }
    finally { setIntroLoading(false); }
  };

  useEffect(() => {
    if (!capturing) { setTimer(0); setSaved(false); return; }
    const id = setInterval(() => setTimer(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [capturing]);

  const handleToggle = () => { if (capturing) { stop(); if (state.conversation.length > 0) handleSave(); } else start(); };

  const handleSave = useCallback(async () => {
    if (saved || state.conversation.length === 0) return;
    await saveInterview({
      started_at: Math.floor((Date.now() - timer * 1000) / 1000),
      ended_at: Math.floor(Date.now() / 1000),
      duration_seconds: timer,
      programming_language: getProgLang().toLowerCase(),
      conversation: state.conversation.filter(m => m.status === 'done' || m.status === 'streaming'),
    });
    setSaved(true);
  }, [saved, state.conversation, timer]);

  const intMsgs = state.conversation.filter(m => m.role === 'interviewer');

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* ══════ 左 · 控制面板 260px ══════ */}
      <aside className="w-[260px] shrink-0 bg-bg-surface border-r border-divider flex flex-col select-none">
        {/* 采集按钮 */}
        <div className="p-lg pb-md">
          <button
            onClick={handleToggle}
            className={`w-full h-12 rounded-xl font-extrabold text-body tracking-wide shadow-sm transition-all active:scale-[0.98] ${
              capturing ? 'bg-danger text-white hover:bg-red-600' : 'bg-accent text-white hover:opacity-90'
            }`}
          >
            {capturing ? '⏹ 停止采集' : '▶ 开始采集'}
          </button>
        </div>

        {/* 计时器 */}
        <div className={`text-center py-md mx-lg rounded-xl mb-md transition-colors ${capturing ? 'bg-accent-light border border-accent-soft' : 'bg-bg'}`}>
          <div className="text-caption text-text-tertiary mb-1">面试时长</div>
          <div className={`text-[28px] tabular-nums font-extrabold tracking-widest ${capturing ? 'text-accent' : 'text-text-tertiary'}`}>
            {fmtTimer(timer)}
          </div>
        </div>

        {/* 音频电平 */}
        <div className="px-lg flex flex-col gap-sm mb-lg">
          <LevelRow label="麦克风" level={state.levels.mic} />
          <LevelRow label="系统音频" level={state.levels.system} />
        </div>

        {/* 赛道 */}
        <div className="px-lg mb-md">
          <div className="text-caption text-text-tertiary font-semibold mb-sm ml-1">面试赛道</div>
          <select
            className="w-full h-10 px-md rounded-lg border border-divider bg-bg text-body-sm outline-none focus:border-accent cursor-pointer"
            defaultValue={getProgLang()}
            onChange={e => setProgLang(e.target.value as ProgLang)}
          >
            {LANGUAGES.map(l => <option key={l}>{l}</option>)}
          </select>
        </div>

        {/* 答案风格 */}
        <div className="px-lg mb-lg">
          <div className="text-caption text-text-tertiary font-semibold mb-sm ml-1">答案风格</div>
          <div className="flex bg-bg rounded-lg p-0.5">
            {['标准', '简洁', '详细'].map(s => (
              <button key={s} onClick={() => setStyle(s)}
                className={`flex-1 py-1.5 text-caption rounded-md font-medium transition-colors ${
                  style === s ? 'bg-accent text-white shadow-sm' : 'text-text-secondary hover:text-text-primary'
                }`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* 自我介绍 */}
        <div className="px-lg">
          <button
            onClick={handleViewIntro}
            disabled={!hasIntro}
            className={`w-full h-10 rounded-lg flex items-center justify-center gap-sm text-body-sm font-medium transition-colors ${
              hasIntro
                ? 'bg-accent-light text-accent hover:bg-accent-soft'
                : 'bg-bg text-text-tertiary cursor-not-allowed'
            }`}
            title={hasIntro ? '查看自我介绍' : '请先在「我的」页面上传简历'}
          >
            <span className="text-base">📝</span>
            <span>自我介绍</span>
          </button>
        </div>

        {/* 连接状态 */}
        <div className="px-lg mt-auto mb-lg">
          {capturing && state.streamState === 'ready' && <Status color="success" text="已连接 · 转录中" />}
          {state.streamState === 'reconnecting' && <Status color="warning" text="重连中…" />}
          {state.streamState === 'dead' && <Status color="danger" text="连接失败" />}
          {state.error && <div className="text-caption text-danger mt-sm truncate">{state.error.message}</div>}
        </div>
      </aside>

      {/* ══════ 中 · 对话区 ══════ */}
      <main className="flex-1 flex flex-col min-w-0 bg-bg">
        {/* 空态 */}
        {state.conversation.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-lg text-center px-lg">
            <div className="w-20 h-20 rounded-2xl bg-accent-light flex items-center justify-center">
              <span className="text-4xl">🎯</span>
            </div>
            <div>
              <div className="text-heading text-text-primary mb-sm">准备开始面试</div>
              <div className="text-body-sm text-text-secondary max-w-sm leading-relaxed">
                点击左侧「开始采集」启动，系统自动转写面试官语音。<br />
                点击转写气泡即可获取 AI 实时回答。
              </div>
            </div>
            <kbd className="px-md py-sm rounded-md bg-bg-surface border border-divider text-caption text-text-tertiary font-mono">
              Ctrl+Enter 触发回答 · Ctrl+B 切换浮窗
            </kbd>
          </div>
        )}

        {/* 对话列表 */}
        {state.conversation.length > 0 && (
          <div className="flex-1 overflow-y-auto px-lg py-lg space-y-sm">
            {state.conversation.map(msg => (
              <ConversationBubble
                key={msg.id}
                message={msg}
                onTriggerLLM={sendLLMQuery}
                onRetryLLM={retryLLM}
              />
            ))}
            <div className="h-4" />
          </div>
        )}

        {/* 快捷栏 */}
        {capturing && (
          <div className="h-10 shrink-0 bg-bg-surface border-t border-divider flex items-center px-lg gap-md text-caption text-text-tertiary">
            <span>按 <kbd className="px-1.5 py-0.5 rounded bg-bg border border-divider font-mono text-[11px]">Ctrl+Enter</kbd> 手动触发 AI 回答</span>
            <span className="ml-auto"><PulsingDot /> 采集中</span>
          </div>
        )}
      </main>

      {/* ══════ 右 · 上下文 280px ══════ */}
      <aside className="w-[280px] shrink-0 bg-bg-surface border-l border-divider flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-lg space-y-lg">
          {/* 实时转写 */}
          <section>
            <h3 className="text-caption font-bold text-text-tertiary uppercase tracking-wider mb-md">实时转写</h3>
            <div className="space-y-sm">
              {intMsgs.slice(-5).reverse().map(m => (
                <div key={m.id} className="p-sm rounded-lg bg-bg text-body-sm text-text-primary leading-relaxed border-l-2 border-accent-soft">
                  {m.text || <span className="text-text-tertiary italic">识别中…</span>}
                </div>
              ))}
              {intMsgs.length === 0 && (
                <div className="text-body-sm text-text-tertiary italic p-sm bg-bg rounded-lg">
                  等待语音输入，转写结果将实时显示在这里
                </div>
              )}
            </div>
          </section>

          {/* 对话目录 */}
          {state.conversation.length > 0 && (
            <section>
              <h3 className="text-caption font-bold text-text-tertiary uppercase tracking-wider mb-md">对话目录</h3>
              <div className="space-y-0.5">
                {state.conversation.map((m, i) => (
                  <div key={m.id}
                    className="flex items-center gap-xs px-sm py-1 rounded text-caption cursor-pointer hover:bg-bg transition-colors truncate"
                    title={m.text.slice(0, 80)}>
                    <span className="shrink-0 w-4 text-center text-[10px]">
                      {m.role === 'interviewer' ? '🎙' : m.role === 'ai' ? '🤖' : '👤'}
                    </span>
                    <span className={`truncate ${m.status === 'streaming' ? 'text-accent font-medium' : m.status === 'error' ? 'text-danger' : 'text-text-secondary'}`}>
                      {m.text.slice(0, 28) || (m.status === 'loading' ? 'AI 思考中…' : '')}{m.text.length > 28 ? '…' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </aside>

      {/* ── 自我介绍弹窗 ── */}
      {showIntro && (
        <div className="fixed inset-0 bg-backdrop flex items-center justify-center z-50" onClick={() => setShowIntro(false)}>
          <div className="bg-bg-surface rounded-2xl p-xl max-w-lg w-full mx-lg shadow-xl max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-lg">
              <h3 className="text-heading font-bold">📝 自我介绍</h3>
              <button onClick={() => setShowIntro(false)} className="text-text-tertiary hover:text-text-primary text-lg">✕</button>
            </div>
            {introLoading ? (
              <p className="text-body-sm text-text-secondary">加载中…</p>
            ) : intro ? (
              <p className="text-body text-text-primary leading-relaxed whitespace-pre-wrap">{intro}</p>
            ) : (
              <div className="text-center py-xl">
                <span className="text-4xl block mb-lg">📄</span>
                <p className="text-body-sm text-text-secondary">尚未上传简历</p>
                <p className="text-caption text-text-tertiary mt-sm">请在「我的」页面上传 PDF 简历生成自我介绍</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 小控件 ──
function LevelRow({ label, level }: { label: string; level: number }) {
  const pct = Math.round(level * 100);
  return (
    <div className="p-sm bg-bg rounded-lg">
      <div className="flex justify-between mb-1">
        <span className="text-caption text-text-tertiary">{label}</span>
        <span className="text-caption text-text-tertiary tabular-nums">{pct}%</span>
      </div>
      <MicLevelBar level={pct} />
    </div>
  );
}

function Status({ color, text }: { color: string; text: string }) {
  return (
    <div className={`flex items-center gap-xs text-body-sm font-medium ${
      color === 'success' ? 'text-success' : color === 'warning' ? 'text-warning' : 'text-danger'
    }`}>
      <PulsingDot /> {text}
    </div>
  );
}
