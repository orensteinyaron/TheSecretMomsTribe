import { Settings as SettingsIcon, ExternalLink } from 'lucide-react';
import { StatusBadge } from '../components/shared/StatusBadge';
import { useServices } from '../hooks/useSystem';
import type { Service } from '../types';

const CADENCE_DEFAULTS = {
  tiktok: 3,
  instagram: 1,
};

const PILLAR_MIX = {
  ai_magic: 30,
  parenting_insights: 25,
  tech_for_moms: 20,
  mom_health: 15,
  trending: 10,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg-surface border border-border-default rounded-lg p-5 mb-6">
      <h2 className="text-sm font-semibold text-text-primary mb-4">{title}</h2>
      {children}
    </div>
  );
}

export default function Settings() {
  const { data: services } = useServices();

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary tracking-tight mb-6">Settings</h1>

      <Section title="Posting Cadence">
        <div className="space-y-3">
          {Object.entries(CADENCE_DEFAULTS).map(([platform, target]) => (
            <div key={platform} className="flex items-center justify-between">
              <span className="text-sm text-text-primary capitalize">{platform}</span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-secondary">{target} posts/day</span>
                <span className="text-xs text-text-tertiary">(configurable via directives)</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Content Mix Targets">
        <div className="space-y-2">
          {Object.entries(PILLAR_MIX).map(([pillar, pct]) => (
            <div key={pillar} className="flex items-center gap-3">
              <span className="text-sm text-text-primary w-40 capitalize">{pillar.replace(/_/g, ' ')}</span>
              <div className="flex-1 h-2 bg-bg-elevated rounded-full overflow-hidden">
                <div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-sm text-text-secondary w-10 text-right">{pct}%</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-text-tertiary mt-3">Adjust via System Directives (type: content_mix)</p>
      </Section>

      <Section title="API Connections">
        <div className="space-y-2">
          {(services || []).map((s: Service) => (
            <div key={s.id} className="flex items-center justify-between py-1.5">
              <div>
                <span className="text-sm text-text-primary">{s.name}</span>
                <span className="text-xs text-text-tertiary ml-2">({s.provider})</span>
              </div>
              <StatusBadge status={s.status} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Brand Voice">
        <div className="space-y-2">
          {['brand-voice.md', 'content-dna.md', 'visual-design.md'].map((file) => (
            <div key={file} className="flex items-center justify-between py-1">
              <span className="text-sm text-text-primary font-mono">/prompts/{file}</span>
              <span className="text-xs text-text-tertiary flex items-center gap-1"><ExternalLink size={12} /> Edit in repo</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="System Info">
        <dl className="space-y-2">
          {[
            ['Supabase Project', 'fvxaykkmzsbrggjgdfjj'],
            ['Region', 'ap-southeast-1'],
            ['Edge Functions', '5 deployed'],
            ['Agents', '7 registered'],
            ['Render Profiles', '4 (1 active)'],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between">
              <dt className="text-sm text-text-secondary">{label}</dt>
              <dd className="text-sm text-text-primary font-mono">{value}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}
