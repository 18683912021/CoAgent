import { View, Text, StyleSheet } from 'react-native';
import { useAppTheme } from '@design-system/theme';
import { useAuthStore } from '@core/auth';

export default function HomeScreen(): React.ReactElement {
  const theme = useAppTheme();
  const userInfo = useAuthStore((s) => s.userInfo);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.semantic.background }]}>
      <Text style={[styles.greeting, { color: theme.colors.semantic.textPrimary }]}>
        你好，{userInfo?.name ?? '用户'}
      </Text>
      <Text style={[styles.subtitle, { color: theme.colors.semantic.textSecondary }]}>
        欢迎使用 AppShell
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  greeting: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
  },
});
