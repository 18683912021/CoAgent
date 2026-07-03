/**
 * useUserMutations — 用户操作 Hook（更新资料、上传头像、修改密码等）
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateProfile, uploadAvatar, changePassword, changePhone, deleteAccount } from '../api';
import { toast } from '@shared/components/Toast';

export function useUserMutations() {
  const queryClient = useQueryClient();

  const invalidateProfile = () => {
    queryClient.invalidateQueries({ queryKey: ['user-profile'] });
  };

  const updateProfileMutation = useMutation({
    mutationFn: updateProfile,
    onSuccess: () => {
      toast.success('资料更新成功');
      invalidateProfile();
    },
    onError: () => {
      toast.error('更新失败，请重试');
    },
  });

  const uploadAvatarMutation = useMutation({
    mutationFn: uploadAvatar,
    onSuccess: (data) => {
      // 上传成功后自动更新 profile 中的 avatar 字段
      updateProfileMutation.mutate({ avatar: data.url });
    },
    onError: () => {
      toast.error('头像上传失败');
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      toast.success('密码修改成功');
    },
    onError: () => {
      toast.error('密码修改失败');
    },
  });

  const changePhoneMutation = useMutation({
    mutationFn: changePhone,
    onSuccess: () => {
      toast.success('手机号修改成功');
      queryClient.invalidateQueries({ queryKey: ['user-security'] });
    },
    onError: () => {
      toast.error('修改失败，请重试');
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      toast.success('账号已注销');
    },
    onError: () => {
      toast.error('注销失败，请重试');
    },
  });

  return {
    updateProfile: updateProfileMutation,
    uploadAvatar: uploadAvatarMutation,
    changePassword: changePasswordMutation,
    changePhone: changePhoneMutation,
    deleteAccount: deleteAccountMutation,
    isPending:
      updateProfileMutation.isPending ||
      uploadAvatarMutation.isPending ||
      changePasswordMutation.isPending ||
      changePhoneMutation.isPending ||
      deleteAccountMutation.isPending,
  };
}
