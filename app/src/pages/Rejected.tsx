import { useState } from 'react';
import { ShieldAlert, ChevronRight, ChevronDown } from 'lucide-react';
import { EmptyState } from '../components/shared/EmptyState';
import { useContentQueueRejected } from '../hooks/useSystem';

export default function Rejected() {
  const { data: rows, isLoading } = useContentQueueRejected();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary tracking-tight mb-2">Rejected rows</h1>
      <p className="text-sm text-text-tertiary mb-6">
        Every LLM output the gate validators bounced. Click a row to inspect the raw LLM output and briefing context.
      </p>

      {isLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-14 bg-bg-surface rounded-lg animate-pulse" />)}</div>
      ) : !rows || rows.length === 0 ? (
        <EmptyState
          icon={<ShieldAlert size={24} />}
          title="No rejections — gate validators are quiet"
          description="When the deterministic safety net rejects an LLM output, the raw row will surface here for forensic review."
        />
      ) : (
        <div className="bg-bg-surface border border-border-default rounded-lg overflow-hidden">
          <div className="grid grid-cols-[24px_160px_1fr_160px_120px] gap-2 px-4 py-2 border-b border-border-subtle">
            {['', 'Rejected at', 'Reason', 'Field', 'Signal'].map((h) => (
              <span key={h} className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary">{h}</span>
            ))}
          </div>
          {rows.map((row) => {
            const expanded = expandedId === row.id;
            return (
              <div key={row.id} className="border-b border-border-subtle">
                <button
                  onClick={() => setExpandedId(expanded ? null : row.id)}
                  className="w-full grid grid-cols-[24px_160px_1fr_160px_120px] gap-2 px-4 py-2.5 hover:bg-bg-hover items-center text-left"
                >
                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="text-xs text-text-tertiary tabular-nums">
                    {new Date(row.rejected_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-xs text-error truncate">{row.reason}</span>
                  <span className="text-xs text-text-secondary font-mono truncate">{row.field ?? '—'}</span>
                  <span className="text-xs text-text-tertiary font-mono truncate">{row.signal_id ? row.signal_id.slice(0, 8) + '…' : '—'}</span>
                </button>
                {expanded && (
                  <div className="px-6 py-4 bg-bg-elevated grid grid-cols-2 gap-6 text-xs">
                    <div>
                      <h4 className="text-[11px] font-semibold tracking-wide uppercase text-text-tertiary mb-2">Evidence</h4>
                      <pre className="text-[11px] whitespace-pre-wrap bg-bg-surface rounded p-3 max-h-48 overflow-auto">
                        {row.evidence ?? '(none)'}
                      </pre>
                    </div>
                    <div>
                      <h4 className="text-[11px] font-semibold tracking-wide uppercase text-text-tertiary mb-2">Briefing row</h4>
                      <pre className="text-[11px] whitespace-pre-wrap bg-bg-surface rounded p-3 max-h-48 overflow-auto">
                        {JSON.stringify(row.raw_briefing_row, null, 2)}
                      </pre>
                    </div>
                    <div className="col-span-2">
                      <h4 className="text-[11px] font-semibold tracking-wide uppercase text-text-tertiary mb-2">Raw LLM output</h4>
                      <pre className="text-[11px] whitespace-pre-wrap bg-bg-surface rounded p-3 max-h-64 overflow-auto">
                        {JSON.stringify(row.raw_llm_output, null, 2)}
                      </pre>
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
