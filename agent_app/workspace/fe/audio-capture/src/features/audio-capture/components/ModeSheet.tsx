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

interface Props {
  visible: boolean;
  onSelect: (mode: LLMMode) => void;
  onDismiss: () => void;
}

interface ModeOption {
  mode: LLMMode;
  label: string;
  desc: string;
  color: string;
}

const MODES: ModeOption[] = [
  {mode: 'brief', label: '精简', desc: '直击要点 ≤200字', color: '#27AE60'},
  {mode: 'normal', label: '普通', desc: '完整回答 ≤500字', color: '#2980B9'},
  {mode: 'detailed', label: '详细', desc: '深入展开技术细节', color: '#8E44AD'},
];

const {height: SCREEN_HEIGHT} = Dimensions.get('window');

export default function ModeSheet({visible, onSelect, onDismiss}: Props) {
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          damping: 20,
          stiffness: 200,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: SCREEN_HEIGHT,
          duration: 200,
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
        style={[styles.sheet, {transform: [{translateY: slideAnim}]}]}>
        {/* Handle */}
        <View style={styles.handleBar}>
          <View style={styles.handle} />
        </View>

        <Text style={styles.title}>选择回答模式</Text>
        <Text style={styles.subtitle}>点击气泡中的文字，选择 AI 回答风格</Text>

        <View style={styles.buttonRow}>
          {MODES.map(opt => (
            <Pressable
              key={opt.mode}
              style={({pressed}) => [
                styles.modeBtn,
                {borderColor: opt.color},
                pressed && {backgroundColor: opt.color + '15'},
              ]}
              onPress={() => onSelect(opt.mode)}>
              <Text style={[styles.modeLabel, {color: opt.color}]}>{opt.label}</Text>
              <Text style={styles.modeDesc}>{opt.desc}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={styles.cancelBtn} onPress={onDismiss}>
          <Text style={styles.cancelText}>取消</Text>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  backdropPressable: {
    flex: 1,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 34,
    paddingTop: 8,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: -3},
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 20,
  },
  handleBar: {
    alignItems: 'center',
    marginBottom: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D5D8DC',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2C3E50',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#95A5A6',
    textAlign: 'center',
    marginBottom: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  modeBtn: {
    flex: 1,
    borderWidth: 2,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  modeLabel: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  modeDesc: {
    fontSize: 11,
    color: '#7F8C8D',
    textAlign: 'center',
    lineHeight: 15,
  },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#F2F3F4',
  },
  cancelText: {
    fontSize: 15,
    color: '#7F8C8D',
    fontWeight: '600',
  },
});
