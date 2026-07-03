/**
 * Design Tokens — 全局设计原子
 *
 * 所有 UI 组件和业务页面必须引用这里的 Token，
 * 禁止在业务代码中硬编码颜色、字号、间距等值。
 */

// ---- 颜色 ----
export const colors = {
  // 主色
  primary: '#1677ff',
  primaryLight: '#4096ff',
  primaryDark: '#0958d9',
  primaryBg: '#e6f4ff',

  // 语义色
  success: '#52c41a',
  warning: '#faad14',
  error: '#ff4d4f',
  info: '#1677ff',

  // 中性色
  textPrimary: '#1a1a1a',
  textSecondary: '#666666',
  textTertiary: '#999999',
  textDisabled: '#bfbfbf',
  border: '#e8e8e8',
  divider: '#f0f0f0',
  background: '#f5f5f5',
  surface: '#ffffff',
  mask: 'rgba(0, 0, 0, 0.45)',

  // Dark Mode
  dark: {
    textPrimary: '#e8e8e8',
    textSecondary: '#a0a0a0',
    textTertiary: '#666666',
    textDisabled: '#444444',
    border: '#333333',
    divider: '#262626',
    background: '#0a0a0a',
    surface: '#1a1a1a',
    mask: 'rgba(0, 0, 0, 0.65)',
  },
} as const;

// ---- 字号 ----
export const fontSizes = {
  xs: 10,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 18,
  xxl: 20,
  title: 24,
  hero: 32,
} as const;

// ---- 行高 ----
export const lineHeights = {
  xs: 14,
  sm: 18,
  md: 20,
  lg: 22,
  xl: 24,
  xxl: 28,
  title: 32,
  hero: 40,
} as const;

// ---- 字重 ----
export const fontWeights = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

// ---- 间距（4px 基准） ----
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

// ---- 圆角 ----
export const radii = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

// ---- 阴影（iOS + Android elevation） ----
export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
} as const;

// ---- Z-Index ----
export const zIndex = {
  base: 1,
  dropdown: 100,
  sticky: 200,
  modal: 500,
  toast: 999,
} as const;

// ---- 动画时长（ms） ----
export const durations = {
  fast: 150,
  normal: 250,
  slow: 350,
} as const;

// ---- 屏幕断点 ----
export const breakpoints = {
  sm: 375,
  md: 414,
  lg: 768,
  xl: 1024,
} as const;
