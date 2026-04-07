import { useState } from 'react';
import { Telescope, ExternalLink } from 'lucide-react';
import { StatusBadge } from '../components/shared/StatusBadge';
import { PillarBadge } from '../components/shared/PillarBadge';
import { EmptyState } from '../components/shared/EmptyState';
import { useQuery } from '@tanstack/react-query';
import { strategyApi } from '../api/strategy';
import type { DailyBriefing, BriefingOpportunity } from '../types';

function OpportunityCard({ opp, index }: { opp: BriefingOpportunity; index: number }) {
  return (
    <div className="bg-bg-surface border border-border-default rounded-lg p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-text-tertiary bg-bg-elevated px-2 py-0.5 rounded">#{opp.priority || index + 1}</span>
          <h3 className="text-sm font-semibold text-text-primary">{opp.topic}</h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <PillarBadge pillar={opp.category} />
          <StatusBadge status={opp.content_type} label={opp.content_type} />
        </div>
      </div>

      <p className="text-sm text-text-secondary mb-3">{opp.angle}</p>

      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-text-tertiary uppercase tracking-wide">Platform:</span>
          <span className="text-xs text-text-primary capitalize">{opp.platform_fit}</span>
        </div>
        {opp.age_range && (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-text-tertiary uppercase tracking-wide">Age:</span>
            <span className="text-xs text-text-primary capitalize">{opp.age_range?.replace(/_/g, ' ')}</span>
          </div>
        )}
        {opp.recommended_format && (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-text-tertiary uppercase tracking-wide">Format:</span>
            <span className="text-xs text-accent font-medium">{opp.recommended_format}</span>
          </div>
        )}
      </div>

      {/* Signal strength bar */}
      {opp.signal_strength && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-text-tertiary uppercase tracking-wide">Signal Strength</span>
            <span className="text-xs text-text-primary font-medium">{opp.signal_strength}/10</span>
          </div>
          <div className="h-1.5 bg-bg-elevated rounded-full overflow-hidden">
            <div className="h-full bg-accent rounded-full" style={{ width: `${(opp.signal_strength / 10) * 100}%` }} />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-text-tertiary">
        <span>Source: {opp.source}</span>
        {opp.source_url && (
          <a href={opp.source_url} target="_blank" rel="noopener" className="flex items-center gap-1 text-accent hover:text-accent-hover">
            <ExternalLink size={12} /> View source
          </a>
        )}
      </div>

      {opp.reasoning && (
        <p className="text-xs text-text-tertiary mt-2 italic">{opp.reasoning}</p>
      )}

      <div className="mt-3">
        <span className="text-xs text-text-secondary">Hook: </span>
        <span className="text-sm text-text-primary font-medium">"{opp.suggested_hook}"</span>
      </div>
    </div>
  );
}

export default function Research() {
  const [dateOffset, setDateOffset] = useState(0);
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - dateOffset);
  const dateStr = targetDate.toISOString().split('T')[0];

  const { data: briefing, isLoading } = useQuery({
    queryKey: ['strategy', 'briefing', dateStr],
    queryFn: () => strategyApi.briefing(dateStr),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text-primary tracking-tight">Research Briefings</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setDateOffset((d) => d + 1)} className="px-3 py-1.5 text-sm bg-bg-surface border border-border-default rounded-md hover:bg-bg-hover text-text-secondary">
            Previous
          </button>
          <span className="text-sm text-text-primary font-medium px-3">{dateStr}</span>
          <button onClick={() => setDateOffset((d) => Math.max(0, d - 1))} disabled={dateOffset === 0}
            className="px-3 py-1.5 text-sm bg-bg-surface border border-border-default rounded-md hover:bg-bg-hover text-text-secondary disabled:opacity-40">
            Next
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-40 bg-bg-surface rounded-lg animate-pulse" />)}
        </div>
      ) : !briefing || !briefing.opportunities || briefing.opportunities.length === 0 ? (
        <EmptyState icon={<Telescope size={24} />} title="No briefing for this date" description="The research agent hasn't run for this date, or no opportunities were found." />
      ) : (
        <>
          <div className="bg-bg-surface border border-border-default rounded-lg p-4 mb-6">
            <div className="flex items-center gap-4 text-sm">
              <span className="text-text-secondary">Date: <strong className="text-text-primary">{briefing.briefing_date}</strong></span>
              <span className="text-text-secondary">Opportunities: <strong className="text-text-primary">{briefing.opportunities.length}</strong></span>
              {briefing.sources && (
                <span className="text-text-secondary">
                  Sources: {Object.entries(briefing.sources).map(([k, v]: [string, any]) => `${k}: ${v.status}`).join(', ')}
                </span>
              )}
            </div>
          </div>
          <div className="space-y-3">
            {briefing.opportunities.map((opp: BriefingOpportunity, i: number) => (
              <OpportunityCard key={i} opp={opp} index={i} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
