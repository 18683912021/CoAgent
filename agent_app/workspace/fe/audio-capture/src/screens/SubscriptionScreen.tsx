/**
 * SubscriptionScreen —— PC 端续费/套餐选择
 *
 * 和移动端一致的 6 档套餐。PC 端用居中弹窗 + 网格卡片布局。
 */
interface Plan {
  key: string;
  name: string;
  desc: string;
  price: number;
  originalPrice: number;
  discount: string;
  duration: string;
  popular?: boolean;
  icon: string;
  color: string;
  perks: string[];
}

const PLANS: Plan[] = [
  { key: '1h', name: '尝鲜体验', desc: '适合快速练习', price: 60, originalPrice: 90, discount: '6.7折', duration: '1 小时', icon: '⚡', color: '#6366F1', perks: ['1 小时面试时长', 'AI 实时建议', '面试历史记录', '基础赛道支持'] },
  { key: '2h', name: '进阶特训', desc: '深度模拟面试', price: 100, originalPrice: 160, discount: '6.3折', duration: '2 小时', icon: '🎯', color: '#8B5CF6', perks: ['2 小时面试时长', 'AI 实时建议', '面试历史记录', '全赛道支持'] },
  { key: '4h', name: '高效冲刺', desc: '密集备战方案', price: 188, originalPrice: 300, discount: '6.3折', duration: '4 小时', icon: '🚀', color: '#4F46E5', popular: true, perks: ['4 小时面试时长', 'AI 实时建议', '面试历史记录', '全赛道支持', '优先队列'] },
  { key: 'monthly', name: '包月畅练', desc: '不限时长随心练', price: 400, originalPrice: 800, discount: '5折', duration: '/ 月', icon: '💎', color: '#7C3AED', perks: ['30 天不限时长', 'AI 实时建议', '面试历史记录', '全赛道支持', '优先队列', '专属客服'] },
  { key: 'quarterly', name: '季度进阶', desc: '系统化面试训练', price: 800, originalPrice: 1888, discount: '4.2折', duration: '/ 季', icon: '👑', color: '#A855F7', perks: ['90 天不限时长', 'AI 实时建议', '面试历史记录', '全赛道支持', '优先队列', '专属客服', '模拟面试报告'] },
  { key: 'yearly', name: '年度王者', desc: '终极面试解决方案', price: 2000, originalPrice: 7200, discount: '2.8折', duration: '/ 年', icon: '🌟', color: '#D946EF', perks: ['365 天不限时长', 'AI 实时建议', '面试历史记录', '全赛道支持', '最优先队列', '1v1 专属客服', '模拟面试报告', '简历深度优化'] },
];

interface Props { onClose: () => void; }

export default function SubscriptionScreen({ onClose }: Props) {
  return (
    <div className="fixed inset-0 bg-backdrop flex items-start justify-center z-50 overflow-y-auto py-xl" onClick={onClose}>
      <div className="bg-bg-surface rounded-2xl shadow-xl max-w-5xl w-full mx-lg my-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-2xl py-xl border-b border-divider">
          <div>
            <h2 className="text-heading font-extrabold">
              选择适合你的 <span className="text-accent">面试方案</span>
            </h2>
            <p className="text-body-sm text-text-secondary mt-sm">每一次练习，都在靠近你的 dream offer</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-bg flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors text-lg">✕</button>
        </div>

        {/* Plans grid */}
        <div className="p-2xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-lg">
          {PLANS.map(plan => (
            <PlanCard key={plan.key} plan={plan} />
          ))}
        </div>

        <div className="px-2xl pb-xl text-center text-caption text-text-tertiary">
          所有套餐一经购买立即生效 · 暂不支持退款
        </div>
      </div>
    </div>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <div
      className={`relative rounded-2xl p-xl border-2 flex flex-col transition-shadow hover:shadow-md ${
        plan.popular ? 'border-[var(--plan-color)] shadow-sm' : 'border-divider'
      }`}
      style={{ '--plan-color': plan.color } as React.CSSProperties}
    >
      {plan.popular && (
        <span
          className="absolute top-0 right-0 px-md py-1.5 text-[10px] font-bold text-white rounded-bl-xl"
          style={{ backgroundColor: plan.color }}
        >
          🔥 最受欢迎
        </span>
      )}

      {/* Header */}
      <div className="flex items-center gap-md mb-lg">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl" style={{ backgroundColor: plan.color + '18' }}>
          {plan.icon}
        </div>
        <div>
          <div className="text-body font-bold text-text-primary">{plan.name}</div>
          <div className="text-caption text-text-tertiary">{plan.desc}</div>
        </div>
      </div>

      {/* Price */}
      <div className="flex items-baseline justify-between mb-lg">
        <div className="flex items-baseline">
          <span className="text-lg font-bold" style={{ color: plan.color }}>¥</span>
          <span className="text-4xl font-extrabold tracking-tight" style={{ color: plan.color }}>{plan.price}</span>
          <span className="text-body-sm text-text-tertiary ml-1">{plan.duration}</span>
        </div>
        <div className="flex items-center gap-sm">
          <span className="text-body-sm text-text-secondary line-through">¥{plan.originalPrice}</span>
          <span className="px-sm py-0.5 rounded-md text-caption font-extrabold text-white" style={{ backgroundColor: plan.color }}>{plan.discount}</span>
        </div>
      </div>

      {/* Perks */}
      <div className="flex-1 rounded-xl bg-bg border border-divider p-md space-y-sm mb-lg">
        {plan.perks.map((p, i) => (
          <div key={i} className="flex items-center gap-sm">
            <span className="text-xs font-bold text-success">✓</span>
            <span className="text-body-sm text-text-secondary">{p}</span>
          </div>
        ))}
      </div>

      {/* CTA */}
      <button
        className="w-full h-11 rounded-xl text-body-sm font-bold text-white tracking-wide hover:opacity-90 transition-opacity"
        style={{ backgroundColor: plan.color }}
      >
        立即订阅
      </button>
    </div>
  );
}
