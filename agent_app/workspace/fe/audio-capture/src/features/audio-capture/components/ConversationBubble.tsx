import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import type {ConversationBubbleStatus, LLMMode} from '../hooks/useAudioCaptureController';

interface Props {
  role: 'interviewer' | 'user' | 'ai';
  text: string;
  status: ConversationBubbleStatus;
  mode?: LLMMode;
  timestamp: number;
  onPress?: () => void;
  onRetry?: () => void;
}

const TYPING_INTERVAL_MS = 25;
const MODE_LABELS: Record<LLMMode, string> = {brief: '精简', normal: '普通', detailed: '详细'};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export default function ConversationBubble({role, text, status, mode, timestamp, onPress, onRetry}: Props) {
  const isInterviewer = role === 'interviewer';
  const isUser = role === 'user';
  const isAI = role === 'ai';

  const [visibleLen, setVisibleLen] = useState(
    !isAI || status === 'done' || status === 'error' ? text.length : 0,
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isAI || status === 'done' || status === 'error') {
      setVisibleLen(text.length);
      return;
    }
    if (status === 'loading') {
      setVisibleLen(0);
      return;
    }
    // streaming typewriter
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
  const clickable = !isAI && onPress != null;

  const content = (
    <View style={[
      styles.bubble,
      isInterviewer && styles.bubbleInterviewer,
      isUser && styles.bubbleUser,
      isAI && styles.bubbleAI,
      showError && styles.bubbleError,
    ]}>
      {/* Label row */}
      <View style={styles.labelRow}>
        <Text style={[
          styles.label,
          isInterviewer && styles.labelInterviewer,
          isUser && styles.labelUser,
          isAI && styles.labelAI,
        ]}>
          {isInterviewer ? '🎙️ 面试官' : isUser ? '👤 我' : '🤖 AI 建议'}
        </Text>
        {isAI && mode && (
          <View style={styles.modeBadge}>
            <Text style={styles.modeBadgeText}>{MODE_LABELS[mode]}</Text>
          </View>
        )}
      </View>

      {/* Content */}
      {showLoading ? (
        <LoadingDots />
      ) : showError ? (
        <View>
          <Text style={styles.errorText}>生成失败</Text>
          {onRetry && (
            <TouchableOpacity onPress={onRetry} style={styles.retryBtn}>
              <Text style={styles.retryBtnText}>↻ 重试</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <Text style={[
          styles.text,
          isInterviewer && styles.textInterviewer,
          isUser && styles.textUser,
          isAI && styles.textAI,
        ]}>
          {partialText}
          {isTyping ? <Text style={styles.cursor}>|</Text> : null}
        </Text>
      )}

      {/* Timestamp */}
      <Text style={styles.timestamp}>{formatTime(timestamp)}</Text>
    </View>
  );

  const alignmentStyle = isUser ? styles.rowRight : styles.rowLeft;

  if (clickable) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={[styles.row, alignmentStyle]}>
        {content}
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.row, alignmentStyle]}>
      {content}
    </View>
  );
}

function LoadingDots() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % 3), 350);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={styles.loadingRow}>
      {[0, 1, 2].map(i => (
        <View key={i} style={[styles.dot, {opacity: frame === i ? 1 : 0.3}]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Layout ──
  row: {paddingHorizontal: 12, marginBottom: 8},
  rowLeft: {alignItems: 'flex-start'},
  rowRight: {alignItems: 'flex-end'},

  // ── Bubble base ──
  bubble: {
    maxWidth: '85%',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },

  // ── Interviewer: left gray ──
  bubbleInterviewer: {
    backgroundColor: '#F0F0F0',
    borderBottomLeftRadius: 4,
  },

  // ── User: right green ──
  bubbleUser: {
    backgroundColor: '#95EC69',
    borderBottomRightRadius: 4,
  },

  // ── AI: left blue dashed border ──
  bubbleAI: {
    backgroundColor: '#EBF5FB',
    borderWidth: 1.5,
    borderColor: '#85C1E9',
    borderStyle: 'dashed',
    borderBottomLeftRadius: 4,
  },

  // ── Error ──
  bubbleError: {
    borderColor: '#E74C3C',
    borderWidth: 1,
  },

  // ── Label row ──
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
  },
  labelInterviewer: {color: '#7F8C8D'},
  labelUser: {color: '#1E8449'},
  labelAI: {color: '#2980B9'},

  // ── Mode badge ──
  modeBadge: {
    marginLeft: 6,
    backgroundColor: '#2980B9',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  modeBadgeText: {
    fontSize: 10,
    color: '#FFFFFF',
    fontWeight: '600',
  },

  // ── Text ──
  text: {
    fontSize: 15,
    lineHeight: 21,
  },
  textInterviewer: {color: '#2C3E50'},
  textUser: {color: '#1E8449'},
  textAI: {color: '#1A5276'},
  cursor: {color: '#2980B9', fontWeight: '300'},

  // ── Timestamp ──
  timestamp: {
    fontSize: 10,
    color: '#95A5A6',
    marginTop: 4,
    textAlign: 'right',
  },

  // ── Loading ──
  loadingRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2980B9',
  },

  // ── Error ──
  errorText: {
    fontSize: 14,
    color: '#E74C3C',
    marginBottom: 6,
  },
  retryBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: '#E74C3C',
    borderRadius: 6,
  },
  retryBtnText: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
