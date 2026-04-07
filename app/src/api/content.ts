import { apiFetch, apiPost, apiPatch } from './client';
import type { ContentItem } from '../types';

export const contentApi = {
  list: (tab = 'all') => apiFetch<ContentItem[]>('content-queue', { tab }),
  get: (id: string) => apiFetch<ContentItem>('content-queue', { id }),
  search: (query: string) => apiFetch<ContentItem[]>('content-queue', { search: query }),
  renderQueue: () => apiFetch<ContentItem[]>('content-queue', { resource: 'render_queue' }),
  update: (id: string, updates: Partial<ContentItem>) => apiPatch<ContentItem[]>('content-queue', { id, ...updates }),
  bulkApprove: (ids: string[]) => apiPost<any>('content-queue', { action: 'bulk_approve', ids }),
  bulkReject: (ids: string[], reason: string) => apiPost<any>('content-queue', { action: 'bulk_reject', ids, reason }),
  triggerRender: (id: string) => apiPost<any>('content-queue', { action: 'trigger_render', id }),
};
