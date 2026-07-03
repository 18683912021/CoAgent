import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppTheme } from '@design-system/theme';
import { useAuthStore } from '@core/auth';
import { useTranslation } from 'react-i18next';

export default function SettingsScreen(): React.ReactElement {
  const theme = useAppTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const logout = useAuthStore((s) => s.logout);
  const userInfo = useAuthStore((s) => s.userInfo);

  const handleLogout = async (): Promise<void> => {
    await logout();
    router.replace('/(auth)/login');
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.semantic.background }]}
      contentContainerStyle={styles.content}
    >
      {/* 用户信息 */}
      <View style={[styles.card, { backgroundColor: theme.colors.semantic.surface }]}>
        <Text style={[styles.label, { color: theme.colors.semantic.textSecondary }]}>用户名</Text>
        <Text style={[styles.value, { color: theme.colors.semantic.textPrimary }]}>
          {userInfo?.name ?? '-'}
        </Text>
      </View>

      {/* 退出登录 */}
      <TouchableOpacity
        style={[styles.logoutBtn, { backgroundColor: theme.colors.error }]}
        onPress={handleLogout}
      >
        <Text style={styles.logoutText}>{t('common.logout')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  card: {
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    marginBottom: 4,
  },
  value: {
    fontSize: 16,
    fontWeight: '500',
  },
  logoutBtn: {
    height: 48,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
  },
  logoutText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});
