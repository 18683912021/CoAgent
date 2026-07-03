import { Tabs } from 'expo-router';
import { useAppTheme } from '@design-system/theme';

/**
 * Tab 路由组 — 首页、用户中心、设置
 */
export default function TabLayout(): React.ReactElement {
  const theme = useAppTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.semantic.textTertiary,
        tabBarStyle: {
          backgroundColor: theme.colors.semantic.surface,
          borderTopColor: theme.colors.semantic.border,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: '首页',
          tabBarIcon: ({ color }) => null, // TODO: 接入 Icon 组件
        }}
      />
      <Tabs.Screen
        name="user-center"
        options={{
          title: '我的',
          tabBarIcon: ({ color }) => null,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '设置',
          tabBarIcon: ({ color }) => null,
        }}
      />
    </Tabs>
  );
}
