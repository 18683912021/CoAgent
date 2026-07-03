/**
 * Empty 组件 Story
 */

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Empty } from '../../src/shared/components/Empty';

const meta: Meta<typeof Empty> = {
  title: 'Shared/Empty',
  component: Empty,
  argTypes: {
    icon: { control: 'text' },
    title: { control: 'text' },
    description: { control: 'text' },
    actionText: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Empty>;

export const Default: Story = {
  args: {
    icon: '📭',
    title: '暂无数据',
    description: '当前没有内容，请稍后再来',
  },
};

export const WithAction: Story = {
  args: {
    icon: '⚠️',
    title: '加载失败',
    description: '请检查网络连接后重试',
    actionText: '重试',
    onAction: () => alert('重试'),
  },
};

export const NoDescription: Story = {
  args: {
    icon: '🔍',
    title: '未找到结果',
  },
};

export const CustomIcon: Story = {
  args: {
    icon: '🎉',
    title: '全部完成',
    description: '你已浏览完所有内容',
  },
};
