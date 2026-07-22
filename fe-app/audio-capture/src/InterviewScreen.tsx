import React, {useCallback, useEffect, useMemo, useRef} from 'react';
import {
  Animated,
  FlatList,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {
  ConversationMessage,
  useAudioCaptureController,
} from './hooks/useAudioCaptureController';
import ConversationBubble from './components/ConversationBubble';
import ModeSheet from './components/ModeSheet';
import SeparatorLine from './components/SeparatorLine';
import {useTheme, space, radius} from './theme';

// ── Display item for FlatList (bubble or separator) ──
type DisplayItem =
  | {type: 'bubble'; message: ConversationMessage}
  | {type: 'separator'; id: string};

// ── Pulsing Dot Component ──
function PulsingDot({color}: {color: string}) {
  const anim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {toValue: 0.3, duration: 800, useNativeDriver: true}),
        Animated.timing(anim, {toValue: 1, duration: 800, useNativeDriver: true}),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [anim]);

  return (
    <Animated.View
      style={[
        styles.pulseDot,
        {backgroundColor: color, opacity: anim, transform: [{scale: anim}]},
      ]}
    />
  );
}

// ── Mic Level Bar Component ──
function MicLevelBar({level, dark}: {level: number; dark: boolean}) {
  const t = useTheme(dark);
  const barCount = 5;
  const activeBars = Math.max(1, Math.round(level * barCount));

  return (
    <View style={styles.levelBarRow}>
      {Array.from({length: barCount}).map((_, i) => {
        const isActive = i < activeBars;
        const height = 4 + (i + 1) * 3;
        return (
          <View
            key={i}
            style={[
              styles.levelBar,
              {
                height,
                backgroundColor: isActive
                  ? i < 3
                    ? t.success
                    : t.warning
                  : t.divider,
                borderRadius: 2,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

// ── Screen ──
export default function InterviewScreen(): React.JSX.Element {
  const controller = useAudioCaptureController();
  const {state} = controller;
  const dark = useColorScheme() === 'dark';
  const t = useTheme(dark);
  const flatListRef = useRef<FlatList<DisplayItem>>(null);

  const active = state.captureState === 'capturing';
  const connecting = state.streamState === 'connecting';
  const streamReady = state.streamState === 'ready';
  const conversation = state.conversation;
  const isEmpty = conversation.length === 0;
  const micLevel = state.levels?.mic ?? 0;

  // ── Build display list with 3s separators ──
  const displayItems: DisplayItem[] = useMemo(() => {
    const items: DisplayItem[] = [];
    for (let i = 0; i < conversation.length; i++) {
      const msg = conversation[i]!;
      if (i > 0) {
        const prev = conversation[i - 1]!;
        const sameRole = prev.role === msg.role;
        const isTranscription = msg.role === 'interviewer' || msg.role === 'user';
        const isPrevTranscription =
          prev.role === 'interviewer' || prev.role === 'user';
        if (sameRole && isTranscription && isPrevTranscription) {
          const gap = msg.timestamp - prev.timestamp;
          if (gap > 3000) {
            items.push({type: 'separator', id: `sep-${prev.id}-${msg.id}`});
          }
        }
      }
      items.push({type: 'bubble', message: msg});
    }
    return items;
  }, [conversation]);

  const scrollToEnd = useCallback(() => {
    setTimeout(() => flatListRef.current?.scrollToEnd({animated: true}), 100);
  }, []);

  const onContentSizeChange = useCallback(() => scrollToEnd(), [scrollToEnd]);

  const renderItem = useCallback(
    ({item}: {item: DisplayItem}) => {
      if (item.type === 'separator') {
        return <SeparatorLine dark={dark} />;
      }
      const msg = item.message;
      return (
        <ConversationBubble
          role={msg.role}
          text={msg.text}
          status={msg.status}
          mode={msg.mode}
          timestamp={msg.timestamp}
          onPress={
            msg.role !== 'ai'
              ? () => controller.selectBubble(msg.id)
              : undefined
          }
          onRetry={
            msg.role === 'ai' && msg.status === 'error'
              ? () => controller.retryLLM(msg.id)
              : undefined
          }
          dark={dark}
        />
      );
    },
    [controller, dark],
  );

  const keyExtractor = useCallback(
    (item: DisplayItem) =>
      item.type === 'separator' ? item.id : item.message.id,
    [],
  );

  // ── Status config ──
  const statusConfig = active
    ? {label: '面试中', color: t.success, dotColor: t.success}
    : connecting
      ? {label: '连接中', color: t.warning, dotColor: t.warning}
      : {label: '就绪', color: t.textTertiary, dotColor: t.textTertiary};

  return (
    <SafeAreaView
      style={[styles.safeArea, {backgroundColor: t.bg}]}
      edges={['top', 'left', 'right']}>
      <StatusBar
        barStyle={dark ? 'light-content' : 'dark-content'}
        backgroundColor={t.bgHeader}
      />

      {/* ── Header ── */}
      <View style={[styles.header, {backgroundColor: t.bgHeader, borderBottomColor: t.divider}]}>
        <View style={styles.headerLeft}>
          <View style={[styles.appIcon, {backgroundColor: t.accentLight}]}>
            <Text style={styles.appIconText}>🎯</Text>
          </View>
          <View>
            <Text style={[styles.headerTitle, {color: t.textPrimary}]}>
              面试助手
            </Text>
            <Text style={[styles.headerSubtitle, {color: t.textTertiary}]}>
              AI 实时辅助
            </Text>
          </View>
        </View>

        <View style={[styles.statusBadge, {backgroundColor: statusConfig.color + '18'}]}>
          {active && <PulsingDot color={statusConfig.dotColor} />}
          <View
            style={[
              styles.statusDotStatic,
              {backgroundColor: active ? undefined : statusConfig.dotColor},
              !active && {backgroundColor: statusConfig.dotColor},
            ]}
          />
          <Text style={[styles.statusBadgeText, {color: statusConfig.color}]}>
            {statusConfig.label}
          </Text>
        </View>
      </View>

      {/* ── Conversation area ── */}
      {isEmpty ? (
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIconWrap, {backgroundColor: t.accentLight}]}>
            <Text style={styles.emptyIcon}>🎤</Text>
          </View>
          <Text style={[styles.emptyTitle, {color: t.textPrimary}]}>
            等待面试官提问…
          </Text>
          <Text style={[styles.emptySubtitle, {color: t.textSecondary}]}>
            {!active
              ? '点击下方按钮开始面试'
              : !streamReady
                ? '正在连接服务器…'
                : '点击对话气泡获取 AI 回答建议'}
          </Text>
          {!active && (
            <View style={styles.emptyHints}>
              {['🎙️ 实时转写面试对话', '🤖 AI 智能生成建议', '🌐 中英双语支持'].map(
                (hint, i) => (
                  <View key={i} style={[styles.hintItem, {backgroundColor: t.bgSurface, ...t.shadowSm}]}>
                    <Text style={styles.hintText}>{hint}</Text>
                  </View>
                ),
              )}
            </View>
          )}
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={displayItems}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={onContentSizeChange}
          onLayout={scrollToEnd}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={<View style={{height: space.lg}} />}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {/* ── Bottom control bar ── */}
      <View
        style={[
          styles.controlBar,
          {
            backgroundColor: t.bgSurface,
            borderTopColor: t.divider,
            ...t.shadowMd,
          },
        ]}>
        {/* Stream info row */}
        {active && (
          <View style={styles.streamInfo}>
            <View style={styles.streamRow}>
              <PulsingDot color={streamReady ? t.success : t.warning} />
              <Text style={[styles.streamText, {color: t.textSecondary}]}>
                {streamReady ? '服务器已连接' : '正在连接服务器…'}
              </Text>
            </View>
            <MicLevelBar level={micLevel} dark={dark} />
            {state.error && (
              <Text
                style={[styles.errorHint, {color: t.danger}]}
                numberOfLines={1}>
                {state.error.message}
              </Text>
            )}
          </View>
        )}

        {/* Language selector */}
        <View style={styles.langRow}>
          <Text style={[styles.langLabel, {color: t.textSecondary}]}>
            回答语言
          </Text>
          <View style={styles.langGroup}>
            <TouchableOpacity
              style={[
                styles.langBtn,
                state.language === 'zh' && {
                  backgroundColor: t.accent,
                },
                state.language !== 'zh' && {
                  backgroundColor: t.divider,
                },
              ]}
              onPress={() => controller.setLanguage('zh')}
              activeOpacity={0.7}>
              <Text
                style={[
                  styles.langBtnText,
                  {
                    color: state.language === 'zh' ? t.textInverse : t.textSecondary,
                    fontWeight: state.language === 'zh' ? '700' : '500',
                  },
                ]}>
                中文
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.langBtn,
                state.language === 'en' && {
                  backgroundColor: t.accent,
                },
                state.language !== 'en' && {
                  backgroundColor: t.divider,
                },
              ]}
              onPress={() => controller.setLanguage('en')}
              activeOpacity={0.7}>
              <Text
                style={[
                  styles.langBtnText,
                  {
                    color: state.language === 'en' ? t.textInverse : t.textSecondary,
                    fontWeight: state.language === 'en' ? '700' : '500',
                  },
                ]}>
                English
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Capture button */}
        <TouchableOpacity
          style={[
            styles.captureBtn,
            {
              backgroundColor: active ? t.danger : t.accent,
              ...t.shadowMd,
            },
          ]}
          onPress={active ? controller.stop : controller.start}
          activeOpacity={0.85}>
          <Text style={styles.captureBtnIcon}>
            {active ? '⏹' : '🎙'}
          </Text>
          <Text style={styles.captureBtnText}>
            {active ? '结束面试' : '开始面试'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Mode selection bottom sheet ── */}
      <ModeSheet
        visible={state.showModeSheet}
        onSelect={controller.sendLLMQuery}
        onDismiss={controller.dismissSheet}
        dark={dark}
      />
    </SafeAreaView>
  );
}

// ── Styles ──
const styles = StyleSheet.create({
  safeArea: {flex: 1},

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  appIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  appIconText: {fontSize: 20},
  headerTitle: {fontSize: 17, fontWeight: '700'},
  headerSubtitle: {fontSize: 11, marginTop: 1},

  // Status badge
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.full,
    gap: 5,
  },
  statusBadgeText: {fontSize: 12, fontWeight: '700'},
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDotStatic: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },

  // Empty state
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 36,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: space.xl,
  },
  emptyIcon: {fontSize: 36},
  emptyTitle: {fontSize: 20, fontWeight: '700', marginBottom: space.sm, textAlign: 'center'},
  emptySubtitle: {fontSize: 14, textAlign: 'center', lineHeight: 21, marginBottom: space['2xl']},
  emptyHints: {width: '100%', gap: space.sm},
  hintItem: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
  },
  hintText: {fontSize: 14, color: '#6B7280'},

  // List
  listContent: {paddingTop: space.md, paddingBottom: space.xs},

  // Control bar
  controlBar: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  streamInfo: {
    marginBottom: space.sm,
    gap: 6,
  },
  streamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  streamText: {fontSize: 12},
  errorHint: {fontSize: 11, flexShrink: 1},

  // Mic level
  levelBarRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 20,
  },
  levelBar: {
    width: 4,
    borderRadius: 2,
  },

  // Language
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  langLabel: {fontSize: 13, fontWeight: '600'},
  langGroup: {
    flexDirection: 'row',
    gap: 6,
  },
  langBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.sm,
  },
  langBtnText: {fontSize: 13},

  // Source selector
  sourceRow: {flexDirection: 'row', gap: 8, marginBottom: 8},
  sourceBtn: {flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center', backgroundColor: '#e2e8f0'},
  sourceBtnText: {fontSize: 13, fontWeight: '700'},
  // Auth button
  authBtn: {paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center', marginBottom: 8},
  authBtnText: {fontSize: 13, fontWeight: '700'},
  authOk: {fontSize: 12, fontWeight: '700', textAlign: 'center', marginBottom: 8},

  // Capture button
  captureBtn: {
    borderRadius: radius.lg,
    paddingVertical: 15,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.sm,
  },
  captureBtnIcon: {fontSize: 18},
  captureBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
