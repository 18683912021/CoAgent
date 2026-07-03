import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useAuthStore } from '@core/auth';
import { useAppTheme } from '@design-system/theme';
import { toast } from '@shared/components/Toast';
import { useTranslation } from 'react-i18next';

export default function LoginScreen(): React.ReactElement {
  const theme = useAppTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const login = useAuthStore((s) => s.login);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (): Promise<void> => {
    if (!username.trim() || !password.trim()) {
      toast.error('请输入用户名和密码');
      return;
    }

    setLoading(true);
    try {
      await login({ username: username.trim(), password });
      toast.success(t('auth.loginSuccess'));
      router.replace('/(tabs)/home');
    } catch (e) {
      const message = e instanceof Error ? e.message : t('auth.loginFailed');
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.colors.semantic.surface }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={[styles.title, { color: theme.colors.semantic.textPrimary }]}>
          {t('auth.login')}
        </Text>

        <TextInput
          style={[
            styles.input,
            {
              color: theme.colors.semantic.textPrimary,
              borderColor: theme.colors.semantic.border,
              backgroundColor: theme.colors.semantic.background,
            },
          ]}
          placeholder={t('auth.usernamePlaceholder')}
          placeholderTextColor={theme.colors.semantic.textTertiary}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TextInput
          style={[
            styles.input,
            {
              color: theme.colors.semantic.textPrimary,
              borderColor: theme.colors.semantic.border,
              backgroundColor: theme.colors.semantic.background,
            },
          ]}
          placeholder={t('auth.passwordPlaceholder')}
          placeholderTextColor={theme.colors.semantic.textTertiary}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity
          style={[styles.loginBtn, { backgroundColor: theme.colors.primary, opacity: loading ? 0.6 : 1 }]}
          onPress={handleLogin}
          disabled={loading}
        >
          <Text style={styles.loginBtnText}>{loading ? t('common.loading') : t('auth.login')}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 32,
    textAlign: 'center',
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    fontSize: 16,
    marginBottom: 16,
  },
  loginBtn: {
    height: 48,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  loginBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});
