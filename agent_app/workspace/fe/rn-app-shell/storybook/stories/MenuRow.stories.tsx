/**
 * MenuRow 组件 Story
 */

import React from 'react';
import { View, Alert } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react';
import { MenuRow } from '../../src/features/user/components/MenuRow';

const meta: Meta<typeof MenuRow> = {
  title: 'User/MenuRow',
  component: MenuRow,
  argTypes: {
    position: {
      control: 'radio',
      options: ['first', 'middle', 'last', 'single'],
    },
    danger: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof MenuRow>;

export const Single: Story = {
  args: {
    icon: '👤',
    title: '个人资料',
    showArrow: true,
    position: 'single',
    onPress: () => alert('clicked'),
  },
};

export const Group: Story = {
  render: () => (
    <View style={{ gap: 0 }}>
      <MenuRow icon="🔐" title="账号安全" subtitle="密码、手机号管理" position="first" onPress={() => {}} />
      <MenuRow icon="🔔" title="消息通知" rightText="已开启" position="middle" onPress={() => {}} />
      <MenuRow icon="🌙" title="深色模式" position="last" switchValue={false} onSwitchChange={() => {}} />
    </View>
  ),
};

export const Danger: Story = {
  args: {
    icon: '🚪',
    title: '退出登录',
    position: 'single',
    danger: true,
    onPress: () => Alert.alert('确认退出'),
  },
};

export const NoArrow: Story = {
  args: {
    icon: '📱',
    title: '当前版本',
    rightText: 'v1.0.0',
    showArrow: false,
    position: 'single',
  },
};
