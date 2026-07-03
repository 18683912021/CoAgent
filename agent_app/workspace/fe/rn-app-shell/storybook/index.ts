/**
 * Storybook 入口
 *
 * 此文件由 storybook:generate 脚本自动维护。
 * 手动添加故事后运行 npm run storybook:generate。
 */

import type { StorybookConfig } from '@storybook/react-native';

const config: StorybookConfig = {
  stories: [
    // 手动注册的故事文件
    require('./stories/Loading.stories'),
    require('./stories/Empty.stories'),
    require('./stories/Skeleton.stories'),
    require('./stories/Modal.stories'),
    require('./stories/CachedImage.stories'),
    require('./stories/MenuRow.stories'),
  ],
  addons: [],
};

export default config;
