import type { Meta, StoryObj } from '@storybook/react';
import { action } from 'storybook/actions';
import ConversationBubble from './ConversationBubble';
import type { ConversationMessage } from './ConversationBubble';

const meta = {
  title: '业务组件/ConversationBubble 对话气泡',
  component: ConversationBubble,
  tags: ['autodocs'],
} satisfies Meta<typeof ConversationBubble>;

export default meta;
type Story = StoryObj<typeof meta>;

// 一份"底料"，各故事在它基础上改字段（字段与组件 Props 完全一致）
const base: ConversationMessage = {
  id: '1',
  role: 'ai',
  text: '',
  status: 'done',
  timestamp: Date.now(),
};

export const 加载中: Story = {
  args: { message: { ...base, role: 'ai', status: 'loading', text: '' } },
};

export const AI流式输出: Story = {
  args: {
    message: {
      ...base,
      role: 'ai',
      status: 'streaming',
      text: '你好，我是你的面试官助手。接下来我会问你三个问题，每次回答后可以点击气泡让我继续追问。',
    },
  },
};

export const 用户已答: Story = {
  args: {
    message: {
      ...base,
      role: 'user',
      status: 'done',
      text: '我会用 React 和 TypeScript 开发业务组件，最近刚学完 Storybook。',
    },
    // action() 标记的回调才会显示在右侧 Actions 面板里（console.log 只进浏览器控制台）
    onTriggerLLM: action('触发 LLM'),
  },
};

export const 面试官提问: Story = {
  args: {
    message: {
      ...base,
      role: 'interviewer',
      status: 'done',
      text: '请先做一下自我介绍，谈谈你最擅长的技术方向。',
    },
  },
};

export const 出错可重试: Story = {
  args: {
    message: {
      ...base,
      role: 'ai',
      status: 'error',
      text: '网络开小差了，请点击重试。',
    },
    onRetryLLM: action('重试 LLM'),
  },
};
