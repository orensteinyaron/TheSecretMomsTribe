import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, X, RefreshCw, ExternalLink } from 'lucide-react';
import { StatusBadge } from '../components/shared/StatusBadge';
import { PillarBadge } from '../components/shared/PillarBadge';
import { PlatformIcon } from '../components/shared/PlatformIcon';
import { EditableField } from '../components/shared/EditableField';
import { useContentDetail, useContentUpdate } from '../hooks/useContent';
import { contentApi } from '../api/content';
import { useQueryClient, useMutation } from '@tanstack/react-query';

export default function ContentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: item, isLoading } = useContentDetail(id!);
  const updateMutation = useContentUpdate();
  const renderMutation = useMutation({
    mutationFn: (contentId: string) => contentApi.triggerRender(contentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['content'] }),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 bg-bg-surface rounded animate-pulse" />
        <div className="h-64 bg-bg-surface rounded-lg animate-pulse" />
      </div>
    );
  }

  if (!item) {
    return <div className="text-text-secondary">Content not found.</div>;
  }

  const approve = () => updateMutation.mutate({ id: item.id, status: 'approved' });
  const reject = () => updateMutation.mutate({ id: item.id, status: 'rejected' });
  const triggerRender = () => renderMutation.mutate(item.id);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/pipeline')} className="p-1.5 rounded-md hover:bg-bg-hover text-text-secondary">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-text-primary tracking-tight truncate">{item.hook}</h1>
          <div className="flex items-center gap-2 mt-1">
            <PlatformIcon platform={item.platform} />
            <PillarBadge pillar={item.content_pillar} />
            <StatusBadge status={item.status} />
            {item.render_status && <StatusBadge status={item.render_status} />}
            <span className="text-xs text-text-tertiary">{new Date(item.created_at).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {(item.status === 'draft' || item.status === 'pending_approval') && (
            <>
              <button onClick={approve} className="flex items-center gap-1.5 bg-accent text-text-inverse text-sm font-medium px-4 py-2 rounded-md hover:bg-accent-hover">
                <Check size={16} /> Approve
              </button>
              <button onClick={reject} className="flex items-center gap-1.5 bg-bg-elevated text-error text-sm font-medium px-4 py-2 rounded-md border border-error/30 hover:bg-error/10">
                <X size={16} /> Reject
              </button>
            </>
          )}
          {item.status === 'approved' && item.render_status === 'rendering' && (
            <span className="flex items-center gap-1.5 text-accent text-sm font-medium px-4 py-2">
              <RefreshCw size={16} className="animate-spin" /> Rendering...
            </span>
          )}
          {item.status === 'approved' && item.render_status === 'pending' && (
            <span className="flex items-center gap-1.5 text-warning text-sm font-medium px-4 py-2">
              <RefreshCw size={16} /> Queued for render
            </span>
          )}
          {item.status === 'approved' && !['rendering', 'pending'].includes(item.render_status || '') && (
            <button
              onClick={triggerRender}
              disabled={renderMutation.isPending}
              className="flex items-center gap-1.5 bg-bg-elevated text-text-primary text-sm font-medium px-4 py-2 rounded-md border border-border-default hover:bg-bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw size={16} className={renderMutation.isPending ? 'animate-spin' : ''} />
              {renderMutation.isPending ? 'Queuing...' : item.render_status === 'complete' ? 'Re-render' : 'Render'}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Content */}
        <div className="col-span-2 space-y-6">
          {/* Hook */}
          <div className="bg-bg-surface border border-border-default rounded-lg p-6">
            <h3 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-2">Hook</h3>
            <EditableField
              value={item.hook}
              onSave={(v) => updateMutation.mutate({ id: item.id, hook: v })}
              className="text-lg font-semibold text-text-primary"
            />
          </div>

          {/* Slides */}
          {item.slides && item.slides.length > 0 && (
            <div className="bg-bg-surface border border-border-default rounded-lg p-6">
              <h3 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-3">Slides ({item.slides.length})</h3>
              <div className="space-y-3">
                {item.slides.map((slide, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <span className="text-xs font-bold text-text-tertiary bg-bg-elevated px-2 py-0.5 rounded mt-0.5">{i + 1}</span>
                    <div>
                      <p className="text-sm text-text-primary">{slide.text}</p>
                      <span className="text-[11px] text-text-tertiary uppercase">{slide.type}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Caption */}
          <div className="bg-bg-surface border border-border-default rounded-lg p-6">
            <h3 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-2">Caption</h3>
            <EditableField
              value={item.caption}
              onSave={(v) => updateMutation.mutate({ id: item.id, caption: v })}
              multiline
              className="text-sm text-text-primary whitespace-pre-line"
            />
          </div>

          {/* Hashtags */}
          <div className="bg-bg-surface border border-border-default rounded-lg p-6">
            <h3 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-2">Hashtags</h3>
            <div className="flex flex-wrap gap-1.5">
              {item.hashtags?.map((tag, i) => (
                <span key={i} className="text-xs bg-bg-elevated text-info px-2 py-0.5 rounded-full">{tag}</span>
              ))}
            </div>
          </div>

          {/* AI Magic Output */}
          {item.ai_magic_output && (
            <div className="bg-bg-surface border border-border-default rounded-lg p-6">
              <h3 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-2">AI Magic Output</h3>
              <p className="text-sm text-text-primary whitespace-pre-line">{item.ai_magic_output}</p>
            </div>
          )}
        </div>

        {/* Right: Metadata + Render */}
        <div className="space-y-6">
          {/* Metadata */}
          <div className="bg-bg-surface border border-border-default rounded-lg p-6">
            <h3 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-3">Details</h3>
            <dl className="space-y-3">
              {[
                ['Platform', item.platform],
                ['Format', item.post_format],
                ['Age Range', item.age_range],
                ['Content Type', item.content_type],
                ['Created', new Date(item.created_at).toLocaleString()],
              ].map(([label, val]) => (
                <div key={label as string}>
                  <dt className="text-xs text-text-tertiary">{label}</dt>
                  <dd className="text-sm text-text-primary capitalize">{(val as string)?.replace(/_/g, ' ') || '—'}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Render Info */}
          <div className="bg-bg-surface border border-border-default rounded-lg p-6">
            <h3 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-3">Render</h3>
            <dl className="space-y-3">
              <div>
                <dt className="text-xs text-text-tertiary">Status</dt>
                <dd>{item.render_status ? <StatusBadge status={item.render_status} /> : <span className="text-sm text-text-tertiary">Not assigned</span>}</dd>
              </div>
              {item.render_profiles && (
                <div>
                  <dt className="text-xs text-text-tertiary">Profile</dt>
                  <dd className="text-sm text-text-primary">{item.render_profiles.name}</dd>
                </div>
              )}
              {item.render_cost_usd > 0 && (
                <div>
                  <dt className="text-xs text-text-tertiary">Cost</dt>
                  <dd className="text-sm text-text-primary">${item.render_cost_usd.toFixed(4)}</dd>
                </div>
              )}
              {item.render_error && (
                <div>
                  <dt className="text-xs text-text-tertiary">Error</dt>
                  <dd className="text-sm text-error">{item.render_error}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Rendered Asset */}
          {item.final_asset_url && (
            <div className="bg-bg-surface border border-border-default rounded-lg p-6">
              <h3 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-3">Rendered Asset</h3>
              {item.final_asset_url.endsWith('.mp4') ? (
                <video src={item.final_asset_url} controls className="w-full rounded-md" />
              ) : (
                <img src={item.final_asset_url} alt="Rendered" className="w-full rounded-md" />
              )}
              <a href={item.final_asset_url} target="_blank" rel="noopener" className="flex items-center gap-1 text-xs text-accent mt-2 hover:text-accent-hover">
                <ExternalLink size={12} /> Open in new tab
              </a>
            </div>
          )}

          {/* Rejection */}
          {item.rejection_reason && (
            <div className="bg-bg-surface border border-error/30 rounded-lg p-6">
              <h3 className="text-[11px] font-semibold tracking-wide uppercase text-error mb-2">Rejection Reason</h3>
              <p className="text-sm text-text-primary">{item.rejection_reason}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
