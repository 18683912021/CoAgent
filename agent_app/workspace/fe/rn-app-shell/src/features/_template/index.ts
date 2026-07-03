/**
 * Feature Template — 标准 Feature 模块结构参考
 *
 * 复制此目录并重命名为你的 feature 名即可开始开发。
 */

// Screens
export { ListScreen } from './screens/ListScreen';
export { DetailScreen } from './screens/DetailScreen';

// API
export { fetchList, fetchDetail, createItem, updateItem, deleteItem } from './api';
export type { ListParams } from './api';

// Types
export type { FeatureItem } from './types';

// Hooks
export { useFeatureList } from './hooks/useFeatureList';
export { useFeatureMutations } from './hooks/useFeatureMutations';
