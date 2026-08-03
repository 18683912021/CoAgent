/**
 * InterviewHistoryScreen —— PC 桌面端面试历史
 *
 * 主从视图布局：左列表（60%）| 右详情面板（40%）。
 * 业务逻辑完全对齐移动端。
 */
import { useEffect, useState, useCallback } from 'react';
import {
  getInterviewList, getInterviewDetail, clearInterviewHistory,
  type InterviewListItem, type InterviewDetail,
} from '../api/interview';
import ConversationBubble from '../components/ConversationBubble';

const LANG_LABELS: Record<string, string> = {
  javascript: 'JavaScript', python: 'Python', java: 'Java', csharp: 'C#', cpp: 'C++', go: 'Go',
};
const LANG_ICONS: Record<string, string> = {
  javascript: '🟨', python: '🐍', java: '☕', csharp: '🟪', cpp: '🔷', go: '🔵',
};
function fmtDate(ts: number) {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fmtDuration(s: number) { const m = Math.floor(s / 60); const sec = s % 60; return m === 0 ? `${sec} 秒` : `${m} 分 ${sec} 秒`; }

export default function InterviewHistoryScreen() {
  const [list, setList] = useState<InterviewListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InterviewDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  useEffect(() => {
    getInterviewList().then(setList).catch(() => []).finally(() => setLoading(false));
  }, []);

  const selectItem = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    setDetail(null);
    try { setDetail(await getInterviewDetail(id)); } catch {}
    finally { setDetailLoading(false); }
  }, []);

  const handleClear = useCallback(async () => {
    await clearInterviewHistory();
    setList([]); setSelectedId(null); setDetail(null); setShowClearConfirm(false);
  }, []);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* ══════ 左 · 列表 ══════ */}
      <div className="w-[55%] min-w-[360px] flex flex-col border-r border-divider bg-bg-surface">
        <div className="flex items-center justify-between px-xl py-lg border-b border-divider shrink-0">
          <h2 className="text-heading font-bold">面试历史</h2>
          {list.length > 0 && (
            <button onClick={() => setShowClearConfirm(true)}
              className="text-body-sm text-danger hover:underline font-medium">清空全部</button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-xl text-text-secondary text-body">加载中…</div>
          ) : list.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-lg text-center px-lg">
              <span className="text-5xl">📋</span>
              <div>
                <div className="text-heading text-text-primary mb-sm">暂无面试记录</div>
                <div className="text-body-sm text-text-tertiary">完成面试后会自动保存到这里</div>
              </div>
            </div>
          ) : (
            <div className="p-lg space-y-sm">
              {list.map(item => (
                <button key={item.id} onClick={() => selectItem(item.id)}
                  className={`w-full flex text-left rounded-xl border overflow-hidden transition-all hover:shadow-sm ${
                    selectedId === item.id ? 'border-accent bg-accent-light/20 shadow-sm' : 'border-divider bg-bg hover:border-text-tertiary/30'
                  }`}>
                  <div className={`w-1 shrink-0 ${selectedId === item.id ? 'bg-accent' : 'bg-transparent'}`} />
                  <div className="flex-1 p-lg">
                    <div className="flex items-center justify-between mb-sm">
                      <div className="flex items-center gap-sm">
                        <span>{LANG_ICONS[item.programming_language] ?? '💬'}</span>
                        <span className="text-body font-bold text-text-primary">
                          {LANG_LABELS[item.programming_language] ?? item.programming_language}
                        </span>
                      </div>
                      <span className="text-caption text-text-tertiary tabular-nums">{item.message_count} 条</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-body-sm text-text-secondary">{fmtDate(item.started_at)}</span>
                      <span className="text-caption text-text-tertiary">⏱ {fmtDuration(item.duration_seconds)}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ══════ 右 · 详情 ══════ */}
      <div className="flex-1 flex flex-col min-w-0 bg-bg">
        {!selectedId ? (
          <div className="flex-1 flex items-center justify-center text-text-tertiary">
            <div className="text-center">
              <span className="text-4xl block mb-md">📋</span>
              <span className="text-body-sm">选择左侧记录查看详情</span>
            </div>
          </div>
        ) : detailLoading ? (
          <div className="flex-1 flex items-center justify-center text-text-secondary text-body-sm">加载中…</div>
        ) : detail ? (
          <>
            {/* 元信息 */}
            <div className="shrink-0 px-xl py-lg border-b border-divider bg-bg-surface">
              <div className="flex items-center gap-xl text-body-sm">
                <MetaItem label="时间" value={fmtDate(detail.started_at)} />
                <MetaItem label="时长" value={`⏱ ${fmtDuration(detail.duration_seconds)}`} />
                <MetaItem label="赛道" value={`${LANG_ICONS[detail.programming_language] ?? ''} ${LANG_LABELS[detail.programming_language] ?? detail.programming_language}`} />
                <MetaItem label="对话" value={`${detail.conversation.length} 条`} />
              </div>
            </div>
            {/* 对话 */}
            <div className="flex-1 overflow-y-auto px-lg py-lg space-y-sm">
              {detail.conversation.map(msg => (
                <ConversationBubble key={msg.id} message={{ ...msg, status: 'done' }} />
              ))}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-text-tertiary text-body-sm">加载失败</div>
        )}
      </div>

      {/* 清空确认弹窗 */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-backdrop flex items-center justify-center z-50" onClick={() => setShowClearConfirm(false)}>
          <div className="bg-bg-surface rounded-2xl p-xl w-80 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-heading mb-md">清空历史</h3>
            <p className="text-body text-text-secondary mb-lg">确定要清空所有面试历史吗？此操作不可恢复。</p>
            <div className="flex gap-md justify-end">
              <button onClick={() => setShowClearConfirm(false)} className="px-xl py-sm rounded-lg border border-divider text-body-sm hover:bg-bg">取消</button>
              <button onClick={handleClear} className="px-xl py-sm rounded-lg bg-danger text-white text-body-sm font-bold hover:bg-red-600">清空</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-text-tertiary mr-sm">{label}</span>
      <span className="font-semibold text-text-primary">{value}</span>
    </div>
  );
}
