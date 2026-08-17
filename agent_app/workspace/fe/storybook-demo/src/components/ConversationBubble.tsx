/**
 * ConversationBubble —— 对话气泡（demo 简化版）
 *
 * 三种角色：面试官 / AI / 你
 * 四种状态：loading（加载）/ streaming（流式打字）/ done（完成）/ error（出错）
 */
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export interface ConversationMessage {
  id: string;
  role: 'interviewer' | 'ai' | 'user';
  text: string;
  status: 'loading' | 'streaming' | 'done' | 'error';
  timestamp: number;
}

interface Props {
  message: ConversationMessage;
  onTriggerLLM?: (id: string) => void;
  onRetryLLM?: (id: string) => void;
}

/** 流式打字：逐字显示，直到文字放完 */
function useTypewriter(text: string, active: boolean, speed = 24) {
  const [visible, setVisible] = useState(active ? 0 : text.length);
  useEffect(() => {
    if (!active) return;
    setVisible(0);
    let i = 0;
    const timer = setInterval(() => {
      i += 2;
      setVisible(i);
      if (i >= text.length) clearInterval(timer);
    }, speed);
    return () => clearInterval(timer);
  }, [text, active, speed]);
  return text.slice(0, visible);
}

export default function ConversationBubble({ message, onTriggerLLM, onRetryLLM }: Props) {
  const { id, role, text, status, timestamp } = message;
  const isAI = role === 'ai';
  const isInterviewer = role === 'interviewer';
  const clickable = !isAI && status === 'done' && onTriggerLLM != null;

  const streaming = useTypewriter(text, status === 'streaming');
  const showText = status === 'streaming' ? streaming : text;
  const isTyping = isAI && status === 'streaming' && streaming.length < text.length;

  const roleLabel = isInterviewer ? '面试官' : isAI ? 'AI 助手' : '你';
  const avatar = isInterviewer ? '🎙️' : isAI ? '🤖' : '👤';

  const time = new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex items-end gap-2.5 mb-4 ${isInterviewer ? '' : 'flex-row-reverse'}`}
    >
      {/* 头像 */}
      <div
        className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-sm border ${
          isInterviewer
            ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700'
            : isAI
              ? 'bg-accent-light border-indigo-100 dark:border-indigo-500/20'
              : 'bg-success/10 border-emerald-100 dark:border-emerald-500/20'
        }`}
      >
        {avatar}
      </div>

      <div className={`flex flex-col ${isInterviewer ? 'items-start' : 'items-end'} min-w-0 max-w-[70%]`}>
        <div className={`flex items-center gap-2 px-1 mb-1.5 ${isInterviewer ? '' : 'flex-row-reverse'}`}>
          <span className="text-[11px] font-semibold text-text-secondary">{roleLabel}</span>
          <span className="w-1 h-1 rounded-full bg-divider" />
          <span className="text-[11px] text-text-secondary">{time}</span>
        </div>

        <div
          onClick={() => clickable && onTriggerLLM(id)}
          className={[
            'px-4 py-3 rounded-2xl text-sm leading-relaxed break-words whitespace-pre-wrap',
            isAI
              ? 'bg-bg-surface border border-divider shadow-sm'
              : isInterviewer
                ? 'bg-zinc-100 dark:bg-zinc-800/50 text-text-primary'
                : 'bg-accent-light border border-indigo-100 dark:border-indigo-500/20',
            isAI ? (isInterviewer ? 'rounded-tl-md' : 'rounded-tr-md') : 'rounded-tr-md',
            clickable && 'cursor-pointer hover:shadow-md',
            status === 'error' && 'border-danger/50',
          ].join(' ')}
        >
          {status === 'loading' ? (
            <LoadingDots />
          ) : (
            <>
              {showText}
              {isTyping && (
                <span className="inline-block w-[3px] h-4 bg-accent animate-pulse ml-0.5 align-middle rounded-sm" />
              )}
            </>
          )}

          {status === 'error' && onRetryLLM && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRetryLLM(id);
              }}
              className="mt-2 text-xs text-danger font-medium hover:underline"
            >
              重新生成 →
            </button>
          )}

          {clickable && (
            <div className="mt-2 text-[11px] text-text-secondary font-medium">点击获取 AI 回答</div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function LoadingDots() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % 3), 300);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex gap-1.5 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-600 transition-all duration-200 ${
            frame === i ? 'scale-110 opacity-100' : 'scale-75 opacity-40'
          }`}
        />
      ))}
    </div>
  );
}
