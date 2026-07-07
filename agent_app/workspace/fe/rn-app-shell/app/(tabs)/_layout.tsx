import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
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
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'home' : 'home-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="user-center"
        options={{
          title: '我的',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'person' : 'person-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '设置',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'settings' : 'settings-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
