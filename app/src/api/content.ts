import { apiFetch, apiPost, apiPatch } from './client';
import type {
  ContentItem,
  PiecePagePayload,
  PromptExecution,
  MetricSnapshot,
  ContentPillar,
  Channel,
  ScheduledPost,
  ScheduledPostStatus,
} from '../types';

const API_BASE = 'https://fvxaykkmzsbrggjgdfjj.supabase.co/functions/v1';

async function piecePath<T>(path: string, method = 'GET', body?: any): Promise<T> {
  const res = await fetch(`${API_BASE}/content-queue${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

export const contentApi = {
  // Legacy list/get/update endpoints (query-param routed).
  list: (tab = 'all') => apiFetch<ContentItem[]>('content-queue', { tab }),
  get: (id: string) => apiFetch<ContentItem>('content-queue', { id }),
  search: (query: string) => apiFetch<ContentItem[]>('content-queue', { search: query }),
  renderQueue: () => apiFetch<ContentItem[]>('content-queue', { resource: 'render_queue' }),
  update: (id: string, updates: Partial<ContentItem>) => apiPatch<ContentItem[]>('content-queue', { id, ...updates }),
  bulkApprove: (ids: string[]) => apiPost<any>('content-queue', { action: 'bulk_approve', ids }),
  bulkReject: (ids: string[], reason: string) => apiPost<any>('content-queue', { action: 'bulk_reject', ids, reason }),
  triggerRender: (id: string) => apiPost<any>('content-queue', { action: 'trigger_render', id }),
  ready: () => apiFetch<ContentItem[]>('content-queue', { tab: 'ready' }),
  scheduled: () => apiFetch<ContentItem[]>('content-queue', { tab: 'scheduled' }),

  // PIECE_PAGE_LIFECYCLE_V1 §6 path-based piece endpoints.
  getPiecePayload: (id: string) => piecePath<PiecePagePayload>(`/pieces/${id}`),
  getPromptChain:  (id: string) => piecePath<PromptExecution[]>(`/pieces/${id}/prompt-chain`),
  getRenderOutput: (id: string) => piecePath<{ queue_row: any; profile: any; output_urls: any }>(`/pieces/${id}/render-output`),
  getMetrics:      (id: string) => piecePath<{ ig: { latest: MetricSnapshot | null; series: MetricSnapshot[] }; tt: { latest: MetricSnapshot | null; series: MetricSnapshot[] } }>(`/pieces/${id}/metrics`),
  // CHANNEL_MODEL_V1: per-channel schedule + status edits. Each one
  // targets a single `scheduled_posts` row (keyed by content_id + channel).
  patchChannelSchedule: (id: string, channel: Channel, updates: { scheduled_for: string | null }) =>
    piecePath<ScheduledPost>(`/pieces/${id}/channels/${channel}/schedule`, 'PATCH', updates),
  patchChannelStatus: (
    id: string,
    channel: Channel,
    updates: {
      status: ScheduledPostStatus;
      post_url?: string | null;
      external_post_id?: string | null;
      failure_reason?: string | null;
    },
  ) =>
    piecePath<ScheduledPost>(`/pieces/${id}/channels/${channel}/status`, 'PATCH', updates),
  patchPillar: (id: string, pillar: ContentPillar) =>
    piecePath<{ id: string; content_pillar: ContentPillar }>(`/pieces/${id}/pillar`, 'PATCH', { pillar }),
  regenerateFromStep: (id: string, stepName: string, editedPrompt?: string) =>
    piecePath<{ ok: true; new_prompt_execution_id: string; superseded_id: string; step_name: string; step_order: number }>(
      `/pieces/${id}/regenerate-from-step`,
      'POST',
      { step_name: stepName, edited_prompt: editedPrompt },
    ),
};
