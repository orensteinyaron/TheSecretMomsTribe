// V1.1 taxonomy. Legacy V1.0 labels are kept so pre-migration rows still render
// during a partial rollout; both map to the same visual style.
const PILLAR_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  ai_magic:           { bg: 'bg-indigo-500/15',        text: 'text-indigo-400',     label: 'AI Magic' },
  parenting:          { bg: 'bg-[var(--accent-muted)]', text: 'text-accent',         label: 'Parenting' },
  parenting_insights: { bg: 'bg-[var(--accent-muted)]', text: 'text-accent',         label: 'Parenting' },
  tech:               { bg: 'bg-cyan-500/15',          text: 'text-cyan-400',       label: 'Tech' },
  tech_for_moms:      { bg: 'bg-cyan-500/15',          text: 'text-cyan-400',       label: 'Tech' },
  health:             { bg: 'bg-pink-500/15',          text: 'text-pink-400',       label: 'Health' },
  mom_health:         { bg: 'bg-pink-500/15',          text: 'text-pink-400',       label: 'Health' },
  trending:           { bg: 'bg-amber-500/15',         text: 'text-amber-400',      label: 'Trending' },
  financial:          { bg: 'bg-emerald-500/15',       text: 'text-emerald-400',    label: 'Financial' },
  uncategorized:      { bg: 'bg-bg-elevated',          text: 'text-text-tertiary',  label: 'Uncategorized' },
};

export function PillarBadge({ pillar }: { pillar: string | null }) {
  // Defensive: null is possible in stale caches; render the same muted fallback as 'uncategorized'
  // so rows never go blank and Yaron can spot-reclassify from the piece page.
  const key = pillar || 'uncategorized';
  const style = PILLAR_STYLES[key] || PILLAR_STYLES.uncategorized;
  return (
    <span className={`${style.bg} ${style.text} text-[11px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full`}>
      {style.label}
    </span>
  );
}
