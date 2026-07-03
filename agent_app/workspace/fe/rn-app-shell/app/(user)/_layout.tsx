import { Stack } from 'expo-router';

/**
 * User 路由组 — 用户中心子页面（编辑资料、账号安全、关于）
 */
export default function UserLayout(): React.ReactElement {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        animation: 'slide_from_right',
        headerBackTitle: '返回',
      }}
    >
      <Stack.Screen name="edit-profile" options={{ title: '编辑资料' }} />
      <Stack.Screen name="security" options={{ title: '账号安全' }} />
      <Stack.Screen name="about" options={{ title: '关于' }} />
    </Stack>
  );
}
