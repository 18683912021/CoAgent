import type { Decorator } from '@storybook/react';
import '../src/index.css';

// 顶部工具栏加一个"明暗主题"下拉按钮
export const globalTypes = {
  theme: {
    description: '明暗主题',
    toolbar: {
      title: '主题',
      icon: 'contrast',
      items: [
        { value: 'light', title: '浅色' },
        { value: 'dark', title: '深色' },
      ],
      dynamicTitle: true,
    },
  },
};

// 给每个故事套一层"包装盒"：深色模式时加 dark 类 + 深色背景
export const decorators: Decorator[] = [
  (Story, context) => {
    const isDark = context.globals.theme === 'dark';
    return (
      <div
        className={isDark ? 'dark' : ''}
        style={{
          padding: 32,
          minHeight: '100vh',
          background: isDark ? '#141416' : '#F7F8FA',
        }}
      >
        <Story />
      </div>
    );
  },
];
