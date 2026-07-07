/**
 * EditProfileScreen — 编辑个人资料
 *
 * 表单：头像、昵称、性别、生日、个人简介
 * 四态：loading(获取现有数据) / error / 表单填写 / 提交中
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useAppTheme } from '@design-system/theme';
import { spacing, fontSizes, fontWeights, radii } from '@design-system/tokens';
import { CachedImage, Loading, Empty } from '@shared/components';
import { toast } from '@shared/components/Toast';
import { useUserProfile } from '../hooks/useUserProfile';
import { useUserMutations } from '../hooks/useUserMutations';
import type { UserProfile } from '../types';
import { GENDER_MAP, MAX_BIO_LENGTH } from '../constants';

const GENDER_OPTIONS: UserProfile['gender'][] = ['male', 'female', 'other'];

export function EditProfileScreen(): React.ReactElement {
  const theme = useAppTheme();
  const router = useRouter();

  const { data: profile, isLoading, isError, refetch } = useUserProfile();
  const { updateProfile, uploadAvatar, isPending } = useUserMutations();

  // 本地编辑状态
  const [name, setName] = useState('');
  const [gender, setGender] = useState<UserProfile['gender']>('male');
  const [birthday, setBirthday] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUri, setAvatarUri] = useState('');
  const [initialized, setInitialized] = useState(false);

  // 初始化表单
  if (!initialized && profile) {
    setName(profile.name);
    setGender(profile.gender);
    setBirthday(profile.birthday ?? '');
    setBio(profile.bio ?? '');
    setAvatarUri(profile.avatar);
    setInitialized(true);
  }

  const handlePickAvatar = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('提示', '需要相册权限才能更换头像');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setAvatarUri(uri);
      uploadAvatar.mutate(uri);
      toast.success('头像已更新');
    }
  }, [uploadAvatar]);

  const handleSave = useCallback(() => {
    if (!name.trim()) {
      toast.error('请输入昵称');
      return;
    }

    updateProfile.mutate(
      {
        name: name.trim(),
        gender,
        birthday: birthday || undefined,
        bio: bio.trim() || undefined,
      },
      {
        onSuccess: () => {
          router.back();
        },
      },
    );
  }, [name, gender, birthday, bio, updateProfile, router]);

  // Loading
  if (isLoading) {
    return <Loading fullScreen text="加载资料中..." />;
  }

  // Error
  if (isError || !profile) {
    return (
      <Empty
        icon="⚠️"
        title="加载失败"
        description="无法获取用户资料"
        actionText="重试"
        onAction={() => refetch()}
      />
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.semantic.background }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* 头像 */}
      <TouchableOpacity
        style={styles.avatarSection}
        onPress={handlePickAvatar}
        activeOpacity={0.7}
      >
        <CachedImage uri={avatarUri} style={styles.avatar} />
        <Text style={[styles.avatarHint, { color: theme.colors.primary }]}>更换头像</Text>
      </TouchableOpacity>

      {/* 昵称 */}
      <View style={[styles.field, { backgroundColor: theme.colors.semantic.surface }]}>
        <Text style={[styles.label, { color: theme.colors.semantic.textSecondary }]}>昵称</Text>
        <TextInput
          style={[styles.input, { color: theme.colors.semantic.textPrimary }]}
          value={name}
          onChangeText={setName}
          placeholder="请输入昵称"
          placeholderTextColor={theme.colors.semantic.textTertiary}
          maxLength={20}
        />
      </View>

      {/* 性别 */}
      <View style={[styles.field, { backgroundColor: theme.colors.semantic.surface }]}>
        <Text style={[styles.label, { color: theme.colors.semantic.textSecondary }]}>性别</Text>
        <View style={styles.genderRow}>
          {GENDER_OPTIONS.map((g) => {
            const isActive = gender === g;
            return (
              <TouchableOpacity
                key={g}
                style={[
                  styles.genderBtn,
                  {
                    backgroundColor: isActive ? theme.colors.primaryBg : 'transparent',
                    borderColor: isActive ? theme.colors.primary : theme.colors.semantic.border,
                  },
                ]}
                onPress={() => setGender(g)}
              >
                <Text
                  style={{
                    color: isActive ? theme.colors.primary : theme.colors.semantic.textSecondary,
                  }}
                >
                  {GENDER_MAP[g]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* 生日 */}
      <View style={[styles.field, { backgroundColor: theme.colors.semantic.surface }]}>
        <Text style={[styles.label, { color: theme.colors.semantic.textSecondary }]}>生日</Text>
        <TextInput
          style={[styles.input, { color: theme.colors.semantic.textPrimary }]}
          value={birthday}
          onChangeText={setBirthday}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={theme.colors.semantic.textTertiary}
          maxLength={10}
        />
      </View>

      {/* 个人简介 */}
      <View style={[styles.field, { backgroundColor: theme.colors.semantic.surface }]}>
        <Text style={[styles.label, { color: theme.colors.semantic.textSecondary }]}>个人简介</Text>
        <TextInput
          style={[
            styles.input,
            styles.bioInput,
            { color: theme.colors.semantic.textPrimary },
          ]}
          value={bio}
          onChangeText={setBio}
          placeholder="介绍一下自己吧"
          placeholderTextColor={theme.colors.semantic.textTertiary}
          maxLength={MAX_BIO_LENGTH}
          multiline
          numberOfLines={3}
        />
        <Text style={[styles.charCount, { color: theme.colors.semantic.textTertiary }]}>
          {bio.length}/{MAX_BIO_LENGTH}
        </Text>
      </View>

      {/* 保存 */}
      <TouchableOpacity
        style={[styles.saveBtn, { backgroundColor: theme.colors.primary, opacity: isPending ? 0.6 : 1 }]}
        onPress={handleSave}
        disabled={isPending}
        activeOpacity={0.8}
      >
        <Text style={styles.saveBtnText}>
          {isPending ? '保存中...' : '保存'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  avatarSection: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  avatarHint: {
    fontSize: fontSizes.sm,
  },
  field: {
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: fontSizes.xs,
    marginBottom: spacing.xs,
  },
  input: {
    fontSize: fontSizes.md,
    paddingVertical: spacing.xs,
  },
  bioInput: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: fontSizes.xs,
    textAlign: 'right',
    marginTop: spacing.xs,
  },
  genderRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  genderBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  saveBtn: {
    marginTop: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    color: '#fff',
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold as any,
  },
});
