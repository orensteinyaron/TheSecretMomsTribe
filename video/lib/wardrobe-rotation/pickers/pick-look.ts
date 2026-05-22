import type { RecentLookPick } from '../types.js';

export const LOOK_COOLDOWN = 3;

export function pickLook(activeLooks: string[], recentlyUsed: RecentLookPick[]): string {
  if (activeLooks.length === 0) {
    throw new Error('pickLook: no active looks available');
  }
  const sortedActive = [...activeLooks].sort();
  if (recentlyUsed.length === 0) return sortedActive[0];

  const sortedRecent = [...recentlyUsed].sort(
    (a, b) => new Date(b.used_at).getTime() - new Date(a.used_at).getTime(),
  );
  const blocked = new Set<string>();
  for (const p of sortedRecent) {
    if (blocked.size >= LOOK_COOLDOWN) break;
    blocked.add(p.look_id);
  }
  const candidates = sortedActive.filter((id) => !blocked.has(id));

  const lastUsed = new Map<string, number>();
  for (const p of recentlyUsed) {
    const t = new Date(p.used_at).getTime();
    const prev = lastUsed.get(p.look_id);
    if (prev === undefined || t > prev) lastUsed.set(p.look_id, t);
  }

  if (candidates.length === 0) {
    // Fewer active looks than cooldown — fall back to active look with oldest used_at.
    return [...sortedActive].sort((a, b) => {
      const ta = lastUsed.get(a) ?? -Infinity;
      const tb = lastUsed.get(b) ?? -Infinity;
      if (ta !== tb) return ta - tb;
      return a.localeCompare(b);
    })[0];
  }

  // Among candidates: pick the one whose most-recent usage is oldest. Never-used = -Infinity (oldest).
  return [...candidates].sort((a, b) => {
    const ta = lastUsed.get(a) ?? -Infinity;
    const tb = lastUsed.get(b) ?? -Infinity;
    if (ta !== tb) return ta - tb;
    return a.localeCompare(b);
  })[0];
}
