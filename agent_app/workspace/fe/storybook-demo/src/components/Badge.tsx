/**
 * Badge —— 状态标签
 *
 * 五种色调：中性 / 成功 / 警告 / 危险 / 强调色
 * 可带小圆点，用于"在线、已通过、异常"这类状态标识。
 */
interface Props {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
  dot?: boolean;
  children: string;
}

const toneClass = {
  neutral: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  accent: 'bg-accent-light text-accent',
} as const;

const dotClass = {
  neutral: 'bg-zinc-400 dark:bg-zinc-500',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  accent: 'bg-accent',
} as const;

export default function Badge({ tone = 'neutral', dot = false, children }: Props) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        toneClass[tone],
      ].join(' ')}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotClass[tone]}`} />}
      {children}
    </span>
  );
}
