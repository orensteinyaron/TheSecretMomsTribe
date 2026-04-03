const PILLAR_COLORS = {
  ai_magic: '#63246a',
  parenting_insights: '#b74780',
  tech_for_moms: '#63246a',
  mom_health: '#7d3585',
  trending: '#b74780',
};

const PILLAR_LABELS = {
  ai_magic: 'AI Magic',
  parenting_insights: 'Parenting',
  tech_for_moms: 'Tech',
  mom_health: 'Health',
  trending: 'Trending',
};

const AGE_LABELS = {
  toddler: '1-3y',
  little_kid: '4-7y',
  school_age: '8-12y',
  teen: '13-16y',
  universal: 'All',
};

const FORMAT_LABELS = {
  tiktok_slideshow: 'Slideshow',
  tiktok_text: 'Text',
  ig_carousel: 'Carousel',
  ig_static: 'Static',
  ig_meme: 'Meme',
  video_script: 'Video',
};

export function PlatformBadge({ platform }) {
  const cls = platform === 'instagram' ? 'badge-platform-instagram' : 'badge-platform-tiktok';
  const label = platform === 'instagram' ? 'IG' : 'TT';
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function PillarBadge({ pillar }) {
  if (!pillar) return null;
  const bg = PILLAR_COLORS[pillar] || 'var(--text-muted)';
  return (
    <span className="badge badge-pillar" style={{ background: bg }}>
      {PILLAR_LABELS[pillar] || pillar}
    </span>
  );
}

export function TypeBadge({ type }) {
  if (!type) return null;
  const cls = `badge-type-${type}`;
  return <span className={`badge ${cls}`}>{type.toUpperCase()}</span>;
}

export function AgeBadge({ age }) {
  if (!age) return null;
  return <span className="badge badge-age">{AGE_LABELS[age] || age}</span>;
}

export function FormatBadge({ format }) {
  if (!format) return null;
  return <span className="badge badge-format">{FORMAT_LABELS[format] || format}</span>;
}

export function ImageStatusBadge({ status }) {
  if (!status || status === 'not_needed') return null;
  const cls = `badge-image-${status}`;
  return <span className={`badge ${cls}`}>{status}</span>;
}
