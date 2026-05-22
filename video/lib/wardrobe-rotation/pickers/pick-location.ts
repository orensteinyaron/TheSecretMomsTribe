import type { RachelLocation, RecentLocationPick } from '../types.js';

export const PRIMARY_LOCATION_RATIO = 5 / 7;
export const LOCATION_COOLDOWN_WITHIN_TIER = 1;
export const LOCATION_RATIO_WINDOW = 7;

export function pickLocation(
  activeLocations: RachelLocation[],
  recentlyUsed: RecentLocationPick[],
): string {
  if (activeLocations.length === 0) {
    throw new Error('pickLocation: no active locations available');
  }

  // 1. Compute primary ratio from last LOCATION_RATIO_WINDOW picks
  const window = recentlyUsed.slice(0, LOCATION_RATIO_WINDOW);
  const primaryCount = window.filter((p) => p.tier === 'primary').length;
  const currentRatio = window.length === 0 ? 0 : primaryCount / window.length;

  // 2. Decide required tier
  // At-threshold case (5/7 >= 5/7) pushes to secondary
  const requiredTier: 'primary' | 'secondary' =
    currentRatio < PRIMARY_LOCATION_RATIO ? 'primary' : 'secondary';

  // 3. Filter active to required tier
  let tierActive = activeLocations.filter((l) => l.tier === requiredTier);

  // 4. Fall back to other tier if no active in required tier (silently for PR-A)
  if (tierActive.length === 0) {
    const otherTier = requiredTier === 'primary' ? 'secondary' : 'primary';
    tierActive = activeLocations.filter((l) => l.tier === otherTier);
    if (tierActive.length === 0) {
      throw new Error('pickLocation: no active locations in either tier');
    }
  }

  // 5. LRU within tier (cooldown = 1): block the most-recent pick in this tier
  const tierRecent = recentlyUsed
    .filter((p) => p.tier === requiredTier)
    .sort((a, b) => new Date(b.used_at).getTime() - new Date(a.used_at).getTime());
  const blocked = new Set<string>();
  for (const p of tierRecent.slice(0, LOCATION_COOLDOWN_WITHIN_TIER)) {
    blocked.add(p.location_id);
  }
  let candidates = tierActive.filter((l) => !blocked.has(l.location_id));
  // Degenerate: only 1 active in tier — fall through to it even if blocked
  if (candidates.length === 0) candidates = tierActive;

  // 6. Among candidates, pick the one whose most-recent usage (across ALL tiers) is oldest
  const lastUsed = new Map<string, number>();
  for (const p of recentlyUsed) {
    const t = new Date(p.used_at).getTime();
    const prev = lastUsed.get(p.location_id);
    if (prev === undefined || t > prev) lastUsed.set(p.location_id, t);
  }

  // 7. Tie-break: ascending location_id
  return [...candidates].sort((a, b) => {
    const ta = lastUsed.get(a.location_id) ?? -Infinity;
    const tb = lastUsed.get(b.location_id) ?? -Infinity;
    if (ta !== tb) return ta - tb;
    return a.location_id.localeCompare(b.location_id);
  })[0].location_id;
}
