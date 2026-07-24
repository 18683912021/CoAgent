/**
 * ProfileScreen — 我的
 *
 * 页面结构：
 *   Header Card   —— 头像、用户名、会员等级、剩余时长
 *   Menu Sections —— 面试历史 / 面试语言 / 答案风格 / 简历上传
 */

import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {useTheme, space, radius, type} from '../theme';

// ── Types ──
interface MenuItem {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
}

// ── Mock Data（后续接入真实数据源） ──
const USER = {
  name: '前端开发者',
  avatar: '👨‍💻',
  membership: '高级会员',
  remainingSeconds: 23 * 3600 + 45 * 60 + 12, // 23:45:12
};

function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── Menu Row Component ──
function MenuRow({icon, label, value, onPress}: MenuItem) {
  const dark = useColorScheme() === 'dark';
  const t = useTheme(dark);

  return (
    <TouchableOpacity
      style={[styles.menuRow, {backgroundColor: t.bgSurface, borderColor: t.divider}]}
      activeOpacity={0.6}
      onPress={onPress}>
      <View style={styles.menuLeft}>
        <View style={[styles.menuIconWrap, {backgroundColor: t.accentLight}]}>
          <Text style={styles.menuIcon}>{icon}</Text>
        </View>
        <Text style={[styles.menuLabel, {color: t.textPrimary}]}>{label}</Text>
      </View>
      <View style={styles.menuRight}>
        {value != null && (
          <Text style={[styles.menuValue, {color: t.textSecondary}]}>{value}</Text>
        )}
        <Text style={[styles.menuChevron, {color: t.textTertiary}]}>›</Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Section Header ──
function SectionTitle({title}: {title: string}) {
  const dark = useColorScheme() === 'dark';
  const t = useTheme(dark);

  return (
    <Text style={[styles.sectionTitle, {color: t.textTertiary}]}>{title}</Text>
  );
}

// ── Screen ──
export default function ProfileScreen(): React.JSX.Element {
  const dark = useColorScheme() === 'dark';
  const t = useTheme(dark);

  const menuSections: {title: string; items: MenuItem[]}[] = [
    {
      title: '数据',
      items: [
        {icon: '📋', label: '面试历史', value: '12 次', onPress: () => {}},
      ],
    },
    {
      title: '偏好',
      items: [
        {icon: '🌐', label: '面试语言', value: '中文', onPress: () => {}},
        {icon: '✍️', label: '答案风格', value: '标准书面', onPress: () => {}},
        {icon: '📄', label: '简历上传', value: '未上传', onPress: () => {}},
      ],
    },
    {
      title: '系统',
      items: [
        {icon: '⚙️', label: '设置', onPress: () => {}},
      ],
    },
  ];

  return (
    <SafeAreaView style={[styles.container, {backgroundColor: t.bg}]} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>

        {/* ── Header Card ── */}
        <View style={[styles.headerCard, {backgroundColor: t.bgSurface}, t.shadowMd]}>
          {/* Avatar + Name */}
          <View style={styles.headerTop}>
            <View style={[styles.avatar, {backgroundColor: t.accentLight, borderColor: t.accent}]}>
              <Text style={styles.avatarText}>{USER.avatar}</Text>
            </View>
            <View style={styles.nameBlock}>
              <Text style={[styles.userName, {color: t.textPrimary}]}>{USER.name}</Text>
              <View style={[styles.membershipBadge, {backgroundColor: t.accent}]}>
                <Text style={styles.membershipText}>✨ {USER.membership}</Text>
              </View>
            </View>
          </View>

          {/* Divider + Time */}
          <View style={[styles.timeSection, {backgroundColor: t.accentLight, borderColor: t.accentSoft}]}>
            <View style={styles.timeLeft}>
              <Text style={[styles.timeLabel, {color: t.textSecondary}]}>剩余时长</Text>
              <Text style={[styles.timeValue, {color: t.accent}]}>
                {formatTime(USER.remainingSeconds)}
              </Text>
            </View>
            <View style={styles.timeMeta}>
              <Text style={[styles.timeMetaText, {color: t.textTertiary}]}>
                有效期至 2026-08-24
              </Text>
              <TouchableOpacity activeOpacity={0.6}>
                <Text style={[styles.renewBtn, {color: t.accent}]}>续费 ›</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ── Menu Sections ── */}
        {menuSections.map(section => (
          <View key={section.title} style={styles.section}>
            <SectionTitle title={section.title} />
            <View style={[styles.menuCard, {backgroundColor: t.bgSurface}, t.shadowSm]}>
              {section.items.map((item, idx) => (
                <React.Fragment key={item.label}>
                  <MenuRow {...item} />
                  {idx < section.items.length - 1 && (
                    <View style={[styles.menuDivider, {backgroundColor: t.divider}]} />
                  )}
                </React.Fragment>
              ))}
            </View>
          </View>
        ))}

        {/* ── Footer ── */}
        <Text style={[styles.footer, {color: t.textTertiary}]}>
          AI面试助手 v1.0.0
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ──
const styles = StyleSheet.create({
  container: {flex: 1},
  scrollContent: {paddingBottom: 40},

  // ── Header Card ──
  headerCard: {
    marginHorizontal: space.lg,
    marginTop: space.md,
    borderRadius: radius.xl,
    padding: space.xl,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2.5,
  },
  avatarText: {fontSize: 30},
  nameBlock: {flex: 1, gap: 4},
  userName: {
    ...type.title,
    letterSpacing: 0.3,
  },
  membershipBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  membershipText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // ── Time Section ──
  timeSection: {
    marginTop: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timeLeft: {gap: 2},
  timeLabel: {...type.caption, fontWeight: '500'},
  timeValue: {
    fontSize: 28,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1.5,
  },
  timeMeta: {
    alignItems: 'flex-end',
    gap: 6,
  },
  timeMetaText: {...type.caption},
  renewBtn: {
    ...type.caption,
    fontWeight: '700',
  },

  // ── Menu Sections ──
  section: {marginTop: space['2xl'], paddingHorizontal: space.lg},
  sectionTitle: {
    ...type.caption,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: space.sm,
    marginLeft: space.xs,
  },
  menuCard: {
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: 14,
  },
  menuLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  menuIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuIcon: {fontSize: 17},
  menuLabel: {
    ...type.body,
    fontWeight: '500',
  },
  menuRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  menuValue: {
    ...type.bodySm,
  },
  menuChevron: {
    fontSize: 18,
    fontWeight: '300',
    marginLeft: 2,
    lineHeight: 22,
    includeFontPadding: false,
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: space.lg + 36 + space.md, // align with label
    marginRight: space.lg,
  },

  // ── Footer ──
  footer: {
    ...type.caption,
    textAlign: 'center',
    marginTop: space['3xl'],
    marginBottom: space.lg,
  },
});
