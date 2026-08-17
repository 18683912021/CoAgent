import type { Meta, StoryObj } from '@storybook/react';
import MicLevelBar from './MicLevelBar';

const meta = {
  title: '业务组件/MicLevelBar 音量条',
  component: MicLevelBar,
  tags: ['autodocs'],
} satisfies Meta<typeof MicLevelBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const 静音: Story = {
  args: { level: 0 },
};

export const 低音量: Story = {
  args: { level: 25 },
};

export const 中等音量: Story = {
  args: { level: 55 },
};

export const 高音量: Story = {
  args: { level: 80 },
};

export const 爆音: Story = {
  args: { level: 100 },
};

export const 说话中动画: Story = {
  args: { level: 50, animated: true },
};
