const PILLAR_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  ai_magic: { bg: 'bg-indigo-500/15', text: 'text-indigo-400', label: 'AI Magic' },
  parenting_insights: { bg: 'bg-[var(--accent-muted)]', text: 'text-accent', label: 'Parenting' },
  tech_for_moms: { bg: 'bg-cyan-500/15', text: 'text-cyan-400', label: 'Tech' },
  mom_health: { bg: 'bg-pink-500/15', text: 'text-pink-400', label: 'Health' },
  trending: { bg: 'bg-amber-500/15', text: 'text-amber-400', label: 'Trending' },
};

export function PillarBadge({ pillar }: { pillar: string | null }) {
  if (!pillar) return null;
  const style = PILLAR_STYLES[pillar] || { bg: 'bg-bg-elevated', text: 'text-text-secondary', label: pillar };
  return (
    <span className={`${style.bg} ${style.text} text-[11px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full`}>
      {style.label}
    </span>
  );
}
