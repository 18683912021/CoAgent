/**
 * KnowledgeScreen — 知识库
 *
 * 后续规划：面试知识点浏览、搜索、收藏、分类管理
 * 当前为占位页面，保留架构扩展空间。
 */

import React from 'react';
import {StyleSheet, Text, View, useColorScheme} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {useTheme, space, radius} from '../theme';

export default function KnowledgeScreen(): React.JSX.Element {
  const dark = useColorScheme() === 'dark';
  const t = useTheme(dark);

  return (
    <SafeAreaView style={[styles.container, {backgroundColor: t.bg}]} edges={['top']}>
      <View style={styles.content}>
        <View style={[styles.iconWrap, {backgroundColor: t.accentLight}]}>
          <Text style={styles.icon}>📚</Text>
        </View>
        <Text style={[styles.title, {color: t.textPrimary}]}>知识库</Text>
        <Text style={[styles.subtitle, {color: t.textSecondary}]}>
          面试知识点整理、技术文档、常见考题
        </Text>
        <View style={[styles.hint, {backgroundColor: t.bgSurface, borderColor: t.divider}]}>
          <Text style={[styles.hintText, {color: t.textTertiary}]}>
            功能开发中，敬请期待
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1},
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 36,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: space.xl,
  },
  icon: {fontSize: 36},
  title: {fontSize: 20, fontWeight: '700', marginBottom: space.sm, textAlign: 'center'},
  subtitle: {fontSize: 14, textAlign: 'center', lineHeight: 21, marginBottom: space['2xl']},
  hint: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  hintText: {fontSize: 13},
});
