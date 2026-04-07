import { apiFetch, apiPost, apiPatch } from './client';
import type { StrategyTask, StrategyInsight, DailyBriefing, SystemDirective } from '../types';

export const strategyApi = {
  tasks: (status = 'pending') => apiFetch<StrategyTask[]>('strategy-api', { resource: 'tasks', status }),
  insights: (status = 'all') => apiFetch<StrategyInsight[]>('strategy-api', { resource: 'insights', status }),
  briefing: (date?: string) => apiFetch<DailyBriefing>('strategy-api', { resource: 'briefings', ...(date ? { date } : {}) }),
  updateTask: (id: string, status: string, admin_notes?: string) =>
    apiPatch<any>('strategy-api', { resource: 'tasks', id, status, admin_notes }),
  directives: (status = 'active') => apiFetch<SystemDirective[]>('strategy-api', { resource: 'directives', status }),
  createDirective: (directive: string, directive_type: string, target_agent?: string, priority = 5) =>
    apiPost<any>('strategy-api', { resource: 'directives', directive, directive_type, target_agent, priority }),
  updateDirective: (id: string, status: string) => apiPatch<any>('strategy-api', { resource: 'directives', id, status }),
};
