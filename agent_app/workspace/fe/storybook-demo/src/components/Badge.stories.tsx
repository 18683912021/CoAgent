import type { Meta, StoryObj } from '@storybook/react';
import Badge from './Badge';

const meta = {
  title: '业务组件/Badge 标签',
  component: Badge,
  tags: ['autodocs'],
  args: {
    children: '标签文字',
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const 中性: Story = { args: { tone: 'neutral' } };
export const 成功: Story = { args: { tone: 'success', dot: true, children: '已通过' } };
export const 警告: Story = { args: { tone: 'warning', dot: true, children: '待复核' } };
export const 危险: Story = { args: { tone: 'danger', children: '已淘汰' } };
export const 强调色: Story = { args: { tone: 'accent', children: 'AI 推荐' } };

export const 全部样式一览: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Badge tone="neutral">普通</Badge>
      <Badge tone="success" dot>在线</Badge>
      <Badge tone="warning" dot>排队中</Badge>
      <Badge tone="danger">异常</Badge>
      <Badge tone="accent" dot>进行中</Badge>
    </div>
  ),
};
