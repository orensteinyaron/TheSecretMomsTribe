import { ScrollText } from 'lucide-react';
import { StatusBadge } from '../components/shared/StatusBadge';
import { EmptyState } from '../components/shared/EmptyState';
import { useActivityLog } from '../hooks/useSystem';

const CATEGORY_COPY: Record<string, { label: string; cls: string }> = {
  pipeline: { label: 'pipeline', cls: 'text-accent' },
  agent:    { label: 'agent',    cls: 'text-text-secondary' },
  system:   { label: 'system',   cls: 'text-text-tertiary' },
  alert:    { label: 'alert',    cls: 'text-error' },
  debug:    { label: 'debug',    cls: 'text-text-tertiary' },
};

export default function Activity() {
  const { data: log, isLoading } = useActivityLog();

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary tracking-tight mb-6">Activity Log</h1>

      {isLoading ? (
        <div className="space-y-2">{[...Array(8)].map((_, i) => <div key={i} className="h-12 bg-bg-surface rounded-lg animate-pulse" />)}</div>
      ) : !log || log.length === 0 ? (
        <EmptyState icon={<ScrollText size={24} />} title="No activity today" description="Agent runs and system events will appear here once the orchestrator triggers." />
      ) : (
        <div className="bg-bg-surface border border-border-default rounded-lg overflow-hidden">
          <div className="grid grid-cols-[100px_140px_80px_1fr_80px] gap-2 px-4 py-2 border-b border-border-subtle">
            {['Time', 'Actor', 'Kind', 'Details', 'Cost'].map((h) => (
              <span key={h} className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary">{h}</span>
            ))}
          </div>
          {log.map((entry: any) => {
            const isActivityLog = entry.source === 'activity_log' || !!entry.action;
            const actor = entry.actor_name || entry.agent_name || entry.agent_slug || 'System';
            const kindLabel = isActivityLog
              ? (CATEGORY_COPY[entry.category]?.label ?? entry.category ?? '—')
              : entry.status;
            const kindCls = isActivityLog
              ? (CATEGORY_COPY[entry.category]?.cls ?? 'text-text-secondary')
              : '';
            return (
              <div key={entry.id} className="grid grid-cols-[100px_140px_80px_1fr_80px] gap-2 px-4 py-2.5 border-b border-border-subtle hover:bg-bg-hover items-center">
                <span className="text-xs text-text-tertiary tabular-nums">
                  {new Date(entry.started_at || entry.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className="text-xs text-text-primary font-medium truncate">{actor}</span>
                {isActivityLog ? (
                  <span className={`text-xs font-medium ${kindCls}`}>{kindLabel}</span>
                ) : (
                  <StatusBadge status={entry.status} size="sm" />
                )}
                <div className="text-xs text-text-secondary truncate">
                  {entry.action && <span className="text-text-tertiary mr-2">[{entry.action}]</span>}
                  {entry.trigger && <span className="text-text-tertiary mr-2">[{entry.trigger}]</span>}
                  {entry.error ? <span className="text-error">{entry.error}</span> : entry.description || `${entry.status ?? ''}`}
                  {entry.completed_at && entry.started_at && (
                    <span className="text-text-tertiary ml-2">
                      ({((new Date(entry.completed_at).getTime() - new Date(entry.started_at).getTime()) / 1000).toFixed(1)}s)
                    </span>
                  )}
                </div>
                <span className="text-xs text-text-tertiary tabular-nums">
                  {entry.cost_usd > 0 ? `$${parseFloat(entry.cost_usd).toFixed(4)}` : '—'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
