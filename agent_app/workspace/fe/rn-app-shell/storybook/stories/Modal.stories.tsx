/**
 * Modal 组件 Story
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react';
import { Modal } from '../../src/shared/components/Modal';

function ModalDemo({ animation }: { animation: 'slide' | 'fade' }) {
  const [visible, setVisible] = useState(false);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <TouchableOpacity
        onPress={() => setVisible(true)}
        style={{ padding: 16, backgroundColor: '#1677ff', borderRadius: 8 }}
      >
        <Text style={{ color: '#fff', fontWeight: '600' }}>打开弹窗</Text>
      </TouchableOpacity>
      <Modal
        visible={visible}
        onClose={() => setVisible(false)}
        title="示例弹窗"
        animation={animation}
        footer={
          <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16 }}>
            <TouchableOpacity
              onPress={() => setVisible(false)}
              style={{
                flex: 1,
                padding: 12,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: '#e8e8e8',
                alignItems: 'center',
              }}
            >
              <Text>取消</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setVisible(false)}
              style={{
                flex: 1,
                padding: 12,
                borderRadius: 8,
                backgroundColor: '#1677ff',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff' }}>确认</Text>
            </TouchableOpacity>
          </View>
        }
      >
        <View style={{ padding: 24, minHeight: 120 }}>
          <Text style={{ fontSize: 14, color: '#666' }}>这里是弹窗的内容区域。</Text>
        </View>
      </Modal>
    </View>
  );
}

const meta: Meta<typeof Modal> = {
  title: 'Shared/Modal',
  component: Modal,
};

export default meta;
type Story = StoryObj<typeof Modal>;

export const SlideAnimation: Story = {
  render: () => <ModalDemo animation="slide" />,
};

export const FadeAnimation: Story = {
  render: () => <ModalDemo animation="fade" />,
};
