/**
 * Storybook 配置 — 组件文档化
 *
 * 运行: npm run storybook
 * 生成故事列表: npm run storybook:generate
 */

import { StorybookConfig } from '@storybook/react-native';

const main: StorybookConfig = {
  stories: [
    '../storybook/stories/**/*.stories.?(ts|tsx|js|jsx)',
    '../src/**/*.stories.?(ts|tsx|js|jsx)',
  ],
  addons: [
    '@storybook/addon-ondevice-actions',
    '@storybook/addon-ondevice-controls',
  ],
  // @ts-ignore - framework 字段类型定义不兼容
  framework: {
    name: '@storybook/react-native',
    options: {},
  },
};

export default main;