import type { Meta, StoryObj } from '@storybook/react';
import InterviewCard from './InterviewCard';

const meta = {
  title: '业务组件/InterviewCard 面试记录卡片',
  component: InterviewCard,
  tags: ['autodocs'],
} satisfies Meta<typeof InterviewCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const 高分通过: Story = {
  args: {
    title: '前端开发 · 初试',
    company: '某大厂',
    date: '2026-08-15',
    duration: '32 分钟',
    score: 92,
    status: 'passed',
  },
};

export const 待复核: Story = {
  args: {
    title: 'React 中高级岗位 · 复试',
    company: '某创业公司',
    date: '2026-08-14',
    duration: '45 分钟',
    score: 68,
    status: 'pending',
  },
};

export const 未通过: Story = {
  args: {
    title: '全栈工程师 · 笔试',
    company: '某外企',
    date: '2026-08-10',
    duration: '20 分钟',
    score: 42,
    status: 'failed',
  },
};
