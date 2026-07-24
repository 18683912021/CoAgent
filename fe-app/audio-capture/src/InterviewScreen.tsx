import React, {useCallback, useEffect, useMemo, useRef} from 'react';
import {
  Animated,
  FlatList,
  Platform,
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
import SeparatorLine from './components/SeparatorLine';
import {useTheme, space, radius, type} from './theme';

// ── Display item for FlatList (bubble or separator) ──
type DisplayItem =
  | {type: 'bubble'; message: ConversationMessage}
  | {type: 'separator'; id: string};

// ── Pulsing Dot ──
function PulsingDot({color, size = 8}: {color: string; size?: number}) {
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
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity: anim,
        transform: [{scale: anim}],
      }}
    />
  );
}

// ── Mic Level Bars ──
function MicLevelBar({level, dark}: {level: number; dark: boolean}) {
  const t = useTheme(dark);
  const barCount = 7;
  const activeBars = Math.max(1, Math.round(level * barCount));
  return (
    <View style={premiumStyles.levelBarRow}>
      {Array.from({length: barCount}).map((_, i) => {
        const isActive = i < activeBars;
        const h = 3 + (i + 1) * 2.5;
        return (
          <View
            key={i}
            style={{
              width: 3,
              height: h,
              borderRadius: 1.5,
              backgroundColor: isActive ? (i < 4 ? t.success : t.warning) : t.divider,
            }}
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
  const isNearBottom = useRef(true); // 用户是否在底部（决定是否自动滚动）

  const active = state.captureState === 'capturing';
  const connecting = state.streamState === 'connecting';
  const streamReady = state.streamState === 'ready';
  const conversation = state.conversation;
  const isEmpty = conversation.length === 0;
  const micLevel = state.levels?.mic ?? 0;

  // ── Display list ──
  const displayItems: DisplayItem[] = useMemo(() => {
    const items: DisplayItem[] = [];
    for (let i = 0; i < conversation.length; i++) {
      const msg = conversation[i]!;
      if (i > 0) {
        const prev = conversation[i - 1]!;
        const sameRole = prev.role === msg.role;
        const isTranscription = msg.role === 'interviewer' || msg.role === 'user';
        const isPrevTranscription = prev.role === 'interviewer' || prev.role === 'user';
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

  const scrollToEnd = useCallback((force = false) => {
    if (!force && !isNearBottom.current) { return; }
    setTimeout(() => flatListRef.current?.scrollToEnd({animated: false}), 50);
  }, []);

  const onContentSizeChange = useCallback(() => scrollToEnd(), [scrollToEnd]);

  const onFlatListLayout = useCallback(() => scrollToEnd(true), [scrollToEnd]);

  const onScroll = useCallback((event: {nativeEvent: {contentOffset: {y: number}; contentSize: {height: number}; layoutMeasurement: {height: number}}}) => {
    const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
    const distToBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    isNearBottom.current = distToBottom < 50;
  }, []);

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
          timestamp={msg.timestamp}
          onPress={msg.role !== 'ai' ? () => controller.sendLLMQuery(msg.id) : undefined}
          onRetry={msg.role === 'ai' && msg.status === 'error' ? () => controller.retryLLM(msg.id) : undefined}
          dark={dark}
        />
      );
    },
    [controller, dark],
  );

  const keyExtractor = useCallback(
    (item: DisplayItem) => (item.type === 'separator' ? item.id : item.message.id),
    [],
  );

  // ── Status ──
  const statusConfig = active
    ? {label: '面试中', color: t.success, dot: true}
    : connecting
      ? {label: '连接中', color: t.warning, dot: true}
      : {label: '就绪', color: t.accent, dot: false};

  return (
    <SafeAreaView style={[premiumStyles.safe, {backgroundColor: t.bg}]} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />

      {/* ── Header ── */}
      <View style={[premiumStyles.header, {backgroundColor: t.bgHeader, borderBottomColor: t.divider}]}>
        <View style={premiumStyles.headerLeft}>
          <View style={[premiumStyles.appIcon, {backgroundColor: t.accentLight}]}>
            <Text style={premiumStyles.appIconText}>🎯</Text>
          </View>
          <View>
            <Text style={[premiumStyles.headerTitle, {color: t.textPrimary}]}>AI 面试助手</Text>
            <Text style={[premiumStyles.headerSub, {color: t.textTertiary}]}>实时转写 · AI 辅助</Text>
          </View>
        </View>
        <View style={[premiumStyles.statusBadge, {backgroundColor: statusConfig.color + '18'}]}>
          {statusConfig.dot && <PulsingDot color={statusConfig.color} size={7} />}
          <View style={[premiumStyles.statusDot, !statusConfig.dot && {backgroundColor: statusConfig.color}]} />
          <Text style={[premiumStyles.statusText, {color: statusConfig.color}]}>{statusConfig.label}</Text>
        </View>
      </View>

      {/* ── Body ── */}
      {isEmpty ? (
        <View style={premiumStyles.emptyWrap}>
          <View style={premiumStyles.emptyHero}>
            <View style={[premiumStyles.emptyIconWrap, {backgroundColor: t.accentLight}]}>
              <Text style={premiumStyles.emptyIcon}>🎤</Text>
            </View>
            <Text style={[premiumStyles.emptyTitle, {color: t.textPrimary}]}>准备开始面试</Text>
            <Text style={[premiumStyles.emptySub, {color: t.textSecondary}]}>
              {!active ? '点击下方按钮，AI 将实时转写对话并生成建议' : !streamReady ? '正在建立安全连接…' : '点击任意对话气泡，获取 AI 专业回答'}
            </Text>
          </View>

          {!active && (
            <View style={premiumStyles.featureCards}>
              {[
                {icon: '🎙️', title: '实时转写', desc: '双轨采集 · 毫秒级上屏'},
                {icon: '🤖', title: 'AI 建议', desc: '四维度深度面试分析'},
                {icon: '🌐', title: '双语支持', desc: '中文 · English 自由切换'},
              ].map((f, i) => (
                <View
                  key={i}
                  style={[premiumStyles.featureCard, {backgroundColor: t.bgSurface, borderColor: t.divider}, t.shadowSm]}>
                  <Text style={premiumStyles.featureIcon}>{f.icon}</Text>
                  <Text style={[premiumStyles.featureTitle, {color: t.textPrimary}]}>{f.title}</Text>
                  <Text style={[premiumStyles.featureDesc, {color: t.textTertiary}]}>{f.desc}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={displayItems}
          extraData={state.currentStreamingAIId}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={premiumStyles.listContent}
          onContentSizeChange={onContentSizeChange}
          onLayout={onFlatListLayout}
          onScroll={onScroll}
          scrollEventThrottle={100}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={<View style={{height: space.lg}} />}
          keyboardShouldPersistTaps="handled"
          maxToRenderPerBatch={5}
          updateCellsBatchingPeriod={30}
          windowSize={5}
          removeClippedSubviews={Platform.OS === 'android'}
        />
      )}

      {/* ── Bottom Control ── */}
      <View style={[premiumStyles.controlBar, {backgroundColor: t.bgSurface, borderTopColor: t.divider}, t.shadowMd]}>
        {/* Stream status */}
        {active && (
          <View style={premiumStyles.streamRow}>
            <View style={premiumStyles.streamLeft}>
              <PulsingDot color={streamReady ? t.success : t.warning} size={8} />
              <Text style={[premiumStyles.streamText, {color: t.textSecondary}]}>
                {streamReady ? '服务器已连接' : '正在连接…'}
              </Text>
            </View>
            <MicLevelBar level={micLevel} dark={dark} />
          </View>
        )}
        {state.error && (
          <Text style={[premiumStyles.errorHint, {color: t.danger}]} numberOfLines={1}>
            {state.error.message}
          </Text>
        )}

        {/* Language */}
        <View style={premiumStyles.langRow}>
          <Text style={[premiumStyles.langLabel, {color: t.textSecondary}]}>回答语言</Text>
          <View style={premiumStyles.langGroup}>
            {([
              {key: 'zh' as const, label: '中文'},
              {key: 'en' as const, label: 'English'},
            ]).map(l => {
              const selected = state.language === l.key;
              return (
                <TouchableOpacity
                  key={l.key}
                  style={[
                    premiumStyles.langBtn,
                    selected
                      ? {backgroundColor: t.accent, ...t.shadowSm}
                      : {backgroundColor: t.divider},
                  ]}
                  onPress={() => controller.setLanguage(l.key)}
                  activeOpacity={0.7}>
                  <Text
                    style={[
                      premiumStyles.langBtnText,
                      {color: selected ? '#FFF' : t.textSecondary},
                    ]}>
                    {l.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Capture Button */}
        <TouchableOpacity
          style={[
            premiumStyles.captureBtn,
            {backgroundColor: active ? t.danger : t.accent},
            t.shadowMd,
          ]}
          onPress={active ? controller.stop : controller.start}
          activeOpacity={0.85}>
          <Text style={premiumStyles.captureIcon}>{active ? '⏹' : '🎙'}</Text>
          <Text style={premiumStyles.captureLabel}>{active ? '结束面试' : '开始面试'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ── Premium Styles ──
const premiumStyles = StyleSheet.create({
  safe: {flex: 1},

  // ── Header ──
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {flexDirection: 'row', alignItems: 'center', gap: space.md},
  appIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  appIconText: {fontSize: 21},
  headerTitle: {fontSize: 16, fontWeight: '800', letterSpacing: -0.2},
  headerSub: {fontSize: 11, marginTop: 1},
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    gap: 6,
  },
  statusDot: {width: 7, height: 7, borderRadius: 3.5},
  statusText: {fontSize: 12, fontWeight: '700', letterSpacing: 0.3},

  // ── Empty State ──
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: space['2xl'],
  },
  emptyHero: {
    alignItems: 'center',
    marginBottom: space['3xl'],
  },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: space.xl,
  },
  emptyIcon: {fontSize: 40},
  emptyTitle: {
    ...type.title,
    marginBottom: space.sm,
  },
  emptySub: {
    ...type.bodySm,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },

  // ── Feature Cards ──
  featureCards: {
    flexDirection: 'row',
    gap: space.sm,
  },
  featureCard: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
    alignItems: 'center',
    gap: 4,
  },
  featureIcon: {fontSize: 22},
  featureTitle: {
    ...type.caption,
    fontWeight: '700',
    marginTop: 2,
  },
  featureDesc: {
    ...type.caption,
    textAlign: 'center',
    fontSize: 10,
  },

  // ── Conversation List ──
  listContent: {paddingTop: space.md, paddingBottom: space.xs},

  // ── Control Bar ──
  controlBar: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: Platform.OS === 'android' ? 22 : 28,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  streamRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.sm,
    paddingHorizontal: 2,
  },
  streamLeft: {flexDirection: 'row', alignItems: 'center', gap: 6},
  streamText: {...type.caption, fontWeight: '500'},
  errorHint: {...type.caption, marginBottom: space.sm, flexShrink: 1},
  levelBarRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 20,
  },

  // ── Language ──
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  langLabel: {...type.bodySm, fontWeight: '600'},
  langGroup: {flexDirection: 'row', gap: 8},
  langBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.full,
  },
  langBtnText: {...type.bodySm, fontWeight: '600'},

  // ── Capture Button ──
  captureBtn: {
    borderRadius: radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.sm,
  },
  captureIcon: {fontSize: 18},
  captureLabel: {fontSize: 16, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5},
});
