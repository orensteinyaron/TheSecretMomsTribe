import { useState } from 'react';
import { Activity, ChevronRight, ChevronDown } from 'lucide-react';
import { EmptyState } from '../components/shared/EmptyState';
import { usePipelineRuns } from '../hooks/useSystem';
import type { PipelineRun } from '../types';

const STATUS_COLOR: Record<PipelineRun['status'], string> = {
  in_progress: 'text-accent',
  completed:   'text-success',
  partial:     'text-warning',
  failed:      'text-error',
  escalated:   'text-error',
  timeout:     'text-warning',
};

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return '…';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export default function PipelineRuns() {
  const { data: runs, isLoading } = usePipelineRuns();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary tracking-tight mb-2">Pipeline runs</h1>
      <p className="text-sm text-text-tertiary mb-6">
        Every orchestrator invocation. Click a row to see stages, pre-flight checks, and escalations.
      </p>

      {isLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-14 bg-bg-surface rounded-lg animate-pulse" />)}</div>
      ) : !runs || runs.length === 0 ? (
        <EmptyState
          icon={<Activity size={24} />}
          title="No pipeline runs yet"
          description="When the orchestrator runs, each invocation will appear here with full stage chain."
        />
      ) : (
        <div className="bg-bg-surface border border-border-default rounded-lg overflow-hidden">
          <div className="grid grid-cols-[24px_140px_120px_120px_100px_1fr_100px] gap-2 px-4 py-2 border-b border-border-subtle">
            {['', 'Started', 'Mode', 'Status', 'Duration', 'Next action', 'Escal.'].map((h) => (
              <span key={h} className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary">{h}</span>
            ))}
          </div>
          {runs.map((run) => {
            const expanded = expandedId === run.id;
            return (
              <div key={run.id} className="border-b border-border-subtle">
                <button
                  onClick={() => setExpandedId(expanded ? null : run.id)}
                  className="w-full grid grid-cols-[24px_140px_120px_120px_100px_1fr_100px] gap-2 px-4 py-2.5 hover:bg-bg-hover items-center text-left"
                >
                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="text-xs text-text-tertiary tabular-nums">
                    {new Date(run.started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-xs text-text-primary font-medium">{run.mode}</span>
                  <span className={`text-xs font-semibold ${STATUS_COLOR[run.status]}`}>{run.status}</span>
                  <span className="text-xs text-text-secondary tabular-nums">{formatDuration(run.started_at, run.completed_at)}</span>
                  <span className="text-xs text-text-secondary truncate">{run.next_action ?? '—'}</span>
                  <span className="text-xs text-text-tertiary tabular-nums">{run.escalations?.length ?? 0}</span>
                </button>
                {expanded && (
                  <div className="px-6 py-4 bg-bg-elevated grid grid-cols-2 gap-6 text-xs">
                    <div>
                      <h4 className="text-[11px] font-semibold tracking-wide uppercase text-text-tertiary mb-2">Stages</h4>
                      <pre className="text-[11px] whitespace-pre-wrap bg-bg-surface rounded p-3 max-h-64 overflow-auto">
                        {JSON.stringify(run.stages || [], null, 2)}
                      </pre>
                    </div>
                    <div>
                      <h4 className="text-[11px] font-semibold tracking-wide uppercase text-text-tertiary mb-2">Pre-flight</h4>
                      <pre className="text-[11px] whitespace-pre-wrap bg-bg-surface rounded p-3 max-h-64 overflow-auto">
                        {JSON.stringify(run.pre_flight || {}, null, 2)}
                      </pre>
                    </div>
                    <div className="col-span-2">
                      <h4 className="text-[11px] font-semibold tracking-wide uppercase text-text-tertiary mb-2">Escalations</h4>
                      {(run.escalations || []).length === 0 ? (
                        <span className="italic text-text-tertiary">none</span>
                      ) : (
                        <pre className="text-[11px] whitespace-pre-wrap bg-bg-surface rounded p-3 max-h-64 overflow-auto">
                          {JSON.stringify(run.escalations, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
