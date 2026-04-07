import { useState } from 'react';
import { Check, X, Target, AlertTriangle, Info, Minus } from 'lucide-react';
import { StatusBadge } from '../components/shared/StatusBadge';
import { EmptyState } from '../components/shared/EmptyState';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { strategyApi } from '../api/strategy';
import type { StrategyTask, StrategyInsight } from '../types';

const URGENCY_ICON: Record<string, typeof AlertTriangle> = {
  critical: AlertTriangle,
  high: AlertTriangle,
  normal: Info,
  low: Minus,
};

const URGENCY_COLOR: Record<string, string> = {
  critical: 'text-error',
  high: 'text-warning',
  normal: 'text-info',
  low: 'text-text-tertiary',
};

function TaskCard({ task, onApprove, onReject }: { task: StrategyTask; onApprove: () => void; onReject: () => void }) {
  const Icon = URGENCY_ICON[task.urgency] || Info;
  const color = URGENCY_COLOR[task.urgency] || 'text-text-secondary';

  return (
    <div className="bg-bg-surface border border-border-default rounded-lg p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Icon size={16} className={color} />
          <h3 className="text-sm font-semibold text-text-primary">{task.title}</h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusBadge status={task.urgency} label={task.urgency} />
          <StatusBadge status={task.task_type} label={task.task_type.replace(/_/g, ' ')} />
        </div>
      </div>
      <p className="text-sm text-text-secondary mb-3">{task.description}</p>
      <div className="bg-bg-elevated rounded-md p-3 mb-4">
        <span className="text-[11px] font-semibold tracking-wide uppercase text-text-tertiary">Recommended Action</span>
        <p className="text-sm text-text-primary mt-1">{task.recommended_action}</p>
      </div>
      {task.proposed_directive && (
        <div className="bg-bg-elevated rounded-md p-3 mb-4 border-l-2 border-accent">
          <span className="text-[11px] font-semibold tracking-wide uppercase text-text-tertiary">Will create directive</span>
          <p className="text-sm text-accent mt-1">{JSON.stringify(task.proposed_directive)}</p>
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-tertiary">{new Date(task.created_at).toLocaleString()}</span>
        {task.status === 'pending' && (
          <div className="flex gap-2">
            <button onClick={onApprove} className="flex items-center gap-1 bg-success/20 text-success text-xs font-medium px-3 py-1.5 rounded-md hover:bg-success/30">
              <Check size={14} /> Approve
            </button>
            <button onClick={onReject} className="flex items-center gap-1 bg-error/20 text-error text-xs font-medium px-3 py-1.5 rounded-md hover:bg-error/30">
              <X size={14} /> Reject
            </button>
          </div>
        )}
        {task.status !== 'pending' && <StatusBadge status={task.status} />}
      </div>
    </div>
  );
}

function InsightCard({ insight }: { insight: StrategyInsight }) {
  return (
    <div className="bg-bg-surface border border-border-default rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <StatusBadge status={insight.status} />
        <span className="text-[11px] font-semibold tracking-wide uppercase text-text-tertiary">{insight.insight_type.replace(/_/g, ' ')}</span>
      </div>
      <p className="text-sm text-text-primary mb-2">{insight.insight}</p>
      <div className="flex items-center gap-4 text-xs text-text-tertiary">
        <span>Confidence: {(insight.confidence * 100).toFixed(0)}%</span>
        <span>Confirmed {insight.times_confirmed}x</span>
        <span>{new Date(insight.last_confirmed).toLocaleDateString()}</span>
      </div>
      <div className="mt-2 h-1.5 bg-bg-elevated rounded-full overflow-hidden">
        <div className="h-full bg-accent rounded-full" style={{ width: `${insight.confidence * 100}%` }} />
      </div>
    </div>
  );
}

const TABS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'insights', label: 'Insights' },
];

export default function Strategy() {
  const [tab, setTab] = useState('pending');
  const qc = useQueryClient();
  const { data: tasks, isLoading: tasksLoading } = useQuery({
    queryKey: ['strategy', 'tasks', tab],
    queryFn: () => strategyApi.tasks(tab === 'insights' ? 'all' : tab),
    enabled: tab !== 'insights',
  });
  const { data: insights, isLoading: insightsLoading } = useQuery({
    queryKey: ['strategy', 'insights'],
    queryFn: () => strategyApi.insights('all'),
    enabled: tab === 'insights',
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => strategyApi.updateTask(id, 'approved'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['strategy'] }),
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => strategyApi.updateTask(id, 'rejected'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['strategy'] }),
  });

  const isLoading = tab === 'insights' ? insightsLoading : tasksLoading;

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary tracking-tight mb-6">Strategy Tasks</h1>

      <div className="flex gap-1 mb-6 bg-bg-surface rounded-lg p-1 w-fit border border-border-default">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              tab === t.value ? 'bg-bg-active text-text-primary font-medium' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-32 bg-bg-surface rounded-lg animate-pulse" />)}
        </div>
      ) : tab === 'insights' ? (
        !insights || insights.length === 0 ? (
          <EmptyState title="No insights yet" description="The strategist hasn't generated any insights. They'll appear after the first daily pulse." />
        ) : (
          <div className="space-y-3">
            {insights.map((ins: StrategyInsight) => <InsightCard key={ins.id} insight={ins} />)}
          </div>
        )
      ) : !tasks || tasks.length === 0 ? (
        <EmptyState title={`No ${tab} tasks`} description={tab === 'pending' ? "No tasks waiting for approval." : `No ${tab} tasks found.`} />
      ) : (
        <div className="space-y-3">
          {tasks.map((task: StrategyTask) => (
            <TaskCard
              key={task.id}
              task={task}
              onApprove={() => approveMutation.mutate(task.id)}
              onReject={() => rejectMutation.mutate(task.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
