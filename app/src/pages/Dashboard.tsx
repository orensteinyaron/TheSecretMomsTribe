import { useNavigate } from 'react-router-dom';
import { Layers, Film, CalendarDays, Bot, AlertTriangle, Clock, XCircle, Target } from 'lucide-react';
import { MetricCard } from '../components/shared/MetricCard';
import { StatusBadge } from '../components/shared/StatusBadge';
import { useSystemHealth } from '../hooks/useSystem';
import { useContentList } from '../hooks/useContent';
import { useQuery } from '@tanstack/react-query';
import { strategyApi } from '../api/strategy';
import { systemApi } from '../api/system';

function ActionCenter() {
  const { data: health } = useSystemHealth();
  const pendingTasks = health?.pending_tasks ?? 0;
  const pendingContent = health?.pending_content ?? 0;
  const failedRenders = health?.failed_renders ?? 0;
  const total = pendingTasks + pendingContent + failedRenders;
  const navigate = useNavigate();

  if (total === 0) return null;

  return (
    <div className="bg-bg-surface border border-border-default rounded-lg p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-text-primary">NEEDS YOUR ATTENTION</h2>
        <span className="bg-error text-text-inverse text-xs font-bold px-2 py-0.5 rounded-full">{total}</span>
      </div>
      <div className="space-y-2">
        {pendingTasks > 0 && (
          <button onClick={() => navigate('/strategy')} className="flex items-center gap-2 text-sm text-warning hover:text-text-primary w-full text-left">
            <Target size={16} /> {pendingTasks} strategy task{pendingTasks > 1 ? 's' : ''} pending approval
          </button>
        )}
        {pendingContent > 0 && (
          <button onClick={() => navigate('/pipeline')} className="flex items-center gap-2 text-sm text-warning hover:text-text-primary w-full text-left">
            <Clock size={16} /> {pendingContent} content item{pendingContent > 1 ? 's' : ''} awaiting review
          </button>
        )}
        {failedRenders > 0 && (
          <button onClick={() => navigate('/renders')} className="flex items-center gap-2 text-sm text-error hover:text-text-primary w-full text-left">
            <XCircle size={16} /> {failedRenders} render{failedRenders > 1 ? 's' : ''} failed
          </button>
        )}
      </div>
    </div>
  );
}

function SnapshotCards() {
  const { data: health } = useSystemHealth();
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-4 gap-4 mb-8">
      <MetricCard label="Pipeline" value={health ? `${health.pending_content + (health.agents?.total ?? 0)} total` : '—'} icon={<Layers size={20} />} onClick={() => navigate('/pipeline')} />
      <MetricCard label="Renders" value={health?.failed_renders !== undefined ? `${health.failed_renders} failed` : '—'} icon={<Film size={20} />} onClick={() => navigate('/renders')} />
      <MetricCard label="System" value={health ? `${health.agents?.healthy ?? 0}/${health.agents?.total ?? 0} healthy` : '—'} icon={<Bot size={20} />} onClick={() => navigate('/system/agents')} />
      <MetricCard label="Today's Cost" value={health?.today_cost !== undefined ? `$${health.today_cost.toFixed(2)}` : '—'} icon={<CalendarDays size={20} />} onClick={() => navigate('/system/costs')} />
    </div>
  );
}

function InsightsPanel() {
  const { data: insights } = useQuery({ queryKey: ['strategy', 'insights'], queryFn: () => strategyApi.insights('all') });
  const top = (insights || []).slice(0, 5);

  if (top.length === 0) return null;

  return (
    <div className="bg-bg-surface border border-border-default rounded-lg p-5 mb-6">
      <h2 className="text-sm font-semibold text-text-primary mb-3">LATEST INSIGHTS</h2>
      <div className="space-y-3">
        {top.map((ins) => (
          <div key={ins.id} className="flex items-start gap-3">
            <StatusBadge status={ins.status} />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-text-primary">{ins.insight}</p>
              <p className="text-xs text-text-tertiary mt-0.5">
                Confidence: {(ins.confidence * 100).toFixed(0)}% · Confirmed {ins.times_confirmed}x
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityLog() {
  const { data: log } = useQuery({ queryKey: ['system', 'activity'], queryFn: () => systemApi.activityLog() });
  const entries = log || [];

  return (
    <div className="bg-bg-surface border border-border-default rounded-lg p-5">
      <h2 className="text-sm font-semibold text-text-primary mb-3">SYSTEM ACTIVITY</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-text-tertiary">No activity recorded today.</p>
      ) : (
        <div className="space-y-2">
          {entries.slice(0, 15).map((entry: any, i: number) => (
            <div key={entry.id || i} className="flex items-start gap-3 py-1">
              <span className="text-xs text-text-tertiary font-medium tabular-nums whitespace-nowrap mt-0.5">
                {new Date(entry.started_at || entry.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </span>
              <div className="flex-1 min-w-0">
                <StatusBadge status={entry.status} size="sm" />
                <span className="text-sm text-text-secondary ml-2">
                  {entry.agent_name || entry.actor_name || 'System'} — {entry.description || entry.status}
                </span>
              </div>
              {entry.cost_usd > 0 && (
                <span className="text-xs text-text-tertiary">${parseFloat(entry.cost_usd).toFixed(4)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary tracking-tight mb-6">Dashboard</h1>
      <ActionCenter />
      <SnapshotCards />
      <div className="grid grid-cols-2 gap-6">
        <InsightsPanel />
        <ActivityLog />
      </div>
    </div>
  );
}
