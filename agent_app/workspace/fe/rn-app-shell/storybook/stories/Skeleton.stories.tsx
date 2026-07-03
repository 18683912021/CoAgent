/**
 * Skeleton 组件 Story
 */

import React from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react';
import { Skeleton, SkeletonCard, SkeletonList } from '../../src/shared/components/Skeleton';

const meta: Meta<typeof Skeleton> = {
  title: 'Shared/Skeleton',
  component: Skeleton,
  argTypes: {
    width: { control: 'text' },
    height: { control: 'number' },
    borderRadius: { control: 'number' },
  },
};

export default meta;
type Story = StoryObj<typeof Skeleton>;

export const Default: Story = {
  args: {
    width: '100%',
    height: 16,
    borderRadius: 4,
  },
};

export const Wide: Story = {
  args: {
    width: '80%',
    height: 20,
    borderRadius: 6,
  },
};

export const Circle: Story = {
  args: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
};

export const TextBlock: Story = {
  render: () => (
    <View style={{ gap: 8 }}>
      <Skeleton width="60%" height={22} />
      <Skeleton width="100%" height={14} />
      <Skeleton width="100%" height={14} />
      <Skeleton width="40%" height={14} />
    </View>
  ),
};

export const Card: Story = {
  render: () => <SkeletonCard />,
};

export const List: Story = {
  render: () => <SkeletonList count={3} />,
};
