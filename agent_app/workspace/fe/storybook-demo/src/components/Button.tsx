/**
 * Button —— 通用按钮
 *
 * 四种风格：主按钮 / 次按钮 / 幽灵按钮 / 危险按钮
 * 三种尺寸：sm / md / lg，支持 loading 状态和图标。
 */
import { motion } from 'framer-motion';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

// Omit 掉拖拽/动画事件：React 与 framer-motion 对这些事件的类型签名不同
interface Props
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'onAnimationEnd'
  > {
  /** 按钮风格：primary 主按钮 / secondary 次按钮 / ghost 幽灵按钮 / danger 危险操作 */
  variant?: Variant;
  /** 尺寸：sm 小 / md 中 / lg 大 */
  size?: Size;
  /** 加载中：显示转圈动画并禁用点击 */
  loading?: boolean;
  /** 图标：推荐传 lucide-react 的图标组件 */
  icon?: ReactNode;
}

const variantClass: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:opacity-90 shadow-sm',
  secondary: 'bg-accent-light text-accent hover:opacity-80',
  ghost: 'text-text-secondary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10',
  danger: 'bg-danger text-white hover:opacity-90 shadow-sm',
};

const sizeClass: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2.5',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  disabled,
  children,
  className = '',
  ...rest
}: Props) {
  return (
    <motion.button
      whileTap={disabled || loading ? undefined : { scale: 0.97 }}
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center rounded-md font-medium',
        'transition-all duration-150 select-none',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variantClass[variant],
        sizeClass[size],
        className,
      ].join(' ')}
      {...rest}
    >
      {loading ? (
        <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        icon
      )}
      {children}
    </motion.button>
  );
}
