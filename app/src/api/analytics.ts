import { apiFetch } from './client';

export const analyticsApi = {
  pipelineStats: () => apiFetch<any>('analytics-api', { resource: 'pipeline_stats' }),
  costSummary: (period = 'week') => apiFetch<any>('analytics-api', { resource: 'cost_summary', period }),
  costByAgent: () => apiFetch<any>('analytics-api', { resource: 'cost_by_agent' }),
  costByService: () => apiFetch<any>('analytics-api', { resource: 'cost_by_service' }),
  competitors: () => apiFetch<any>('analytics-api', { resource: 'competitors' }),
};
