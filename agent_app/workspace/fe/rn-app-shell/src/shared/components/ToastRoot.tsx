/**
 * ToastRoot — Toast UI 容器
 *
 * 必须在 App 根组件（RootLayout）中挂载一次。
 * 之后任何地方调用 toast.show() 都会在这里渲染。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@design-system/theme';
import { zIndex, radii, fontSizes, spacing } from '@design-system/tokens';
import { toast } from './Toast';

// ---- 类型 ----

interface ToastItem {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration: number;
}

// ---- 图标映射 ----

const TYPE_ICONS: Record<ToastItem['type'], string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
  warning: '⚠',
};

// ---- 颜色映射（不依赖 theme 配色，保证可辨识） ----

const TYPE_COLORS: Record<ToastItem['type'], { bg: string; text: string; iconBg: string }> = {
  success: { bg: '#f6ffed', text: '#135200', iconBg: '#52c41a' },
  error: { bg: '#fff2f0', text: '#820014', iconBg: '#ff4d4f' },
  info: { bg: '#e6f4ff', text: '#003a8c', iconBg: '#1677ff' },
  warning: { bg: '#fffbe6', text: '#613400', iconBg: '#faad14' },
};

let toastIdCounter = 0;

/**
 * Toast 动画容器（单个 toast 条）
 */
function ToastBar({
  item,
  onRemove,
}: {
  item: ToastItem;
  onRemove: (id: string) => void;
}): React.ReactElement {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;

  useEffect(() => {
    // 入场动画
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    // 自动消失
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: -20,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => onRemove(item.id));
    }, item.duration);

    return () => clearTimeout(timer);
  }, [item, onRemove, opacity, translateY]);

  const colors = TYPE_COLORS[item.type];

  return (
    <Animated.View
      style={[
        styles.toastBar,
        {
          backgroundColor: colors.bg,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={[styles.iconCircle, { backgroundColor: colors.iconBg }]}>
        <Text style={styles.iconText}>{TYPE_ICONS[item.type]}</Text>
      </View>
      <Text style={[styles.message, { color: colors.text }]} numberOfLines={2}>
        {item.message}
      </Text>
      <TouchableOpacity onPress={() => onRemove(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={[styles.close, { color: colors.text }]}>×</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

/**
 * Toast 根容器
 * 挂载到 RootLayout 最顶层
 */
export function ToastRoot(): React.ReactElement | null {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const insets = useSafeAreaInsets();

  const addToast = useCallback((message: string, options: { type?: ToastItem['type']; duration?: number }) => {
    const id = `toast_${++toastIdCounter}_${Date.now()}`;
    const item: ToastItem = {
      id,
      message,
      type: options.type ?? 'info',
      duration: options.duration ?? 2000,
    };

    setToasts((prev) => {
      // 最多同时显示 3 条
      const next = [...prev, item];
      if (next.length > 3) next.shift();
      return next;
    });
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    toast._setListener(addToast);
    return () => toast._removeListener();
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <View
      style={[
        styles.container,
        {
          top: insets.top + spacing.lg,
          left: spacing.lg,
          right: spacing.lg,
        },
      ]}
      pointerEvents="box-none"
    >
      {toasts.map((item) => (
        <ToastBar key={item.id} item={item} onRemove={removeToast} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    zIndex: zIndex.toast,
    gap: spacing.sm,
  },
  toastBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
    minHeight: 44,
  },
  iconCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  iconText: {
    color: '#fff',
    fontSize: fontSizes.sm,
    fontWeight: '700',
  },
  message: {
    flex: 1,
    fontSize: fontSizes.md,
    lineHeight: 20,
  },
  close: {
    fontSize: 18,
    fontWeight: '300',
    marginLeft: spacing.sm,
    paddingHorizontal: 2,
  },
});
