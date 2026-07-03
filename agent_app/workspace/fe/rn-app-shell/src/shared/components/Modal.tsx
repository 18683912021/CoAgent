/**
 * Modal — 通用弹窗组件
 *
 * 四态：正常展示 / 无 overlay（visible=false 不渲染）
 *
 * 使用：
 *   <Modal visible={visible} onClose={handleClose} title="标题">
 *     <Text>内容</Text>
 *   </Modal>
 */

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Modal as RNModal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAppTheme } from '@design-system/theme';
import { radii, spacing, fontSizes, fontWeights, zIndex } from '@design-system/tokens';

interface ModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** 底部操作区 */
  footer?: React.ReactNode;
  /** 点击遮罩是否关闭，默认 true */
  closeOnBackdrop?: boolean;
  /** 动画类型 */
  animation?: 'slide' | 'fade';
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export function Modal({
  visible,
  onClose,
  title,
  children,
  footer,
  closeOnBackdrop = true,
  animation = 'slide',
}: ModalProps): React.ReactElement {
  const theme = useAppTheme();
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const isAnimating = useRef(false);

  useEffect(() => {
    if (visible) {
      isAnimating.current = true;
      if (animation === 'slide') {
        translateY.setValue(SCREEN_HEIGHT);
        Animated.spring(translateY, {
          toValue: 0,
          damping: 20,
          stiffness: 200,
          useNativeDriver: true,
        }).start(() => {
          isAnimating.current = false;
        });
      } else {
        opacity.setValue(0);
        Animated.timing(opacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }).start(() => {
          isAnimating.current = false;
        });
      }
    }
  }, [visible, animation, translateY, opacity]);

  const handleClose = () => {
    if (isAnimating.current) return;
    isAnimating.current = true;

    if (animation === 'slide') {
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        isAnimating.current = false;
        onClose();
      });
    } else {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        isAnimating.current = false;
        onClose();
      });
    }
  };

  const animatedStyle =
    animation === 'slide'
      ? { transform: [{ translateY }] }
      : { opacity };

  return (
    <RNModal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={closeOnBackdrop ? handleClose : undefined}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* 遮罩 */}
        <Pressable
          style={[styles.backdrop, { backgroundColor: theme.colors.semantic.mask }]}
          onPress={closeOnBackdrop ? handleClose : undefined}
        />

        {/* 内容面板 */}
        <Animated.View
          style={[
            styles.panel,
            {
              backgroundColor: theme.colors.semantic.surface,
              borderTopLeftRadius: radii.xl,
              borderTopRightRadius: radii.xl,
            },
            animatedStyle,
          ]}
        >
          {/* 拖拽指示条 */}
          <View style={styles.handleBar}>
            <View style={[styles.handle, { backgroundColor: theme.colors.semantic.textDisabled }]} />
          </View>

          {/* 标题 */}
          {title ? (
            <View style={[styles.header, { borderBottomColor: theme.colors.semantic.divider }]}>
              <Text style={[styles.title, { color: theme.colors.semantic.textPrimary }]}>{title}</Text>
              <Pressable onPress={handleClose} hitSlop={12}>
                <Text style={[styles.closeBtn, { color: theme.colors.semantic.textSecondary }]}>✕</Text>
              </Pressable>
            </View>
          ) : null}

          {/* 内容 */}
          <View style={styles.body}>{children}</View>

          {/* 底部 */}
          {footer ? (
            <View style={[styles.footer, { borderTopColor: theme.colors.semantic.divider }]}>{footer}</View>
          ) : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: zIndex.modal - 1,
  },
  panel: {
    zIndex: zIndex.modal,
    maxHeight: SCREEN_HEIGHT * 0.85,
    paddingBottom: spacing.xxxl,
  },
  handleBar: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.semibold,
  },
  closeBtn: {
    fontSize: 18,
    padding: 4,
  },
  body: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.lg,
  },
});
