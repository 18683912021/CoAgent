import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { useAppTheme } from '@design-system/theme';
import { spacing, radii, fontSizes, fontWeights, shadows } from '@design-system/tokens';
import { toast } from '@shared/components';
import { useFeatureMutations } from '../hooks/useFeatureMutations';

// ---- 表单校验 ----
const featureFormSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(50, '标题最多50字'),
  description: z.string().max(200, '描述最多200字').optional().or(z.literal('')),
  status: z.enum(['active', 'inactive', 'archived']),
});

type FeatureFormData = z.infer<typeof featureFormSchema>;

interface FeatureFormProps {
  defaultValues?: Partial<FeatureFormData>;
  isEdit?: boolean;
  itemId?: string;
}

export function FeatureForm({ defaultValues, isEdit = false, itemId }: FeatureFormProps): React.ReactElement {
  const theme = useAppTheme();
  const router = useRouter();
  const { create, update, isPending } = useFeatureMutations();

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FeatureFormData>({
    defaultValues: {
      title: defaultValues?.title ?? '',
      description: defaultValues?.description ?? '',
      status: defaultValues?.status ?? 'active',
    },
  });

  const onSubmit = async (data: FeatureFormData) => {
    try {
      if (isEdit && itemId) {
        await update.mutateAsync({ id: itemId, data });
      } else {
        await create.mutateAsync(data as any);
      }
      router.back();
    } catch {
      // 错误已在 mutation 中通过 toast 提示
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.colors.semantic.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* 标题 */}
        <View style={[styles.field, { backgroundColor: theme.colors.semantic.surface }, shadows.sm]}>
          <Text style={[styles.label, { color: theme.colors.semantic.textSecondary }]}>标题 *</Text>
          <Controller
            control={control}
            name="title"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={[styles.input, { color: theme.colors.semantic.textPrimary }]}
                placeholder="请输入标题"
                placeholderTextColor={theme.colors.semantic.textTertiary}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                maxLength={50}
              />
            )}
          />
          {errors.title && <Text style={styles.error}>{errors.title.message}</Text>}
        </View>

        {/* 描述 */}
        <View style={[styles.field, { backgroundColor: theme.colors.semantic.surface }, shadows.sm]}>
          <Text style={[styles.label, { color: theme.colors.semantic.textSecondary }]}>描述</Text>
          <Controller
            control={control}
            name="description"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={[styles.input, styles.textArea, { color: theme.colors.semantic.textPrimary }]}
                placeholder="请输入描述（选填）"
                placeholderTextColor={theme.colors.semantic.textTertiary}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                multiline
                numberOfLines={4}
                maxLength={200}
                textAlignVertical="top"
              />
            )}
          />
        </View>

        {/* 提交按钮 */}
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: theme.colors.primary }, isPending && styles.submitBtnDisabled]}
          onPress={handleSubmit(onSubmit)}
          disabled={isPending}
          activeOpacity={0.8}
        >
          {isPending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.submitBtnText}>{isEdit ? '保存修改' : '创建'}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  field: {
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  label: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
    marginBottom: spacing.sm,
  },
  input: {
    fontSize: fontSizes.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
  },
  textArea: {
    minHeight: 100,
    borderBottomWidth: 0,
  },
  error: {
    color: '#ff4d4f',
    fontSize: fontSizes.sm,
    marginTop: spacing.xs,
  },
  submitBtn: {
    height: 48,
    borderRadius: radii.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    color: '#fff',
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
  },
});
