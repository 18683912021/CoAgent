/**
 * TabNavigator — 轻量底部 Tab 导航
 *
 * 零原生依赖，纯 JS 实现。
 * 所有 Tab 页面保持挂载（display: none），确保面试页 WebSocket 不中断。
 */

import React, {useCallback, useState} from 'react';
import {Platform, Pressable, StyleSheet, Text, View, useColorScheme} from 'react-native';

import InterviewScreen from '../InterviewScreen';
import KnowledgeScreen from '../screens/KnowledgeScreen';
import ProfileScreen from '../screens/ProfileScreen';
import {useTheme, space, radius, type} from '../theme';

// ── Tab 配置 ──
interface TabDef {
  key: string;
  label: string;
  icon: string;
  screen: React.ComponentType;
}

const TABS: readonly TabDef[] = [
  {key: 'interview',  label: '面试',   icon: '🎯', screen: InterviewScreen},
  {key: 'knowledge', label: '知识库', icon: '📚', screen: KnowledgeScreen},
  {key: 'profile',   label: '我的',   icon: '👤', screen: ProfileScreen},
];

export default function TabNavigator(): React.JSX.Element {
  const [activeKey, setActiveKey] = useState(TABS[0]!.key);
  const dark = useColorScheme() === 'dark';
  const t = useTheme(dark);

  const onTabPress = useCallback((key: string) => setActiveKey(key), []);

  return (
    <View style={styles.root}>
      {/* ── Screen Area ── */}
      {TABS.map(tab => (
        <View
          key={tab.key}
          style={tab.key === activeKey ? styles.screenVisible : styles.screenHidden}>
          <tab.screen />
        </View>
      ))}

      {/* ── Bottom Tab Bar ── */}
      <View style={[styles.bar, {backgroundColor: t.bgSurface, borderTopColor: t.divider}, t.shadowMd]}>
        {TABS.map(tab => {
          const active = tab.key === activeKey;
          return (
            <Pressable
              key={tab.key}
              style={styles.tab}
              onPress={() => onTabPress(tab.key)}
              android_ripple={{color: t.accent + '20', borderless: false}}>
              {/* Active indicator bar */}
              {active && <View style={[styles.indicator, {backgroundColor: t.accent}]} />}
              <Text style={[styles.tabIcon, active && styles.tabIconActive]}>
                {tab.icon}
              </Text>
              <Text
                style={[
                  styles.tabLabel,
                  {color: active ? t.accent : t.textTertiary},
                ]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},

  // Screen visibility (keep-all for WebSocket persistence)
  screenVisible: {flex: 1},
  screenHidden: {flex: 0, height: 0, overflow: 'hidden'},

  // Tab Bar
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: Platform.OS === 'android' ? 6 : 20,
    paddingTop: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    overflow: 'hidden',
  },
  indicator: {
    position: 'absolute',
    top: 0,
    width: 24,
    height: 3,
    borderRadius: 1.5,
  },
  tabIcon: {
    fontSize: 22,
    opacity: 0.45,
  },
  tabIconActive: {
    opacity: 1,
  },
  tabLabel: {
    ...type.caption,
    fontWeight: '700',
    marginTop: 2,
  },
});
