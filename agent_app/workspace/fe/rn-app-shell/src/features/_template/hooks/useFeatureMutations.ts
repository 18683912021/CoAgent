/**
 * useFeatureMutations — 增删改操作 Hook
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createItem, updateItem, deleteItem } from '../api';
import { toast } from '@shared/components/Toast';

export function useFeatureMutations() {
  const queryClient = useQueryClient();

  const invalidateList = () => {
    queryClient.invalidateQueries({ queryKey: ['feature-list'] });
  };

  const createMutation = useMutation({
    mutationFn: createItem,
    onSuccess: () => {
      toast.success('创建成功');
      invalidateList();
    },
    onError: () => {
      toast.error('创建失败，请重试');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateItem>[1] }) =>
      updateItem(id, data),
    onSuccess: () => {
      toast.success('更新成功');
      invalidateList();
    },
    onError: () => {
      toast.error('更新失败，请重试');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteItem,
    onSuccess: () => {
      toast.success('删除成功');
      invalidateList();
    },
    onError: () => {
      toast.error('删除失败，请重试');
    },
  });

  return {
    create: createMutation,
    update: updateMutation,
    remove: deleteMutation,
    isPending: createMutation.isPending || updateMutation.isPending || deleteMutation.isPending,
  };
}
