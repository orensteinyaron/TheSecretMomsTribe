import { useQuery } from '@tanstack/react-query';
import { systemApi } from '../api/system';
import { agentsApi } from '../api/agents';
import { analyticsApi } from '../api/analytics';

export function useSystemHealth() {
  return useQuery({
    queryKey: ['system', 'health'],
    queryFn: () => systemApi.health(),
    refetchInterval: 60_000,
  });
}

export function usePipelineHealth() {
  return useQuery({
    queryKey: ['system', 'pipeline_health'],
    queryFn: () => systemApi.pipelineHealth(),
    refetchInterval: 60_000,
  });
}

export function useServices() {
  return useQuery({ queryKey: ['system', 'services'], queryFn: () => systemApi.services() });
}

export function useRenderProfiles() {
  return useQuery({ queryKey: ['system', 'profiles'], queryFn: () => systemApi.renderProfiles() });
}

export function useActivityLog(date?: string) {
  return useQuery({ queryKey: ['system', 'activity', date], queryFn: () => systemApi.activityLog(date) });
}

export function useAgents() {
  return useQuery({ queryKey: ['agents'], queryFn: () => agentsApi.list() });
}

export function useAgentRuns(slug: string) {
  return useQuery({ queryKey: ['agents', 'runs', slug], queryFn: () => agentsApi.runs(slug), enabled: !!slug });
}

export function usePipelineStats() {
  return useQuery({ queryKey: ['analytics', 'pipeline'], queryFn: () => analyticsApi.pipelineStats() });
}

export function useCostSummary(period = 'week') {
  return useQuery({ queryKey: ['analytics', 'cost', period], queryFn: () => analyticsApi.costSummary(period) });
}
