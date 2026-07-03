/**
 * Loading 组件 Story
 */

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Loading } from '../../src/shared/components/Loading';

const meta: Meta<typeof Loading> = {
  title: 'Shared/Loading',
  component: Loading,
  argTypes: {
    text: { control: 'text' },
    fullScreen: { control: 'boolean' },
    size: {
      control: 'radio',
      options: ['small', 'large'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Loading>;

export const Default: Story = {
  args: {
    text: '加载中...',
    fullScreen: false,
    size: 'large',
  },
};

export const FullScreen: Story = {
  args: {
    text: '正在加载数据...',
    fullScreen: true,
    size: 'large',
  },
};

export const Small: Story = {
  args: {
    text: '',
    fullScreen: false,
    size: 'small',
  },
};

export const NoText: Story = {
  args: {
    text: undefined,
    fullScreen: false,
    size: 'large',
  },
};
