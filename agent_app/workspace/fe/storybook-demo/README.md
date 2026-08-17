# Storybook Demo

根据你项目（audio-capture）的技术栈搭的 React 组件 demo：
**React 19 + Vite 6 + TypeScript + Tailwind 3 + framer-motion + Storybook 10**

## 怎么跑

```bash
pnpm install          # 装依赖（已装过可跳过）
pnpm storybook        # 打开组件陈列室 → http://localhost:6006
pnpm dev              # 打开组合演示页（App.tsx）→ http://localhost:5173
```

## 这个 demo 里有什么

| 组件 | 文件 | 演示点 |
|---|---|---|
| Button 按钮 | [src/components/Button.tsx](src/components/Button.tsx) | 4 种风格 × 3 种尺寸 + loading + 图标 |
| Badge 标签 | [src/components/Badge.tsx](src/components/Badge.tsx) | 5 种色调 + 小圆点 |
| ConversationBubble 对话气泡 | [src/components/ConversationBubble.tsx](src/components/ConversationBubble.tsx) | 3 角色 × 4 状态，流式打字动画 |
| MicLevelBar 音量条 | [src/components/MicLevelBar.tsx](src/components/MicLevelBar.tsx) | 10 格电平，可模拟说话波动 |
| InterviewCard 记录卡片 | [src/components/InterviewCard.tsx](src/components/InterviewCard.tsx) | 组合示例：Badge + 评分条 |

每个组件旁边都有同名 `.stories.tsx` —— 那是它们的"Storybook 故事"。

## 想照着学？

配套文档（在 audio-capture 项目里）：
- `docs/Storybook入门指南.md` —— 概念 + 安装 + 模板
- `docs/Storybook改造方案.md` —— 改造后的结构 + 哪些能用/不能用

## 目录结构

```
storybook-demo/
├── .storybook/              # Storybook 配置（main.ts + preview.tsx）
├── src/
│   ├── components/          # 组件 + 每个组件的故事文件
│   │   ├── Button.tsx / Button.stories.tsx
│   │   ├── Badge.tsx / Badge.stories.tsx
│   │   ├── ConversationBubble.tsx / .stories.tsx
│   │   ├── MicLevelBar.tsx / .stories.tsx
│   │   └── InterviewCard.tsx / .stories.tsx
│   ├── App.tsx              # 组合演示页（含明暗切换）
│   └── index.css            # Tailwind + CSS 变量主题
├── vite.config.ts
├── tailwind.config.js
└── package.json
```
