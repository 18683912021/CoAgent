/**
 * CachedImage 组件 Story
 */

import React from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react';
import { CachedImage } from '../../src/shared/components/CachedImage';

const SAMPLE_URI = 'https://picsum.photos/400/400';

const meta: Meta<typeof CachedImage> = {
  title: 'Shared/CachedImage',
  component: CachedImage,
  argTypes: {
    placeholderType: {
      control: 'radio',
      options: ['default', 'circle', 'none'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof CachedImage>;

export const Default: Story = {
  args: {
    source: { uri: SAMPLE_URI },
    style: { width: 200, height: 200, borderRadius: 12 },
  },
};

export const Circle: Story = {
  args: {
    source: { uri: SAMPLE_URI },
    style: { width: 100, height: 100, borderRadius: 50 },
    placeholderType: 'circle',
  },
};

export const WithFallback: Story = {
  args: {
    source: { uri: 'https://invalid-url-that-fails.com/image.jpg' },
    style: { width: 200, height: 200, borderRadius: 12 },
    fallback: () => (
      <View
        style={{
          width: 200,
          height: 200,
          borderRadius: 12,
          backgroundColor: '#f0f0f0',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <View>
          <View style={{ fontSize: 32 }}>🖼️</View>
        </View>
      </View>
    ),
  },
};

export const Gallery: Story = {
  render: () => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <CachedImage
          key={i}
          source={{ uri: `https://picsum.photos/200/200?random=${i}` }}
          style={{ width: 100, height: 100, borderRadius: 8 }}
        />
      ))}
    </View>
  ),
};
