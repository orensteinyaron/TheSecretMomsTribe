const BASE = 'https://fvxaykkmzsbrggjgdfjj.supabase.co/functions/v1/content-queue';

export async function fetchContent(tab) {
  // Map UI tabs to edge function tabs
  const apiTab = tab === 'bank' ? 'approved' : tab;
  const res = await fetch(`${BASE}?tab=${apiTab}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();

  // Client-side filter for bank vs approved
  if (tab === 'approved') return data.filter(item => !item.launch_bank);
  if (tab === 'bank') return data.filter(item => item.launch_bank);
  return data;
}

export async function updateContent(id, updates) {
  const res = await fetch(BASE, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...updates }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchCosts() {
  const res = await fetch(`${BASE}?tab=costs`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
