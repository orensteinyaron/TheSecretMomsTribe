import { useState } from 'react';
import { ChevronDown, ChevronUp, CheckCircle2, Clock, XCircle, AlertTriangle, Zap } from 'lucide-react';
import { usePipelineHealth } from '../hooks/useSystem';
import type { PipelineHealth } from '../types';

const STATUS_COPY: Record<string, { label: string; color: string; Icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  on_time: { label: 'On time',  color: 'text-success', Icon: CheckCircle2 },
  late:    { label: 'Late',     color: 'text-warning', Icon: Clock },
  pending: { label: 'Pending',  color: 'text-text-tertiary', Icon: Clock },
  running: { label: 'Running',  color: 'text-accent',  Icon: Zap },
  missed:  { label: 'Missed',   color: 'text-error',   Icon: XCircle },
  failed:  { label: 'Failed',   color: 'text-error',   Icon: AlertTriangle },
};

function Dot({ state }: { state: PipelineHealth['state'] }) {
  const cls = state === 'green'
    ? 'bg-success'
    : state === 'yellow'
      ? 'bg-warning'
      : 'bg-error';
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${cls}`} aria-hidden />;
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return new Date(iso).toLocaleDateString();
}

function Headline({ data }: { data: PipelineHealth }) {
  const { state, counts, orchestrator } = data;
  const total = counts.total;
  if (state === 'green') {
    return (
      <>Pipeline healthy — <span className="text-text-primary font-medium">{counts.on_time}/{total}</span> on-time today · orchestrator {formatRelative(orchestrator.last_tick)}</>
    );
  }
  if (state === 'yellow') {
    const lateN = counts.late;
    const silentH = orchestrator.silent_hours;
    if (silentH !== null && orchestrator.silent) {
      return <>Orchestrator silent <span className="text-text-primary font-medium">{silentH.toFixed(1)}h</span> — pipeline may stall</>;
    }
    if (lateN > 0) {
      return <>Pipeline self-healed — <span className="text-text-primary font-medium">{counts.on_time}/{total}</span> on time, <span className="text-warning font-medium">{lateN} late</span></>;
    }
    return <>Pipeline degraded — <span className="text-text-primary font-medium">{counts.on_time}/{total}</span> on time</>;
  }
  return (
    <>Pipeline failing — <span className="text-error font-medium">{counts.missed} missed</span>, orchestrator {formatRelative(orchestrator.last_tick)}</>
  );
}

function AgentRow({ row }: { row: PipelineHealth['rows'][number] }) {
  const copy = STATUS_COPY[row.status] ?? STATUS_COPY.pending;
  const { Icon, label, color } = copy;
  return (
    <tr className="border-t border-border-default">
      <td className="py-2 pr-4 text-sm text-text-primary font-medium">{row.name}</td>
      <td className="py-2 pr-4 text-xs text-text-tertiary tabular-nums">{formatRelative(row.started_at)}</td>
      <td className="py-2 pr-4 text-xs text-text-tertiary tabular-nums">deadline {row.deadline_utc} UTC</td>
      <td className="py-2">
        <span className={`inline-flex items-center gap-1 text-xs font-medium ${color}`}>
          <Icon size={12} />
          {label}
        </span>
      </td>
    </tr>
  );
}

export function PipelineHealthStrip() {
  const { data, isLoading, error } = usePipelineHealth();
  const [open, setOpen] = useState(false);

  if (isLoading || !data) {
    return (
      <div className="mb-6 rounded-lg border border-border-default bg-bg-surface px-4 py-3">
        <span className="text-sm text-text-tertiary">Loading pipeline health…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mb-6 rounded-lg border border-error/40 bg-error/5 px-4 py-3 text-sm text-error">
        Pipeline health unavailable: {String((error as Error).message)}
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-lg border border-border-default bg-bg-surface" data-testid="pipeline-health-strip">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-bg-hover transition-colors rounded-lg"
        aria-expanded={open}
        aria-controls="pipeline-health-detail"
      >
        <span className="flex items-center gap-3 text-sm text-text-secondary">
          <Dot state={data.state} />
          <Headline data={data} />
        </span>
        <span className="flex items-center gap-2 text-xs text-text-tertiary">
          {open ? 'Hide' : 'Details'}
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {open && (
        <div id="pipeline-health-detail" className="border-t border-border-default px-4 py-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-text-tertiary">
                <th className="pb-2 pr-4 text-left font-semibold">Agent</th>
                <th className="pb-2 pr-4 text-left font-semibold">Last run</th>
                <th className="pb-2 pr-4 text-left font-semibold">SLA</th>
                <th className="pb-2 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => <AgentRow key={r.slug} row={r} />)}
            </tbody>
          </table>

          <div className="mt-4 flex items-center gap-4 text-xs text-text-tertiary">
            <span>Orchestrator last tick: <span className="text-text-secondary">{formatRelative(data.orchestrator.last_tick)}</span></span>
            <span>Monitor last run: <span className="text-text-secondary">{formatRelative(data.monitor.last_run_at)}</span></span>
          </div>

          {data.alerts.length > 0 && (
            <div className="mt-4">
              <div className="text-[10px] uppercase tracking-wide text-text-tertiary mb-2">Today's alerts</div>
              <ul className="space-y-1.5">
                {data.alerts.map((a) => (
                  <li key={a.id} className="flex items-start gap-2 text-xs text-text-secondary">
                    <AlertTriangle size={12} className="text-error mt-0.5 shrink-0" />
                    <div>
                      <div className="text-text-primary">{a.title}</div>
                      <div className="text-text-tertiary">{a.description}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
