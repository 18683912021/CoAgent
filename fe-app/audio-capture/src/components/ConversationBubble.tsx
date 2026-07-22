import React, {useEffect, useRef, useState} from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import type {ConversationBubbleStatus, LLMMode} from '../hooks/useAudioCaptureController';
import {useTheme, space, radius, type} from '../theme';

interface Props {
  role: 'interviewer' | 'user' | 'ai';
  text: string;
  status: ConversationBubbleStatus;
  mode?: LLMMode;
  timestamp: number;
  onPress?: () => void;
  onRetry?: () => void;
  dark: boolean;
}

const TYPING_INTERVAL_MS = 20;
const MODE_LABELS: Record<LLMMode, string> = {brief: '精简', normal: '普通', detailed: '详细'};

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) { return '刚刚'; }
  const sec = Math.floor(diff / 1000);
  if (sec < 5) { return '刚刚'; }
  if (sec < 60) { return `${sec}秒前`; }
  const min = Math.floor(sec / 60);
  if (min < 60) { return `${min}分钟前`; }
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export default function ConversationBubble({
  role,
  text,
  status,
  mode,
  timestamp,
  onPress,
  onRetry,
  dark,
}: Props) {
  const t = useTheme(dark);
  const isInterviewer = role === 'interviewer';
  const isUser = role === 'user';
  const isAI = role === 'ai';
  const clickable = !isAI && onPress != null;

  const [visibleLen, setVisibleLen] = useState(
    !isAI || status === 'done' || status === 'error' ? text.length : 0,
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pressScale = useRef(new Animated.Value(1)).current;

  // ── Typing animation ──
  useEffect(() => {
    if (!isAI || status === 'done' || status === 'error') {
      setVisibleLen(text.length);
      return;
    }
    if (status === 'loading') {
      setVisibleLen(0);
      return;
    }
    if (visibleLen < text.length) {
      intervalRef.current = setInterval(() => {
        setVisibleLen(prev => {
          if (prev >= text.length) {
            if (intervalRef.current) { clearInterval(intervalRef.current); }
            return prev;
          }
          return prev + 1;
        });
      }, TYPING_INTERVAL_MS);
    }
    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); }
    };
  }, [status, text, isAI, visibleLen]);

  const showLoading = status === 'loading';
  const showError = status === 'error';
  const partialText = text.slice(0, visibleLen);
  const isTyping = isAI && status === 'streaming' && visibleLen < text.length;

  // ── Press animation ──
  const handlePressIn = () => {
    if (!clickable) { return; }
    Animated.spring(pressScale, {toValue: 0.97, useNativeDriver: true, damping: 20, stiffness: 400}).start();
  };
  const handlePressOut = () => {
    if (!clickable) { return; }
    Animated.spring(pressScale, {toValue: 1, useNativeDriver: true, damping: 15, stiffness: 300}).start();
  };

  // ── Bubble style ──
  let bubbleBg: string;
  let bubbleBorder: string;
  let textColor: string;
  let avatar: string;
  let label: string;
  let labelColor: string;

  if (isInterviewer) {
    bubbleBg = t.bubbleInterviewer;
    bubbleBorder = t.divider;
    textColor = t.textPrimary;
    avatar = '🎙️';
    label = '面试官';
    labelColor = t.textTertiary;
  } else if (isUser) {
    bubbleBg = t.bubbleUser;
    bubbleBorder = t.bubbleUserBorder;
    textColor = '#14532D';
    avatar = '👤';
    label = '我';
    labelColor = '#166534';
  } else {
    bubbleBg = t.bubbleAI;
    bubbleBorder = t.bubbleAIBorder;
    textColor = t.textPrimary;
    avatar = '🤖';
    label = 'AI 建议';
    labelColor = t.accent;
  }

  const content = (
    <View style={[styles.rowContent, isUser && styles.rowContentRight]}>
      {/* Avatar */}
      <View style={[styles.avatar, {backgroundColor: bubbleBg, borderColor: bubbleBorder}]}>
        <Text style={styles.avatarText}>{avatar}</Text>
      </View>

      {/* Bubble body */}
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: bubbleBg,
            borderColor: isAI ? bubbleBorder : 'transparent',
            borderWidth: isAI ? 1.5 : 0,
            borderStyle: isAI ? 'dashed' : 'solid',
          },
          isInterviewer && styles.bubbleLeft,
          isUser && styles.bubbleRight,
          isAI && styles.bubbleLeft,
          showError && {borderColor: t.danger, borderStyle: 'dashed'},
          t.shadowSm,
        ]}>
        {/* Label row */}
        <View style={styles.labelRow}>
          <Text style={[styles.label, {color: labelColor}]}>{label}</Text>
          {isAI && mode && (
            <View style={[styles.modeBadge, {backgroundColor: t.accent}]}>
              <Text style={styles.modeBadgeText}>{MODE_LABELS[mode]}</Text>
            </View>
          )}
          <Text style={[styles.timestamp, {color: t.textTertiary}]}>
            {relativeTime(timestamp)}
          </Text>
        </View>

        {/* Content */}
        {showLoading ? (
          <LoadingDots color={t.accent} />
        ) : showError ? (
          <View style={styles.errorWrap}>
            <Text style={[styles.errorText, {color: t.danger}]}>生成失败，请重试</Text>
            {onRetry && (
              <TouchableOpacity
                onPress={onRetry}
                style={[styles.retryBtn, {backgroundColor: t.danger}]}
                activeOpacity={0.7}>
                <Text style={styles.retryBtnText}>↻ 重新生成</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <Text style={[styles.text, {color: textColor}]}>
            {partialText}
            {isTyping ? <Text style={[styles.cursor, {color: t.accent}]}>|</Text> : null}
          </Text>
        )}
      </View>
    </View>
  );

  const alignmentStyle = isUser ? styles.rowRight : styles.rowLeft;

  if (clickable) {
    return (
      <Animated.View style={[styles.row, alignmentStyle, {transform: [{scale: pressScale}]}]}>
        <TouchableOpacity
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          activeOpacity={0.85}
          style={styles.touchableArea}>
          {content}
        </TouchableOpacity>
      </Animated.View>
    );
  }

  return (
    <View style={[styles.row, alignmentStyle]}>
      {content}
    </View>
  );
}

