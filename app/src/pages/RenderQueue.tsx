import { useNavigate } from 'react-router-dom';
import { Film, Eye, RefreshCw } from 'lucide-react';
import { StatusBadge } from '../components/shared/StatusBadge';
import { PillarBadge } from '../components/shared/PillarBadge';
import { EmptyState } from '../components/shared/EmptyState';
import { useRenderQueue, useContentUpdate } from '../hooks/useContent';
import type { ContentItem } from '../types';

function RenderCard({ item }: { item: ContentItem }) {
  const navigate = useNavigate();
  const updateMutation = useContentUpdate();
  const rerender = () => updateMutation.mutate({ id: item.id, render_status: 'pending', render_error: null } as any);

  return (
    <div className="bg-bg-surface border border-border-default rounded-lg p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <button onClick={() => navigate(`/pipeline/${item.id}`)} className="text-sm font-medium text-text-primary hover:text-accent text-left truncate">
          {item.hook}
        </button>
        <StatusBadge status={item.render_status || 'pending'} />
      </div>
      <div className="flex items-center gap-2 mb-2">
        <PillarBadge pillar={item.content_pillar} />
        {item.render_profiles && (
          <span className="text-xs text-text-secondary">{item.render_profiles.name}</span>
        )}
      </div>
      {item.render_error && (
        <div className="bg-error/10 border border-error/20 rounded p-2 mb-2">
          <p className="text-xs text-error">{item.render_error}</p>
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-text-tertiary">
        <span>
          {item.render_started_at ? `Started: ${new Date(item.render_started_at).toLocaleTimeString()}` : 'Queued'}
        </span>
        <div className="flex gap-1">
          {(item.render_status === 'failed' || item.render_status === 'qa_failed' || item.render_status === 'blocked') && (
            <button onClick={rerender} className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-accent" title="Re-render">
              <RefreshCw size={14} />
            </button>
          )}
          <button onClick={() => navigate(`/pipeline/${item.id}`)} className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary" title="View">
            <Eye size={14} />
          </button>
        </div>
      </div>
      {item.render_cost_usd > 0 && (
        <div className="mt-1 text-xs text-text-tertiary">Cost: ${item.render_cost_usd.toFixed(4)}</div>
      )}
    </div>
  );
}

export default function RenderQueue() {
  const { data: items, isLoading } = useRenderQueue();

  const groups = {
    rendering: (items || []).filter((i: ContentItem) => i.render_status === 'rendering'),
    pending: (items || []).filter((i: ContentItem) => i.render_status === 'pending'),
    failed: (items || []).filter((i: ContentItem) => ['failed', 'qa_failed', 'blocked'].includes(i.render_status || '')),
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary tracking-tight mb-6">Render Queue</h1>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-48 bg-bg-surface rounded-lg animate-pulse" />)}
        </div>
      ) : !items || items.length === 0 ? (
        <EmptyState icon={<Film size={24} />} title="Render queue empty" description="No items are pending, rendering, or failed." />
      ) : (
        <div className="grid grid-cols-3 gap-6">
          {/* Pending */}
          <div>
            <h2 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-3">
              Pending <span className="text-text-tertiary">({groups.pending.length})</span>
            </h2>
            <div className="space-y-3">
              {groups.pending.map((item: ContentItem) => <RenderCard key={item.id} item={item} />)}
              {groups.pending.length === 0 && <p className="text-xs text-text-tertiary">None</p>}
            </div>
          </div>

          {/* Rendering */}
          <div>
            <h2 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-3">
              Rendering <span className="text-text-tertiary">({groups.rendering.length})</span>
            </h2>
            <div className="space-y-3">
              {groups.rendering.map((item: ContentItem) => <RenderCard key={item.id} item={item} />)}
              {groups.rendering.length === 0 && <p className="text-xs text-text-tertiary">None</p>}
            </div>
          </div>

          {/* Failed */}
          <div>
            <h2 className="text-[11px] font-semibold tracking-wide uppercase text-error mb-3">
              Failed / Blocked <span className="text-text-tertiary">({groups.failed.length})</span>
            </h2>
            <div className="space-y-3">
              {groups.failed.map((item: ContentItem) => <RenderCard key={item.id} item={item} />)}
              {groups.failed.length === 0 && <p className="text-xs text-text-tertiary">None</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
