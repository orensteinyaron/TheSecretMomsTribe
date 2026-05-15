import { apiFetch, apiPatch } from './client';
import type {
  Service,
  RenderProfile,
  SystemHealth,
  PipelineHealth,
  PipelineRun,
  ContentQueueRejected,
} from '../types';

export const systemApi = {
  services: () => apiFetch<Service[]>('system-api', { resource: 'services' }),
  updateService: (id: string, updates: Partial<Service>) => apiPatch<any>('system-api', { resource: 'services', id, ...updates }),
  renderProfiles: () => apiFetch<RenderProfile[]>('system-api', { resource: 'render_profiles' }),
  health: () => apiFetch<SystemHealth>('system-api', { resource: 'system_health' }),
  pipelineHealth: () => apiFetch<PipelineHealth>('system-api', { resource: 'pipeline_health' }),
  activityLog: (date?: string, includeDebug?: boolean) => apiFetch<any[]>('system-api', {
    resource: 'activity_log',
    ...(date ? { date } : {}),
    ...(includeDebug ? { include_debug: '1' } : {}),
  }),
  pipelineRuns: (limit = 50) => apiFetch<PipelineRun[]>('system-api', { resource: 'pipeline_runs', limit: String(limit) }),
  pipelineRun: (id: string) => apiFetch<PipelineRun[]>('system-api', { resource: 'pipeline_runs', id }),
  contentQueueRejected: (limit = 50) => apiFetch<ContentQueueRejected[]>('system-api', { resource: 'content_queue_rejected', limit: String(limit) }),
};
