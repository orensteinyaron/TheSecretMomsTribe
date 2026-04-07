import { apiFetch, apiPatch } from './client';
import type { Service, RenderProfile, SystemHealth } from '../types';

export const systemApi = {
  services: () => apiFetch<Service[]>('system-api', { resource: 'services' }),
  updateService: (id: string, updates: Partial<Service>) => apiPatch<any>('system-api', { resource: 'services', id, ...updates }),
  renderProfiles: () => apiFetch<RenderProfile[]>('system-api', { resource: 'render_profiles' }),
  health: () => apiFetch<SystemHealth>('system-api', { resource: 'system_health' }),
  activityLog: (date?: string) => apiFetch<any[]>('system-api', { resource: 'activity_log', ...(date ? { date } : {}) }),
};
