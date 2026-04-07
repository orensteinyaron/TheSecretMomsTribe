import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, X, Eye, Search } from 'lucide-react';
import { StatusBadge } from '../components/shared/StatusBadge';
import { PillarBadge } from '../components/shared/PillarBadge';
import { PlatformIcon } from '../components/shared/PlatformIcon';
import { EmptyState } from '../components/shared/EmptyState';
import { RejectModal } from '../components/shared/RejectModal';
import { useContentList, useContentUpdate, useBulkApprove, useBulkReject } from '../hooks/useContent';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { contentApi } from '../api/content';
import { apiPost } from '../api/client';
import type { ContentItem } from '../types';

const TABS = [
  { value: 'all', label: 'All' },
  { value: 'review', label: 'Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

export default function Pipeline() {
  const [tab, setTab] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [rejectTarget, setRejectTarget] = useState<ContentItem | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: items, isLoading } = useContentList(tab);
  const { data: searchResults } = useQuery({
    queryKey: ['content', 'search', searchQuery],
    queryFn: () => contentApi.search(searchQuery),
    enabled: searchQuery.length >= 2,
  });
  const updateMutation = useContentUpdate();
  const bulkApproveMutation = useBulkApprove();
  const bulkRejectMutation = useBulkReject();
  const rejectWithFeedback = useMutation({
    mutationFn: async ({ id, category, description }: { id: string; category: string; description: string }) => {
      await contentApi.update(id, { status: 'rejected', rejection_reason: `${category}: ${description}`.trim() });
      await apiPost('content-queue', { action: 'feedback', content_queue_id: id, feedback_type: 'rejection', category, description });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['content'] }); },
  });

  const displayItems = searchQuery.length >= 2 ? searchResults : items;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!displayItems) return;
    if (selected.size === displayItems.length) setSelected(new Set());
    else setSelected(new Set(displayItems.map((i: ContentItem) => i.id)));
  };

  const approve = (id: string) => updateMutation.mutate({ id, status: 'approved' });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text-primary tracking-tight">Content Pipeline</h1>
        {selected.size > 0 && (
          <div className="flex gap-2">
            <button
              onClick={() => { bulkApproveMutation.mutate([...selected]); setSelected(new Set()); }}
              data-testid="bulk-approve"
              className="flex items-center gap-1.5 bg-success/20 text-success text-sm font-medium px-3 py-1.5 rounded-md hover:bg-success/30"
            >
              <Check size={14} /> Approve {selected.size}
            </button>
            <button
              onClick={() => { bulkRejectMutation.mutate({ ids: [...selected], reason: 'Bulk rejected' }); setSelected(new Set()); }}
              data-testid="bulk-reject"
              className="flex items-center gap-1.5 bg-error/20 text-error text-sm font-medium px-3 py-1.5 rounded-md hover:bg-error/30"
            >
              <X size={14} /> Reject {selected.size}
            </button>
          </div>
        )}
      </div>

      {/* Search bar */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search hooks, captions..."
          className="w-full max-w-md bg-bg-input border border-border-default rounded-md pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:ring-1 focus:ring-accent/30"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-bg-surface rounded-lg p-1 w-fit border border-border-default" data-testid="pipeline-tabs">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => { setTab(t.value); setSelected(new Set()); }}
            data-testid={`tab-${t.value}`}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              tab === t.value ? 'bg-bg-active text-text-primary font-medium' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 bg-bg-surface rounded-lg animate-pulse" />
          ))}
        </div>
      ) : !displayItems || displayItems.length === 0 ? (
        <EmptyState title="No content" description={`No ${tab === 'all' ? '' : tab} items found.`} />
      ) : (
        <div className="bg-bg-surface border border-border-default rounded-lg overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[36px_1fr_80px_90px_90px_80px_80px] gap-2 px-4 py-2 border-b border-border-subtle" data-testid="pipeline-header">
            <label className="flex items-center">
              <input type="checkbox" checked={selected.size === (displayItems || []).length && (displayItems || []).length > 0} onChange={toggleAll} className="accent-accent" />
            </label>
            <span className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary">Hook</span>
            <span className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary">Platform</span>
            <span className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary">Pillar</span>
            <span className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary">Status</span>
            <span className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary">Render</span>
            <span className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary">Actions</span>
          </div>

          {/* Rows */}
          {(displayItems || []).map((item: ContentItem) => (
            <div
              key={item.id}
              className={`grid grid-cols-[36px_1fr_80px_90px_90px_80px_80px] gap-2 px-4 py-3 border-b border-border-subtle hover:bg-bg-hover transition-colors items-center ${
                selected.has(item.id) ? 'bg-bg-active' : ''
              }`}
            >
              <label className="flex items-center">
                <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelect(item.id)} className="accent-accent" />
              </label>
              <button onClick={() => navigate(`/pipeline/${item.id}`)} className="text-sm text-text-primary hover:text-accent truncate text-left">
                {item.hook}
              </button>
              <div className="flex items-center gap-1.5">
                <PlatformIcon platform={item.platform} />
                <span className="text-xs text-text-secondary capitalize">{item.platform}</span>
              </div>
              <PillarBadge pillar={item.content_pillar} />
              <StatusBadge status={item.status} />
              {item.render_status && item.render_status !== 'pending' ? (
                <StatusBadge status={item.render_status} />
              ) : (
                <span className="text-xs text-text-tertiary">—</span>
              )}
              <div className="flex gap-1">
                {(item.status === 'draft' || item.status === 'pending_approval') && (
                  <>
                    <button onClick={() => approve(item.id)} className="p-1 rounded hover:bg-success/20 text-text-tertiary hover:text-success" title="Approve">
                      <Check size={16} />
                    </button>
                    <button onClick={() => setRejectTarget(item)} className="p-1 rounded hover:bg-error/20 text-text-tertiary hover:text-error" title="Reject">
                      <X size={16} />
                    </button>
                  </>
                )}
                <button onClick={() => navigate(`/pipeline/${item.id}`)} className="p-1 rounded hover:bg-bg-elevated text-text-tertiary hover:text-text-primary" title="View">
                  <Eye size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reject Modal */}
      {rejectTarget && (
        <RejectModal
          hookPreview={rejectTarget.hook}
          onCancel={() => setRejectTarget(null)}
          onConfirm={(category, description) => {
            rejectWithFeedback.mutate({ id: rejectTarget.id, category, description });
            setRejectTarget(null);
          }}
        />
      )}
    </div>
  );
}
