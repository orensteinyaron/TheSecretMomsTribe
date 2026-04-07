import { Clapperboard } from 'lucide-react';
import { StatusBadge } from '../components/shared/StatusBadge';
import { EmptyState } from '../components/shared/EmptyState';
import { useRenderProfiles, useServices } from '../hooks/useSystem';
import type { RenderProfile, Service } from '../types';

function ProfileCard({ profile, serviceMap }: { profile: RenderProfile; serviceMap: Record<string, Service> }) {
  return (
    <div className="bg-bg-surface border border-border-default rounded-lg p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{profile.name}</h3>
          <p className="text-xs text-text-tertiary">{profile.slug} v{profile.version}</p>
        </div>
        <div className="flex gap-1.5">
          <StatusBadge status={profile.status} />
          <StatusBadge status={profile.profile_type} label={profile.profile_type} />
        </div>
      </div>

      {/* Required services with health indicators */}
      <div className="mb-3">
        <span className="text-[11px] font-semibold tracking-wide uppercase text-text-tertiary">Required Services</span>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {profile.required_services.map((slug) => {
            const svc = serviceMap[slug];
            const isActive = svc?.status === 'active';
            return (
              <span key={slug} className={`text-xs px-2 py-0.5 rounded-full ${isActive ? 'bg-[var(--success-muted)] text-success' : 'bg-[var(--error-muted)] text-error'}`}>
                {slug} {isActive ? '' : `(${svc?.status || 'missing'})`}
              </span>
            );
          })}
        </div>
      </div>

      {/* Pipeline steps */}
      {profile.pipeline_steps && profile.pipeline_steps.length > 0 && (
        <div className="mb-3">
          <span className="text-[11px] font-semibold tracking-wide uppercase text-text-tertiary">Pipeline ({profile.pipeline_steps.length} steps)</span>
          <div className="flex items-center gap-1 mt-1.5 overflow-x-auto">
            {profile.pipeline_steps.map((step: any, i: number) => (
              <div key={i} className="flex items-center gap-1 shrink-0">
                {i > 0 && <span className="text-text-tertiary text-xs">&rarr;</span>}
                <span className="text-xs bg-bg-elevated px-2 py-0.5 rounded text-text-secondary">{step.step || step.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cost */}
      {profile.cost_estimate_usd != null && (
        <div className="text-xs text-text-tertiary">
          Est. cost: <span className="text-text-primary font-medium">${Number(profile.cost_estimate_usd).toFixed(4)}</span>/unit
        </div>
      )}
    </div>
  );
}

export default function RenderProfiles() {
  const { data: profiles, isLoading } = useRenderProfiles();
  const { data: services } = useServices();

  const serviceMap: Record<string, Service> = {};
  for (const s of services || []) serviceMap[s.slug] = s;

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary tracking-tight mb-6">Render Profiles</h1>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-40 bg-bg-surface rounded-lg animate-pulse" />)}
        </div>
      ) : !profiles || profiles.length === 0 ? (
        <EmptyState icon={<Clapperboard size={24} />} title="No profiles" description="No render profiles found." />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {profiles.map((p: RenderProfile) => <ProfileCard key={p.id} profile={p} serviceMap={serviceMap} />)}
        </div>
      )}
    </div>
  );
}
