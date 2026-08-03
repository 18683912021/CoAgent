/**
 * ConversationBubble —— PC 端对话气泡
 *
 * 四种状态：loading / streaming / done / error
 * 流式文字逐字动画（requestAnimationFrame）、Markdown 轻量渲染、
 * 点击面试官/用户气泡触发 LLM、点击 AI 错误气泡重试。
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import type { ConversationMessage } from '../store/types';

interface Props {
  message: ConversationMessage;
  onTriggerLLM?: (bubbleId: string) => void;
  onRetryLLM?: (bubbleId: string) => void;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export default function ConversationBubble({ message, onTriggerLLM, onRetryLLM }: Props) {
  const { id, role, text, status, timestamp } = message;
  const isAI = role === 'ai';
  const isInterviewer = role === 'interviewer';
  const clickable = !isAI && onTriggerLLM != null;

  // ── 打字动画 ──
  const [visibleLen, setVisibleLen] = useState(status === 'done' || status === 'error' ? text.length : 0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (status === 'done' || status === 'error') { setVisibleLen(text.length); return; }
    if (status === 'loading') { setVisibleLen(0); return; }
    let active = true;
    const step = () => {
      if (!active) return;
      setVisibleLen(prev => {
        if (prev >= text.length) return prev;
        const backlog = text.length - prev;
        const speed = backlog <= 20 ? 5 : Math.min(15, 5 + Math.ceil((backlog - 20) / 8));
        return Math.min(prev + speed, text.length);
      });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { active = false; if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [status, text.length]);

  const visibleText = text.slice(0, visibleLen);
  const isTyping = isAI && status === 'streaming' && visibleLen < text.length;

  // ── 气泡样式 ──
  const isRight = !isInterviewer;
  const alignClass = isRight ? 'items-end' : 'items-start';
  const bubbleClass = isAI
    ? 'bg-bubble-ai border border-bubble-ai-border'
    : isInterviewer
      ? 'bg-bubble-interviewer'
      : 'bg-bubble-user border border-bubble-user-border';
  const avatar = isInterviewer ? '🎙️' : isAI ? '🤖' : '👤';
  const roleLabel = isInterviewer ? '面试官' : isAI ? 'AI' : '你';

  const handleClick = useCallback(() => {
    if (clickable && onTriggerLLM) onTriggerLLM(id);
  }, [clickable, onTriggerLLM, id]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex flex-col ${alignClass} mb-lg`}
    >
      {/* 角色行 */}
      <div className="flex items-center gap-xs px-1 mb-1">
        <span className="text-sm">{avatar}</span>
        <span className="text-caption text-text-tertiary">{roleLabel}</span>
        <span className="text-caption text-text-tertiary ml-auto">{fmtTime(timestamp)}</span>
      </div>

      {/* 气泡体 */}
      <div
        onClick={handleClick}
        className={`max-w-[70%] px-lg py-md rounded-lg ${bubbleClass} ${
          clickable ? 'cursor-pointer hover:shadow-md active:scale-[0.98] transition-all' : ''
        } ${status === 'error' ? 'border-danger' : ''}`}
      >
        {status === 'loading' ? (
          <LoadingDots />
        ) : (
          <div className="text-body-sm leading-relaxed whitespace-pre-wrap break-words">
            <RichText text={visibleText} />
            {isTyping && <span className="inline-block w-0.5 h-4 bg-accent animate-pulse ml-0.5 align-middle" />}
          </div>
        )}

        {/* 错误重试 */}
        {status === 'error' && onRetryLLM && (
          <button
            onClick={(e) => { e.stopPropagation(); onRetryLLM(id); }}
            className="mt-sm text-caption text-danger underline hover:no-underline"
          >
            点击重试
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ── Loading dots animation ──
function LoadingDots() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % 3), 300);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex gap-1.5 py-1">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className={`inline-block w-2 h-2 rounded-full bg-accent transition-all duration-200 ${
            frame === i ? 'scale-110 opacity-100' : 'scale-75 opacity-40'
          }`}
        />
      ))}
    </div>
  );
}

// ── 轻量 Markdown ──
function RichText({ text }: { text: string }) {
  const blocks = text.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {blocks.map((block, bi) => {
        if (block.startsWith('```') && block.endsWith('```')) {
          const code = block.slice(3, -3).replace(/^\n/, '');
          return (
            <pre key={bi} className="my-sm px-md py-sm bg-bg rounded-sm text-caption font-mono overflow-x-auto whitespace-pre-wrap">
              {code}
            </pre>
          );
        }
        const parts = block.split(/(\*\*.*?\*\*|`.*?`)/g);
        return (
          <span key={bi}>
            {parts.map((part, pi) => {
              if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={pi}>{part.slice(2, -2)}</strong>;
              }
              if (part.startsWith('`') && part.endsWith('`')) {
                return <code key={pi} className="px-1 bg-divider rounded text-caption font-mono text-accent">{part.slice(1, -1)}</code>;
              }
              return <span key={pi}>{part}</span>;
            })}
          </span>
        );
      })}
    </>
  );
}
