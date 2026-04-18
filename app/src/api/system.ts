import { apiFetch, apiPatch } from './client';
import type { Service, RenderProfile, SystemHealth, PipelineHealth } from '../types';

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
};
