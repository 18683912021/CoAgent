import React, {useCallback, useMemo, useRef} from 'react';
import {
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

// ── Display list type ──
type DisplayItem =
  | {type: 'bubble'; message: ConversationMessage}
  | {type: 'separator'; id: string};

export default function InterviewScreen(): React.JSX.Element {
  const controller = useAudioCaptureController();
  const {state} = controller;
  const dark = useColorScheme() === 'dark';
  const flatListRef = useRef<FlatList<DisplayItem>>(null);

  const active = state.captureState === 'capturing';
  const connecting = state.streamState === 'connecting';
  const conversation = state.conversation;

  const background = dark ? '#0f172a' : '#f8fafc';
  const surface = dark ? '#1e293b' : '#ffffff';
  const textPrimary = dark ? '#f1f5f9' : '#0f172a';
  const textSecondary = dark ? '#94a3b8' : '#64748b';
  const accentBlue = '#2563eb';
  const accentRed = '#dc2626';

  // ── 3-second separator display list ──
  const displayItems: DisplayItem[] = useMemo(() => {
    const items: DisplayItem[] = [];
    for (let i = 0; i < conversation.length; i++) {
      const msg = conversation[i];
      if (i > 0) {
        const prev = conversation[i - 1];
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

  const scrollToEnd = useCallback(() => {
    setTimeout(() => flatListRef.current?.scrollToEnd({animated: true}), 100);
  }, []);

  const onContentSizeChange = useCallback(() => scrollToEnd(), [scrollToEnd]);

  const renderItem = useCallback(({item}: {item: DisplayItem}) => {
    if (item.type === 'separator') {
      return <SeparatorLine />;
    }
    const msg = item.message;
    return (
      <ConversationBubble
        role={msg.role}
        text={msg.text}
        status={msg.status}
        mode={msg.mode}
        timestamp={msg.timestamp}
        onPress={msg.role !== 'ai' ? () => controller.selectBubble(msg.id) : undefined}
        onRetry={msg.role === 'ai' && msg.status === 'error' ? () => controller.retryLLM(msg.id) : undefined}
      />
    );
  }, [controller]);

  const keyExtractor = useCallback((item: DisplayItem) =>
    item.type === 'separator' ? item.id : item.message.id,
  []);

  const isEmpty = conversation.length === 0;
  const streamReady = state.streamState === 'ready';

  return (
    <SafeAreaView style={[styles.safeArea, {backgroundColor: background}]} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} backgroundColor={background} />

      {/* Header */}
      <View style={[styles.header, {borderBottomColor: dark ? '#334155' : '#e2e8f0'}]}>
        <Text style={[styles.headerTitle, {color: textPrimary}]}>面试助手</Text>
        <View style={[styles.statusBadge, {backgroundColor: active ? '#16a34a' : connecting ? '#f59e0b' : '#94a3b8'}]}>
          <Text style={styles.statusBadgeText}>
            {active ? '采集中' : connecting ? '连接中' : '待机'}
          </Text>
        </View>
      </View>

      {/* Conversation area */}
      {isEmpty ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🎤</Text>
          <Text style={[styles.emptyTitle, {color: textPrimary}]}>等待面试官提问…</Text>
          <Text style={[styles.emptySubtitle, {color: textSecondary}]}>
            {!active
              ? '点击下方按钮开始采集音频'
              : !streamReady
                ? '正在连接服务器…'
                : '点击对话气泡获取 AI 回答建议'}
          </Text>
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
          ListFooterComponent={<View style={{height: 16}} />}
        />
      )}

      {/* Bottom control bar */}
      <View style={[styles.controlBar, {backgroundColor: surface, borderTopColor: dark ? '#334155' : '#e2e8f0'}]}>
        {active && (
          <View style={styles.streamInfo}>
            <View style={[styles.streamDot, {backgroundColor: streamReady ? '#16a34a' : '#f59e0b'}]} />
            <Text style={[styles.streamText, {color: textSecondary}]}>
              {streamReady ? '服务器已连接' : '等待服务器…'}
            </Text>
            {state.error && (
              <Text style={[styles.errorHint, {color: accentRed}]} numberOfLines={1}>
                {state.error.message}
              </Text>
            )}
          </View>
        )}

        <TouchableOpacity
          style={[styles.captureBtn, {backgroundColor: active ? accentRed : accentBlue}]}
          onPress={active ? controller.stop : controller.start}
          activeOpacity={0.8}>
          <Text style={styles.captureBtnText}>
            {active ? '⏹ 停止采集' : '🎙 开始采集'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Mode selection sheet */}
      <ModeSheet
        visible={state.showModeSheet}
        onSelect={controller.sendLLMQuery}
        onDismiss={controller.dismissSheet}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {flex: 1},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {fontSize: 18, fontWeight: '700'},
  statusBadge: {paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12},
  statusBadgeText: {fontSize: 12, fontWeight: '600', color: '#ffffff'},
  emptyContainer: {flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32},
  emptyIcon: {fontSize: 48, marginBottom: 16},
  emptyTitle: {fontSize: 18, fontWeight: '600', marginBottom: 8, textAlign: 'center'},
  emptySubtitle: {fontSize: 14, textAlign: 'center', lineHeight: 20},
  listContent: {paddingTop: 12, paddingBottom: 8},
  controlBar: {paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth},
  streamInfo: {flexDirection: 'row', alignItems: 'center', marginBottom: 8},
  streamDot: {width: 8, height: 8, borderRadius: 4, marginRight: 6},
  streamText: {fontSize: 12, marginRight: 8},
  errorHint: {fontSize: 11, flexShrink: 1},
  captureBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  captureBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
});
