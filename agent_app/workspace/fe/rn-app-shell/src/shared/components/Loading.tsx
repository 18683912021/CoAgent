import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { useAppTheme } from '@design-system/theme';

interface LoadingProps {
  text?: string;
  fullScreen?: boolean;
  size?: 'small' | 'large';
}

export function Loading({ text = '加载中...', fullScreen = false, size = 'large' }: LoadingProps): React.ReactElement {
  const theme = useAppTheme();

  return (
    <View
      style={[
        styles.container,
        fullScreen && styles.fullScreen,
        { backgroundColor: fullScreen ? theme.colors.semantic.background : 'transparent' },
      ]}
    >
      <ActivityIndicator size={size} color={theme.colors.primary} />
      {text ? (
        <Text style={[styles.text, { color: theme.colors.semantic.textSecondary }]}>{text}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  fullScreen: {
    flex: 1,
  },
  text: {
    marginTop: 12,
    fontSize: 14,
  },
});
