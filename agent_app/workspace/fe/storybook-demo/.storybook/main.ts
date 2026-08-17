import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  // 去哪找故事文件和 MDX 文档页：src 下所有 *.stories.tsx 和 *.mdx
  stories: ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)', '../src/**/*.mdx'],
  // Storybook 9 已内置 Controls / Actions / Viewport 等插件；
  // addon-docs 负责 MDX 文档页的编译
  addons: ['@storybook/addon-docs'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
};

export default config;
