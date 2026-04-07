const API_BASE = 'https://fvxaykkmzsbrggjgdfjj.supabase.co/functions/v1';

export async function apiFetch<T>(fn: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}/${fn}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function apiPost<T>(fn: string, body: Record<string, any>): Promise<T> {
  const res = await fetch(`${API_BASE}/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function apiPatch<T>(fn: string, body: Record<string, any>): Promise<T> {
  const res = await fetch(`${API_BASE}/${fn}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
