import { useState } from 'react';
import { Plus, FileText } from 'lucide-react';
import { StatusBadge } from '../components/shared/StatusBadge';
import { EmptyState } from '../components/shared/EmptyState';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { strategyApi } from '../api/strategy';
import type { SystemDirective } from '../types';

const TYPES = ['content_mix', 'schedule', 'budget', 'format_priority', 'agent_config', 'custom'];

function CreateDirectiveForm({ onCreated }: { onCreated: () => void }) {
  const [directive, setDirective] = useState('');
  const [type, setType] = useState('custom');
  const [targetAgent, setTargetAgent] = useState('');
  const [priority, setPriority] = useState(5);

  const createMutation = useMutation({
    mutationFn: () => strategyApi.createDirective(directive, type, targetAgent || undefined, priority),
    onSuccess: () => { setDirective(''); onCreated(); },
  });

  return (
    <div className="bg-bg-surface border border-border-default rounded-lg p-5 mb-6">
      <h2 className="text-sm font-semibold text-text-primary mb-4">Create Directive</h2>
      <div className="space-y-3">
        <textarea
          value={directive}
          onChange={(e) => setDirective(e.target.value)}
          placeholder="e.g. Set content_mix parenting_insights to 30%"
          className="w-full bg-bg-input border border-border-default rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:ring-1 focus:ring-accent/30 resize-none"
          rows={2}
        />
        <div className="flex gap-3">
          <select value={type} onChange={(e) => setType(e.target.value)}
            className="bg-bg-input border border-border-default rounded-md px-3 py-1.5 text-sm text-text-primary">
            {TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
          <input
            value={targetAgent}
            onChange={(e) => setTargetAgent(e.target.value)}
            placeholder="Target agent (optional)"
            className="bg-bg-input border border-border-default rounded-md px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary flex-1"
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-tertiary">Priority:</span>
            <input type="number" min={1} max={10} value={priority} onChange={(e) => setPriority(Number(e.target.value))}
              className="w-16 bg-bg-input border border-border-default rounded-md px-2 py-1.5 text-sm text-text-primary text-center" />
          </div>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!directive.trim() || createMutation.isPending}
            className="flex items-center gap-1.5 bg-accent text-text-inverse text-sm font-medium px-4 py-1.5 rounded-md hover:bg-accent-hover disabled:opacity-50"
          >
            <Plus size={14} /> Create
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Directives() {
  const [tab, setTab] = useState('active');
  const qc = useQueryClient();
  const { data: directives, isLoading } = useQuery({
    queryKey: ['strategy', 'directives', tab],
    queryFn: () => strategyApi.directives(tab),
  });

  const pauseMutation = useMutation({
    mutationFn: (id: string) => strategyApi.updateDirective(id, 'paused'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['strategy', 'directives'] }),
  });

  const TABS = [
    { value: 'active', label: 'Active' },
    { value: 'pending', label: 'Pending' },
    { value: 'all', label: 'All' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary tracking-tight mb-6">System Directives</h1>

      <CreateDirectiveForm onCreated={() => qc.invalidateQueries({ queryKey: ['strategy', 'directives'] })} />

      <div className="flex gap-1 mb-4 bg-bg-surface rounded-lg p-1 w-fit border border-border-default">
        {TABS.map((t) => (
          <button key={t.value} onClick={() => setTab(t.value)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${tab === t.value ? 'bg-bg-active text-text-primary font-medium' : 'text-text-secondary hover:text-text-primary'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-bg-surface rounded-lg animate-pulse" />)}</div>
      ) : !directives || directives.length === 0 ? (
        <EmptyState icon={<FileText size={24} />} title="No directives" description="Create a directive to command the system." />
      ) : (
        <div className="bg-bg-surface border border-border-default rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_120px_120px_120px_80px] gap-2 px-4 py-2 border-b border-border-subtle">
            <span className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary">Directive</span>
            <span className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary">Type</span>
            <span className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary">Status</span>
            <span className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary">Applied</span>
            <span className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary">Actions</span>
          </div>
          {directives.map((d: SystemDirective) => (
            <div key={d.id} className="grid grid-cols-[1fr_120px_120px_120px_80px] gap-2 px-4 py-3 border-b border-border-subtle hover:bg-bg-hover items-center">
              <div>
                <p className="text-sm text-text-primary">{d.directive}</p>
                {d.target_agent && <span className="text-xs text-text-tertiary">Target: {d.target_agent}</span>}
              </div>
              <StatusBadge status={d.directive_type} label={d.directive_type.replace(/_/g, ' ')} />
              <StatusBadge status={d.status} />
              <span className="text-xs text-text-tertiary">{d.applied_at ? new Date(d.applied_at).toLocaleDateString() : '—'}</span>
              <div>
                {d.status === 'active' && (
                  <button onClick={() => pauseMutation.mutate(d.id)} className="text-xs text-warning hover:text-text-primary">Pause</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
