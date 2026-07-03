import { Stack } from 'expo-router';

/**
 * Auth 路由组 — 登录、注册、忘记密码等
 */
export default function AuthLayout(): React.ReactElement {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_bottom',
      }}
    >
      <Stack.Screen name="login" />
    </Stack>
  );
}
