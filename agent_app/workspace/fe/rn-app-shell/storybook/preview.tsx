/**
 * Storybook Preview — 全局 decorator 和参数
 */

import { Preview } from '@storybook/react-native';
import { useAppTheme, Theme } from '../src/design-system/theme';
import { View, Text } from 'react-native';
import React from 'react';

// 用 ThemeProvider 包裹所有 Story
function ThemeWrapper({ children }: { children: React.ReactNode }) {
  const theme = useAppTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.semantic.background, padding: 16 }}>
      {children}
    </View>
  );
}

const preview: Preview = {
  decorators: [
    (Story) => (
      <ThemeWrapper>
        <Story />
      </ThemeWrapper>
    ),
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/,
      },
    },
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: '#f5f5f5' },
        { name: 'dark', value: '#0a0a0a' },
      ],
    },
  },
};

export default preview;
