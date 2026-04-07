const API_BASE = 'https://fvxaykkmzsbrggjgdfjj.supabase.co/functions/v1';

export async function apiGet(fn: string, params: Record<string, string> = {}) {
  const url = new URL(`${API_BASE}/${fn}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  return res.json();
}

export async function apiPost(fn: string, body: Record<string, any>) {
  const res = await fetch(`${API_BASE}/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function apiPatch(fn: string, body: Record<string, any>) {
  const res = await fetch(`${API_BASE}/${fn}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// Convenience functions
export async function getContentById(id: string) {
  return apiGet('content-queue', { id });
}

export async function getContentList(tab = 'all') {
  return apiGet('content-queue', { tab });
}

export async function updateContent(id: string, updates: Record<string, any>) {
  return apiPatch('content-queue', { id, ...updates });
}

export async function getStrategyTasks(status = 'pending') {
  return apiGet('strategy-api', { resource: 'tasks', status });
}

export async function getSystemHealth() {
  return apiGet('system-api', { resource: 'system_health' });
}

export async function getAgents() {
  return apiGet('agents-api', { resource: 'agents' });
}

export async function getServices() {
  return apiGet('system-api', { resource: 'services' });
}
