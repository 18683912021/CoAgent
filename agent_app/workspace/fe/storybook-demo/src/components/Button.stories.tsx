import type { Meta, StoryObj } from '@storybook/react';
import { Mic } from 'lucide-react';
import Button from './Button';

const meta = {
  title: '业务组件/Button 按钮',
  component: Button,
  // 注意：Button 有自定义 MDX 文档页（Button.mdx），不能再开 autodocs，否则会冲突报错
  args: {
    children: '开始面试',
  },
  parameters: {
    docs: {
      // 组件级说明：显示在 Docs 页顶部、参数表上方
      description: {
        component:
          '通用按钮，页面上的主操作入口。支持 4 种风格、3 种尺寸、加载中状态和图标。',
      },
    },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const 主按钮: Story = {
  args: { variant: 'primary' },
};

export const 次按钮: Story = {
  args: { variant: 'secondary' },
};

export const 幽灵按钮: Story = {
  args: { variant: 'ghost' },
};

export const 危险按钮: Story = {
  args: { variant: 'danger', children: '删除记录' },
};

export const 加载中: Story = {
  args: { loading: true },
};

export const 带图标: Story = {
  args: {
    icon: <Mic className="w-4 h-4" />,
    children: '开始录音',
  },
};

export const 三种尺寸: Story = {
  render: () => (
    <div className="flex items-end gap-3">
      <Button size="sm">小号</Button>
      <Button size="md">中号</Button>
      <Button size="lg">大号</Button>
    </div>
  ),
};

export const 禁用: Story = {
  args: { disabled: true },
};
