import { Plug } from 'lucide-react';
import { StatusBadge } from '../components/shared/StatusBadge';
import { EmptyState } from '../components/shared/EmptyState';
import { useServices } from '../hooks/useSystem';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { systemApi } from '../api/system';
import type { Service } from '../types';

export default function Services() {
  const { data: services, isLoading } = useServices();
  const qc = useQueryClient();

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => systemApi.updateService(id, { status } as any),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['system', 'services'] }),
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary tracking-tight mb-6">Services</h1>

      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-bg-surface rounded-lg animate-pulse" />)}</div>
      ) : !services || services.length === 0 ? (
        <EmptyState icon={<Plug size={24} />} title="No services" description="No services registered." />
      ) : (
        <div className="bg-bg-surface border border-border-default rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_100px_100px_80px_100px_100px_80px] gap-2 px-4 py-2 border-b border-border-subtle">
            {['Name', 'Type', 'Provider', 'Status', 'Cost', 'Fallback', 'Actions'].map((h) => (
              <span key={h} className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary">{h}</span>
            ))}
          </div>
          {services.map((s: Service) => (
            <div key={s.id} className="grid grid-cols-[1fr_100px_100px_80px_100px_100px_80px] gap-2 px-4 py-3 border-b border-border-subtle hover:bg-bg-hover items-center">
              <div>
                <p className="text-sm text-text-primary">{s.name}</p>
                <p className="text-xs text-text-tertiary">{s.slug}</p>
              </div>
              <span className="text-xs text-text-secondary capitalize">{s.service_type}</span>
              <span className="text-xs text-text-secondary capitalize">{s.provider}</span>
              <StatusBadge status={s.status} />
              <span className="text-xs text-text-secondary tabular-nums">
                {s.cost_per_unit != null ? `$${Number(s.cost_per_unit).toFixed(4)}` : '—'}
                {s.cost_unit ? ` / ${s.cost_unit.replace('per_', '')}` : ''}
              </span>
              <span className="text-xs text-text-tertiary">{s.fallback_service_id ? 'Yes' : '—'}</span>
              <div>
                {s.status === 'active' ? (
                  <button onClick={() => toggleMutation.mutate({ id: s.id, status: 'disabled' })} className="text-xs text-warning hover:text-text-primary">Disable</button>
                ) : s.status === 'disabled' ? (
                  <button onClick={() => toggleMutation.mutate({ id: s.id, status: 'active' })} className="text-xs text-success hover:text-text-primary">Enable</button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
