/**
 * MenuRow — 通用菜单行组件
 *
 * 用于用户中心的各种设置项。
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Switch } from 'react-native';
import { useAppTheme } from '@design-system/theme';
import { spacing, fontSizes, fontWeights, shadows } from '@design-system/tokens';

interface MenuRowProps {
  icon?: string;
  title: string;
  subtitle?: string;
  rightText?: string;
  rightIcon?: string;
  showArrow?: boolean;
  switchValue?: boolean;
  onSwitchChange?: (value: boolean) => void;
  onPress?: () => void;
  danger?: boolean;
  /** 分组位置：首项/中间/末项/独立 */
  position?: 'first' | 'middle' | 'last' | 'single';
}

export function MenuRow({
  icon,
  title,
  subtitle,
  rightText,
  rightIcon,
  showArrow = true,
  switchValue,
  onSwitchChange,
  onPress,
  danger = false,
  position = 'single',
}: MenuRowProps): React.ReactElement {
  const theme = useAppTheme();

  const borderRadius = {
    first: { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
    middle: {},
    last: { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
    single: { borderRadius: 12 },
  }[position];

  const inner = (
    <View
      style={[
        styles.row,
        {
          backgroundColor: theme.colors.semantic.surface,
          borderBottomWidth: position === 'first' || position === 'middle' ? StyleSheet.hairlineWidth : 0,
          borderBottomColor: theme.colors.semantic.divider,
        },
        borderRadius,
      ]}
    >
      {icon ? <Text style={styles.icon}>{icon}</Text> : null}
      <View style={styles.content}>
        <Text
          style={[
            styles.title,
            { color: danger ? theme.colors.error : theme.colors.semantic.textPrimary },
          ]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: theme.colors.semantic.textTertiary }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {rightText ? (
        <Text style={[styles.rightText, { color: theme.colors.semantic.textTertiary }]}>{rightText}</Text>
      ) : null}
      {switchValue !== undefined ? (
        <Switch
          value={switchValue}
          onValueChange={onSwitchChange}
          trackColor={{ true: theme.colors.primary, false: theme.colors.semantic.textDisabled }}
        />
      ) : showArrow ? (
        <Text style={[styles.arrow, { color: theme.colors.semantic.textTertiary }]}>›</Text>
      ) : null}
      {rightIcon ? <Text style={styles.rightIcon}>{rightIcon}</Text> : null}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.6}>
        {inner}
      </TouchableOpacity>
    );
  }

  return inner;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    marginHorizontal: spacing.lg,
  },
  icon: {
    fontSize: 20,
    marginRight: spacing.md,
  },
  content: {
    flex: 1,
    marginRight: spacing.md,
  },
  title: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.medium,
  },
  subtitle: {
    fontSize: fontSizes.sm,
    marginTop: 2,
  },
  rightText: {
    fontSize: fontSizes.md,
  },
  arrow: {
    fontSize: 20,
    fontWeight: fontWeights.regular,
  },
  rightIcon: {
    fontSize: 18,
  },
});
