import { apiFetch, apiPost, apiPatch } from './client';
import type { Agent, AgentRun } from '../types';

export const agentsApi = {
  list: () => apiFetch<Agent[]>('agents-api', { resource: 'agents' }),
  runs: (agentSlug: string) => apiFetch<AgentRun[]>('agents-api', { resource: 'runs', agent: agentSlug }),
  runsByDate: (date: string) => apiFetch<AgentRun[]>('agents-api', { resource: 'runs', date }),
  trigger: (agentSlug: string) => apiPost<any>('agents-api', { action: 'trigger', agent_slug: agentSlug }),
  toggle: (agentSlug: string, status: 'disabled' | 'idle') => apiPatch<any>('agents-api', { agent_slug: agentSlug, status }),
};
