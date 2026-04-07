import { useState } from 'react';
import { Bot, Play, ChevronDown, ChevronUp } from 'lucide-react';
import { StatusBadge } from '../components/shared/StatusBadge';
import { EmptyState } from '../components/shared/EmptyState';
import { useAgents, useAgentRuns } from '../hooks/useSystem';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { agentsApi } from '../api/agents';
import type { Agent, AgentRun } from '../types';

function RunHistory({ slug }: { slug: string }) {
  const { data: runs, isLoading } = useAgentRuns(slug);

  if (isLoading) return <div className="h-20 bg-bg-elevated rounded animate-pulse mt-3" />;
  if (!runs || runs.length === 0) return <p className="text-xs text-text-tertiary mt-3">No runs recorded.</p>;

  return (
    <div className="mt-3 border-t border-border-subtle pt-3">
      <span className="text-[11px] font-semibold tracking-wide uppercase text-text-tertiary mb-2 block">Recent Runs</span>
      <div className="space-y-1">
        {runs.slice(0, 10).map((run: AgentRun) => (
          <div key={run.id} className="flex items-center gap-3 text-xs py-1">
            <StatusBadge status={run.status} size="sm" />
            <span className="text-text-tertiary tabular-nums">{new Date(run.started_at).toLocaleString()}</span>
            <span className="text-text-secondary">{run.trigger}</span>
            {run.cost_usd > 0 && <span className="text-text-tertiary">${parseFloat(String(run.cost_usd)).toFixed(4)}</span>}
            {run.error && <span className="text-error truncate max-w-[200px]">{run.error}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();

  const triggerMutation = useMutation({
    mutationFn: () => agentsApi.trigger(agent.slug),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });

  const toggleMutation = useMutation({
    mutationFn: () => agentsApi.toggle(agent.slug, agent.status === 'disabled' ? 'idle' : 'disabled'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });

  const budgetPct = agent.cost_budget_daily_usd
    ? Math.min(100, (agent.cost_spent_today_usd / agent.cost_budget_daily_usd) * 100)
    : 0;

  return (
    <div className="bg-bg-surface border border-border-default rounded-lg p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text-primary">{agent.name}</h3>
            <StatusBadge status={agent.status} />
          </div>
          <p className="text-xs text-text-tertiary mt-0.5">{agent.slug} &middot; {agent.agent_type} &middot; {agent.schedule || 'event_triggered'}</p>
        </div>
        <div className="flex gap-1">
          <button onClick={() => triggerMutation.mutate()} disabled={agent.status === 'disabled'}
            className="p-1.5 rounded hover:bg-bg-hover text-text-tertiary hover:text-accent disabled:opacity-30" title="Run now">
            <Play size={16} />
          </button>
          <button onClick={() => toggleMutation.mutate()}
            className={`text-xs px-2 py-1 rounded ${agent.status === 'disabled' ? 'text-success hover:bg-success/10' : 'text-warning hover:bg-warning/10'}`}>
            {agent.status === 'disabled' ? 'Enable' : 'Disable'}
          </button>
        </div>
      </div>

      {/* Last run */}
      {agent.last_run_at && (
        <div className="flex items-center gap-3 text-xs text-text-secondary mb-3">
          <span>Last: {new Date(agent.last_run_at).toLocaleString()}</span>
          {agent.last_run_status && <StatusBadge status={agent.last_run_status} size="sm" />}
          {agent.last_run_duration_ms && <span>{(agent.last_run_duration_ms / 1000).toFixed(1)}s</span>}
        </div>
      )}

      {/* Budget bar */}
      {agent.cost_budget_daily_usd && agent.cost_budget_daily_usd > 0 && (
        <div className="mb-3">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-text-tertiary">Budget</span>
            <span className="text-text-secondary">${agent.cost_spent_today_usd?.toFixed(4) || '0'} / ${agent.cost_budget_daily_usd.toFixed(4)}</span>
          </div>
          <div className="h-1.5 bg-bg-elevated rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${budgetPct > 80 ? 'bg-error' : budgetPct > 50 ? 'bg-warning' : 'bg-success'}`} style={{ width: `${budgetPct}%` }} />
          </div>
        </div>
      )}

      {/* Dependencies */}
      {agent.depends_on && agent.depends_on.length > 0 && (
        <div className="text-xs text-text-tertiary mb-2">
          Depends on: {agent.depends_on.length} agent(s)
        </div>
      )}

      <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-primary mt-1">
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {expanded ? 'Hide' : 'Show'} run history
      </button>

      {expanded && <RunHistory slug={agent.slug} />}
    </div>
  );
}

export default function Agents() {
  const { data: agents, isLoading } = useAgents();

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary tracking-tight mb-6">Agents</h1>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-40 bg-bg-surface rounded-lg animate-pulse" />)}
        </div>
      ) : !agents || agents.length === 0 ? (
        <EmptyState icon={<Bot size={24} />} title="No agents" description="No agents found in the database." />
      ) : (
        <div className="grid grid-cols-2 gap-4" data-testid="agents-grid">
          {agents.map((agent: Agent) => <AgentCard key={agent.id} agent={agent} />)}
        </div>
      )}
    </div>
  );
}
