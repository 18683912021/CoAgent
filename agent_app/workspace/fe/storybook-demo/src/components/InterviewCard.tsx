/**
 * InterviewCard —— 面试记录卡片（组合示例）
 *
 * 演示"组件拼组件"：Avatar 信息 + Badge 状态 + 时间/时长信息。
 * 你项目里 InterviewHistoryScreen 的列表项就是这种形态。
 */
import { Calendar, Clock } from 'lucide-react';
import Badge from './Badge';

interface Props {
  title: string;
  company?: string;
  date: string;
  duration: string;
  score: number; // 0 ~ 100
  status: 'passed' | 'pending' | 'failed';
}

const statusConfig = {
  passed: { tone: 'success' as const, label: '已通过' },
  pending: { tone: 'warning' as const, label: '待复核' },
  failed: { tone: 'danger' as const, label: '未通过' },
};

export default function InterviewCard({ title, company, date, duration, score, status }: Props) {
  const cfg = statusConfig[status];
  const scoreColor =
    score >= 80 ? 'text-success' : score >= 60 ? 'text-warning' : 'text-danger';

  return (
    <div className="bg-bg-surface border border-divider rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text-primary truncate">{title}</h3>
            {company && (
              <span className="text-xs text-text-secondary shrink-0">{company}</span>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-xs text-text-secondary">
            <span className="inline-flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {date}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {duration}
            </span>
          </div>
        </div>
        <Badge tone={cfg.tone} dot>
          {cfg.label}
        </Badge>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-text-secondary">综合评分</span>
        <span className={`text-xl font-bold ${scoreColor}`}>{score}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${score >= 80 ? 'bg-success' : score >= 60 ? 'bg-warning' : 'bg-danger'}`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}
