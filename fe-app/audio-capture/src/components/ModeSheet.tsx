import React, {useEffect, useRef} from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type {LLMMode} from '../hooks/useAudioCaptureController';
import {useTheme, space, radius, type} from '../theme';

interface Props {
  visible: boolean;
  onSelect: (mode: LLMMode) => void;
  onDismiss: () => void;
  dark: boolean;
}

interface ModeOption {
  mode: LLMMode;
  label: string;
  desc: string;
  icon: string;
  color: string;
}

const MODES: ModeOption[] = [
  {mode: 'brief', label: '精简', desc: '直击要点，≤200字', icon: '⚡', color: '#10B981'},
  {mode: 'normal', label: '普通', desc: '完整回答，≤500字', icon: '💡', color: '#6366F1'},
  {mode: 'detailed', label: '详细', desc: '深入展开技术细节', icon: '📖', color: '#8B5CF6'},
];

const {height: SCREEN_HEIGHT} = Dimensions.get('window');

export default function ModeSheet({visible, onSelect, onDismiss, dark}: Props) {
  const t = useTheme(dark);
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          damping: 22,
          stiffness: 220,
          mass: 0.8,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 280,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: SCREEN_HEIGHT,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, slideAnim, backdropAnim]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onDismiss}
      statusBarTranslucent>
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, {opacity: backdropAnim}]}>
        <Pressable style={styles.backdropPressable} onPress={onDismiss} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: t.bgSurface,
            ...t.shadowLg,
            transform: [{translateY: slideAnim}],
          },
        ]}>
        {/* Handle */}
        <View style={styles.handleBar}>
          <View style={[styles.handle, {backgroundColor: t.dividerStrong}]} />
        </View>

        {/* Title */}
        <Text style={[styles.title, {color: t.textPrimary}]}>选择回答模式</Text>
        <Text style={[styles.subtitle, {color: t.textTertiary}]}>
          点击对话气泡选择 AI 回答风格
        </Text>

        {/* Mode cards */}
        <View style={styles.cardRow}>
          {MODES.map(opt => {
            const isAccent = opt.color;
            return (
              <Pressable
                key={opt.mode}
                style={({pressed}) => [
                  styles.modeCard,
                  {
                    backgroundColor: t.bg,
                    borderColor: isAccent + '40',
                    borderWidth: 2,
                  },
                  pressed && {
                    backgroundColor: isAccent + '12',
                    borderColor: isAccent,
                    transform: [{scale: 0.97}],
                  },
                ]}
                onPress={() => onSelect(opt.mode)}>
                {/* Icon circle */}
                <View
                  style={[
                    styles.modeIconWrap,
                    {backgroundColor: isAccent + '18'},
                  ]}>
                  <Text style={styles.modeIcon}>{opt.icon}</Text>
                </View>

                {/* Label */}
                <Text style={[styles.modeLabel, {color: t.textPrimary}]}>
                  {opt.label}
                </Text>
                <Text style={[styles.modeDesc, {color: t.textTertiary}]}>
                  {opt.desc}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Cancel */}
        <Pressable
          style={({pressed}) => [
            styles.cancelBtn,
            {backgroundColor: t.divider},
            pressed && {opacity: 0.7},
          ]}
          onPress={onDismiss}>
          <Text style={[styles.cancelText, {color: t.textSecondary}]}>取消</Text>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  backdropPressable: {flex: 1},

  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.xl,
    paddingBottom: 36,
    paddingTop: space.sm,
  },

  handleBar: {
    alignItems: 'center',
    marginBottom: space.lg,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 2.5,
  },

  title: {
    ...type.heading,
    textAlign: 'center',
    marginBottom: space.xs,
  },
  subtitle: {
    ...type.bodySm,
    textAlign: 'center',
    marginBottom: space.xl,
  },

  // Mode cards
  cardRow: {
    flexDirection: 'row',
    gap: space.sm,
    marginBottom: space.lg,
  },
  modeCard: {
    flex: 1,
    borderRadius: radius.lg,
    paddingVertical: space.lg,
    paddingHorizontal: space.sm,
    alignItems: 'center',
  },

  modeIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: space.sm,
  },
  modeIcon: {fontSize: 22},

  modeLabel: {
    ...type.body,
    fontWeight: '700',
    marginBottom: 2,
  },
  modeDesc: {
    ...type.caption,
    textAlign: 'center',
  },

  // Cancel
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 13,
    borderRadius: radius.md,
  },
  cancelText: {
    ...type.body,
    fontWeight: '600',
  },
});