// ── Loading Dots ──
function LoadingDots({color}: {color: string}) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % 3), 300);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={styles.loadingRow}>
      {[0, 1, 2].map(i => (
        <AnimatedDot key={i} active={frame === i} color={color} index={i} />
      ))}
    </View>
  );
}

function AnimatedDot({active, color, index}: {active: boolean; color: string; index: number}) {
  const anim = useRef(new Animated.Value(active ? 1 : 0.4)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: active ? 1 : 0.4,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [active, anim]);

  return (
    <Animated.View
      style={[
        styles.dot,
        {
          backgroundColor: color,
          opacity: anim,
          transform: [{scale: anim}],
        },
      ]}
    />
  );
}

// ── Styles ──
const styles = StyleSheet.create({
  row: {
    paddingHorizontal: space.md,
    marginBottom: 6,
  },
  rowLeft: {alignItems: 'flex-start'},
  rowRight: {alignItems: 'flex-end'},
  touchableArea: {maxWidth: '90%'},

  rowContent: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    maxWidth: '90%',
  },
  rowContentRight: {
    flexDirection: 'row-reverse',
  },

  // Avatar
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    marginBottom: 2,
  },
  avatarText: {fontSize: 16},

  // Bubble
  bubble: {
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    flexShrink: 1,
  },
  bubbleLeft: {
    borderBottomLeftRadius: radius.sm,
  },
  bubbleRight: {
    borderBottomRightRadius: radius.sm,
  },

  // Label row
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
    gap: 6,
  },
  label: {
    ...type.caption,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  timestamp: {
    ...type.caption,
    marginLeft: 'auto',
  },
  modeBadge: {
    borderRadius: radius.sm - 2,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
  },
  modeBadgeText: {
    fontSize: 10,
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // Text
  text: {
    ...type.body,
    letterSpacing: 0.2,
  },
  cursor: {
    fontWeight: '300',
  },

  // Loading
  loadingRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 2,
    gap: 5,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // Error
  errorWrap: {
    gap: space.sm,
  },
  errorText: {
    ...type.bodySm,
    fontWeight: '600',
  },
  retryBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  retryBtnText: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
