/**
 * AI 浮窗（独立窗口）
 *
 * 渲染在 Electron 的独立 BrowserWindow 中。
 * 只显示最新的 AI 答案，透明背景。
 */
import { useState, useEffect } from 'react';

export default function OverlayScreen() {
  const [latestAnswer, setLatestAnswer] = useState('等待 AI 回答...');

  useEffect(() => {
    // 监听主进程通过 IPC 发送的 AI 答案
    const api = (window as any).electronAPI;
    if (api) {
      const unsub = api.audio.onLLMDone((data: any) => {
        if (data?.full_answer) {
          setLatestAnswer(data.full_answer);
        }
      });
      return () => { if (unsub) unsub(); };
    }
  }, []);

  return (
    <div className="h-full bg-transparent text-white p-lg select-none">
      <div className="h-full rounded-lg bg-black/80 backdrop-blur p-lg flex flex-col">
        {/* 拖动条 */}
        <div className="h-8 -mx-lg -mt-lg mb-md bg-white/10 rounded-t-lg cursor-move flex items-center justify-center">
          <div className="w-10 h-1 bg-white/30 rounded-full" />
        </div>

        <div className="text-caption text-white/50 mb-sm">AI 答案</div>

        <div className="flex-1 overflow-y-auto text-body-sm leading-relaxed whitespace-pre-wrap">
          {latestAnswer}
        </div>
      </div>
    </div>
  );
}
