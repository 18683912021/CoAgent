import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAppTheme } from '@design-system/theme';

interface EmptyProps {
  icon?: string;
  title?: string;
  description?: string;
  actionText?: string;
  onAction?: () => void;
}

export function Empty({
  icon = '📭',
  title = '暂无数据',
  description,
  actionText,
  onAction,
}: EmptyProps): React.ReactElement {
  const theme = useAppTheme();

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={[styles.title, { color: theme.colors.semantic.textPrimary }]}>{title}</Text>
      {description ? (
        <Text style={[styles.description, { color: theme.colors.semantic.textTertiary }]}>{description}</Text>
      ) : null}
      {actionText && onAction ? (
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.colors.primary }]} onPress={onAction}>
          <Text style={styles.actionText}>{actionText}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  icon: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  actionBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  actionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
  },
});
