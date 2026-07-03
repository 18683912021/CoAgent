import { useColorScheme } from 'react-native';
import { colors, fontSizes, lineHeights, fontWeights, spacing, radii, shadows, zIndex, durations } from '../tokens';

export type ThemeMode = 'light' | 'dark';

/**
 * 从 tokens 构建运行时 theme 对象。
 * 所有 UI 组件通过 useTheme() 消费，保证 Dark Mode 自动响应。
 */
function buildTheme(mode: ThemeMode) {
  const isDark = mode === 'dark';

  return {
    mode,
    isDark,
    colors: {
      ...colors,
      // 自动选择亮/暗语义色
      semantic: {
        textPrimary: isDark ? colors.dark.textPrimary : colors.textPrimary,
        textSecondary: isDark ? colors.dark.textSecondary : colors.textSecondary,
        textTertiary: isDark ? colors.dark.textTertiary : colors.textTertiary,
        textDisabled: isDark ? colors.dark.textDisabled : colors.textDisabled,
        border: isDark ? colors.dark.border : colors.border,
        divider: isDark ? colors.dark.divider : colors.divider,
        background: isDark ? colors.dark.background : colors.background,
        surface: isDark ? colors.dark.surface : colors.surface,
        mask: isDark ? colors.dark.mask : colors.mask,
      },
    },
    fontSizes,
    lineHeights,
    fontWeights,
    spacing,
    radii,
    shadows,
    zIndex,
    durations,
  };
}

export type Theme = ReturnType<typeof buildTheme>;

/**
 * 获取当前主题。
 *
 * 注意：这不是 Hook！这是一个纯函数，用于非组件场景（如 http 拦截器里的 toast）。
 * 组件中应优先使用 useAppTheme() Hook 以自动响应系统主题切换。
 */
export function getTheme(): Theme {
  // 运行时降级：非组件场景假定 light
  return buildTheme('light');
}

/** Hook 版本 — 组件中推荐使用 */
export function useAppTheme(): Theme {
  const systemMode = useColorScheme();
  const mode: ThemeMode = systemMode === 'dark' ? 'dark' : 'light';
  return buildTheme(mode);
}
