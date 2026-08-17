/**
 * App —— demo 组合页
 *
 * 把 4 个组件拼成一个小型"AI 面试助手"界面，演示：
 * 1. 组件怎么组合成页面
 * 2. 浅色/深色主题切换
 * 3. 交互（点"用户已答"气泡可触发回调）
 */
import { useEffect, useState } from 'react';
import { Moon, Sun, Volume2 } from 'lucide-react';
import Button from './components/Button';
import Badge from './components/Badge';
import ConversationBubble from './components/ConversationBubble';
import type { ConversationMessage } from './components/ConversationBubble';
import MicLevelBar from './components/MicLevelBar';
import InterviewCard from './components/InterviewCard';

const now = Date.now();

// 一段演示对话
const messages: ConversationMessage[] = [
  {
    id: '1',
    role: 'interviewer',
    text: '请先做一个自我介绍，谈谈你最擅长的技术方向。',
    status: 'done',
    timestamp: now - 60_000,
  },
  {
    id: '2',
    role: 'user',
    text: '你好，我会用 React 和 TypeScript 开发业务组件，最近刚学完 Storybook 的入门教程。',
    status: 'done',
    timestamp: now - 30_000,
  },
  {
    id: '3',
    role: 'ai',
    text: '很好！那请你谈谈：把一个组件放进 Storybook 需要哪几步？',
    status: 'streaming',
    timestamp: now - 5_000,
  },
];

export default function App() {
  const [isDark, setIsDark] = useState(true);

  // 默认跟随系统；切换时给 html 加/去 .dark 类
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      {/* 顶栏 */}
      <header className="sticky top-0 z-10 border-b border-divider bg-bg/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-accent text-white flex items-center justify-center text-sm font-bold">
              S
            </span>
            <span className="font-semibold text-sm">Storybook Demo · AI 面试助手</span>
            <Badge tone="accent" dot>
              示例
            </Badge>
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            onClick={() => setIsDark((v) => !v)}
          >
            {isDark ? '浅色' : '深色'}
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左栏：组件画廊 */}
        <section className="lg:col-span-1 space-y-6">
          <div className="bg-bg-surface border border-divider rounded-xl p-4">
            <h2 className="text-xs font-semibold text-text-secondary mb-3 uppercase tracking-wider">
              Button 按钮
            </h2>
            <div className="flex flex-wrap gap-2">
              <Button>开始面试</Button>
              <Button variant="secondary">保存草稿</Button>
              <Button variant="ghost" size="sm">
                跳过
              </Button>
            </div>
          </div>

          <div className="bg-bg-surface border border-divider rounded-xl p-4">
            <h2 className="text-xs font-semibold text-text-secondary mb-3 uppercase tracking-wider">
              Badge 标签
            </h2>
            <div className="flex flex-wrap gap-2">
              <Badge tone="success" dot>
                在线
              </Badge>
              <Badge tone="warning" dot>
                排队中
              </Badge>
              <Badge tone="danger">已淘汰</Badge>
              <Badge tone="accent">AI 推荐</Badge>
            </div>
          </div>

          <div className="bg-bg-surface border border-divider rounded-xl p-4">
            <h2 className="text-xs font-semibold text-text-secondary mb-3 uppercase tracking-wider">
              MicLevelBar 音量条（模拟说话）
            </h2>
            <div className="flex items-center gap-3">
              <MicLevelBar animated level={50} />
              <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
                <Volume2 className="w-4 h-4" />
                正在收音
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
              InterviewCard 记录卡片
            </h2>
            <InterviewCard
              title="前端开发 · 初试"
              date="2026-08-15"
              duration="32 分钟"
              score={92}
              status="passed"
            />
            <InterviewCard
              title="React 中高级 · 复试"
              date="2026-08-14"
              duration="45 分钟"
              score={68}
              status="pending"
            />
          </div>
        </section>

        {/* 右栏：模拟面试对话 */}
        <section className="lg:col-span-2 bg-bg-surface border border-divider rounded-xl p-6 flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-semibold">模拟面试 · 正在进行</h2>
            <Badge tone="accent" dot>
              流式输出中
            </Badge>
          </div>

          <div className="flex-1 min-h-[320px]">
            {messages.map((m) => (
              <ConversationBubble
                key={m.id}
                message={m}
                onTriggerLLM={(id) => console.log('触发 LLM:', id)}
              />
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-divider flex items-center gap-3">
            <input
              className="flex-1 h-10 px-4 rounded-md bg-bg border border-divider text-sm outline-none focus:border-accent transition-colors"
              placeholder="输入你的回答…（demo 中打字只做展示）"
            />
            <Button icon={<Volume2 className="w-4 h-4" />}>发送回答</Button>
          </div>
        </section>
      </main>
    </div>
  );
}
