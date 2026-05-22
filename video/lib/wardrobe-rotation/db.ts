/**
 * Supabase DB layer for the wardrobe-rotation schema (looks + stills).
 *
 *   rachel_looks  — styling axis (wardrobe + hair + accessories)
 *   rachel_stills — per-combination Soul still cache (look × location)
 *
 * Location queries (rachel_locations) live in ../location/db.ts as of YAR-136
 * PR-C — the location surface owns its own bootstrap-approve/anchored-still
 * flows and earned a dedicated module.
 *
 * Uses a lazy-initialized client (getSupabase()) so that importing this module
 * does not call process.exit — env vars are validated on first use, throwing
 * instead, which host processes and test runners can recover from.
 * - Errors surface as thrown exceptions (no error-tuple returns)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  RachelLook, RachelStill,
  RachelLookStatus, LocationTier,
  RecentLookPick, RecentLocationPick,
} from './types.js';
import { nextIdFrom } from './flows/generate-id.js';

// ── Client ────────────────────────────────────────────────────────────────────

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      '[wardrobe-rotation/db] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars',
    );
  }
  _supabase = createClient(url, key, { auth: { persistSession: false } });
  return _supabase;
}

// ── Look queries ──────────────────────────────────────────────────────────────

/**
 * Returns all active looks ordered by look_id.
 */
export async function listActiveLooks(): Promise<RachelLook[]> {
  const { data, error } = await getSupabase()
    .from('rachel_looks')
    .select('*')
    .eq('status', 'active')
    .order('look_id');

  if (error) throw new Error(`[listActiveLooks] ${error.message}`);
  return (data ?? []) as RachelLook[];
}

/**
 * Returns all looks, optionally filtered by status, ordered by look_id.
 */
export async function listLooks(status?: RachelLookStatus): Promise<RachelLook[]> {
  let query = getSupabase().from('rachel_looks').select('*').order('look_id');

  if (status !== undefined) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw new Error(`[listLooks] ${error.message}`);
  return (data ?? []) as RachelLook[];
}

/**
 * Returns a single look by look_id, or null if not found.
 */
export async function getLook(look_id: string): Promise<RachelLook | null> {
  const { data, error } = await getSupabase()
    .from('rachel_looks')
    .select('*')
    .eq('look_id', look_id)
    .maybeSingle();

  if (error) throw new Error(`[getLook] ${error.message}`);
  return data as RachelLook | null;
}

/**
 * Inserts a new look and returns the inserted row.
 * approved_at/retired_at are set by updateLookStatus during state transitions,
 * never on insert.
 * Lets DB defaults handle created_at.
 */
export async function insertLook(
  look: Omit<RachelLook, 'created_at' | 'approved_at' | 'retired_at'>,
): Promise<RachelLook> {
  const { data, error } = await getSupabase()
    .from('rachel_looks')
    .insert(look)
    .select('*')
    .single();

  if (error) throw new Error(`[insertLook] ${error.message}`);
  return data as RachelLook;
}

/**
 * Updates the status of a look, setting approved_at or retired_at as needed.
 * Timestamps are computed JS-side (Date.now()), which is acceptable for our
 * use case. Returns the updated row.
 */
export async function updateLookStatus(
  look_id: string,
  status: RachelLookStatus,
): Promise<RachelLook> {
  const patch: Partial<RachelLook> & { status: RachelLookStatus } = { status };

  if (status === 'active') {
    patch.approved_at = new Date().toISOString();
  } else if (status === 'retired') {
    patch.retired_at = new Date().toISOString();
  }

  const { data, error } = await getSupabase()
    .from('rachel_looks')
    .update(patch)
    .eq('look_id', look_id)
    .select('*')
    .single();

  if (error) throw new Error(`[updateLookStatus] ${error.message}`);
  return data as RachelLook;
}

/**
 * Fetches the current MAX(look_id) and returns the next id via nextIdFrom().
 */
export async function generateNextLookId(): Promise<string> {
  const { data, error } = await getSupabase()
    .from('rachel_looks')
    .select('look_id')
    .order('look_id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`[generateNextLookId] ${error.message}`);

  const currentMax = data ? (data as { look_id: string }).look_id : null;
  return nextIdFrom('look', currentMax);
}

// ── Still queries ─────────────────────────────────────────────────────────────

/**
 * Returns all active stills.
 */
export async function listActiveStills(): Promise<RachelStill[]> {
  const { data, error } = await getSupabase()
    .from('rachel_stills')
    .select('*')
    .eq('status', 'active');

  if (error) throw new Error(`[listActiveStills] ${error.message}`);
  return (data ?? []) as RachelStill[];
}

/**
 * Returns stills with optional filters for look_id, location_id, or status.
 */
export async function listStills(
  filters?: { look_id?: string; location_id?: string; status?: RachelLookStatus },
): Promise<RachelStill[]> {
  let query = getSupabase().from('rachel_stills').select('*');

  if (filters?.look_id !== undefined) {
    query = query.eq('look_id', filters.look_id);
  }
  if (filters?.location_id !== undefined) {
    query = query.eq('location_id', filters.location_id);
  }
  if (filters?.status !== undefined) {
    query = query.eq('status', filters.status);
  }

  const { data, error } = await query;
  if (error) throw new Error(`[listStills] ${error.message}`);
  return (data ?? []) as RachelStill[];
}

/**
 * Returns a single still by still_id, or null if not found.
 */
export async function getStill(still_id: string): Promise<RachelStill | null> {
  const { data, error } = await getSupabase()
    .from('rachel_stills')
    .select('*')
    .eq('still_id', still_id)
    .maybeSingle();

  if (error) throw new Error(`[getStill] ${error.message}`);
  return data as RachelStill | null;
}

/**
 * Inserts a new still and returns the inserted row.
 * still_id is generated by the DB (uuid default).
 * approved_at/retired_at are set by updateStillStatus during state transitions.
 * Lets DB defaults handle created_at and still_id.
 */
export async function insertStill(
  still: Omit<RachelStill, 'still_id' | 'created_at' | 'approved_at' | 'retired_at'>,
): Promise<RachelStill> {
  const { data, error } = await getSupabase()
    .from('rachel_stills')
    .insert(still)
    .select('*')
    .single();

  if (error) throw new Error(`[insertStill] ${error.message}`);
  return data as RachelStill;
}

/**
 * Updates the status of a still, setting approved_at or retired_at as needed.
 * Timestamps are computed JS-side. Returns the updated row.
 */
export async function updateStillStatus(
  still_id: string,
  status: RachelLookStatus,
): Promise<RachelStill> {
  const patch: Partial<RachelStill> & { status: RachelLookStatus } = { status };

  if (status === 'active') {
    patch.approved_at = new Date().toISOString();
  } else if (status === 'retired') {
    patch.retired_at = new Date().toISOString();
  }

  const { data, error } = await getSupabase()
    .from('rachel_stills')
    .update(patch)
    .eq('still_id', still_id)
    .select('*')
    .single();

  if (error) throw new Error(`[updateStillStatus] ${error.message}`);
  return data as RachelStill;
}

/**
 * Returns all active stills across all combinations. Named for the
 * pickCombination caller's clarity — it filters by (look_id, location_id) in JS.
 */
export async function getActiveStillsByCombo(): Promise<RachelStill[]> {
  return listStills({ status: 'active' });
}

/**
 * Returns the count of active stills for a specific (look_id, location_id) combo.
 * Used by assertCanRetireStill callers before retiring an active still.
 */
export async function countActiveStillsForCombo(
  look_id: string,
  location_id: string,
): Promise<number> {
  const { count, error } = await getSupabase()
    .from('rachel_stills')
    .select('*', { count: 'exact', head: true })
    .eq('look_id', look_id)
    .eq('location_id', location_id)
    .eq('status', 'active');

  if (error) throw new Error(`[countActiveStillsForCombo] ${error.message}`);
  return count ?? 0;
}

// ── Recent picks (for pickers) ────────────────────────────────────────────────

/**
 * Returns recent look picks from content_queue rows that carry avatar_config.look_id.
 *
 * Fetches the full `avatar_config` jsonb column and applies the
 * `avatar_config ? 'look_id'` semantics in JS (typeof string check).
 * Overfetches 3× so the in-JS filter still yields `limit` results when
 * some rows lack a `look_id`.
 */
export async function getRecentLookPicks(limit: number): Promise<RecentLookPick[]> {
  const { data, error } = await getSupabase()
    .from('content_queue')
    .select('avatar_config, updated_at')
    .in('render_profile_id', ['avatar-v1', 'avatar-full-v5'])
    .not('avatar_config', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(limit * 3);

  if (error) throw new Error(`[getRecentLookPicks] ${error.message}`);

  const picks: RecentLookPick[] = [];
  for (const row of (data ?? []) as Array<{ avatar_config: Record<string, unknown> | null; updated_at: string }>) {
    const lookId = row.avatar_config?.look_id;
    if (typeof lookId === 'string' && lookId.length > 0) {
      picks.push({ look_id: lookId, used_at: row.updated_at });
      if (picks.length >= limit) break;
    }
  }
  return picks;
}

/**
 * Returns recent location picks from content_queue rows that carry
 * avatar_config.location_id, enriched with the tier from rachel_locations.
 *
 * Two-step approach:
 * 1. Overfetch content_queue rows, extract candidate location_ids.
 * 2. Look up tier from rachel_locations for those candidates.
 * 3. Build RecentLocationPick[] with tier, skipping rows whose location_id
 *    is no longer in rachel_locations (defensive — shouldn't happen).
 */
export async function getRecentLocationPicks(limit: number): Promise<RecentLocationPick[]> {
  // Step 1: fetch overfetched content_queue rows
  const { data: queueRows, error: queueError } = await getSupabase()
    .from('content_queue')
    .select('avatar_config, updated_at')
    .in('render_profile_id', ['avatar-v1', 'avatar-full-v5'])
    .not('avatar_config', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(limit * 3);

  if (queueError) throw new Error(`[getRecentLocationPicks] ${queueError.message}`);

  const rows = (queueRows ?? []) as Array<{ avatar_config: Record<string, unknown> | null; updated_at: string }>;

  // Step 2: extract candidate location_ids (deduplicated for the lookup, order preserved)
  const candidateIds: string[] = [];
  const seenForLookup = new Set<string>();
  for (const row of rows) {
    const locationId = row.avatar_config?.location_id;
    if (typeof locationId === 'string' && locationId.length > 0 && !seenForLookup.has(locationId)) {
      candidateIds.push(locationId);
      seenForLookup.add(locationId);
    }
  }

  if (candidateIds.length === 0) return [];

  // Step 3: fetch tiers from rachel_locations for all candidate ids.
  // Note: NOT filtered by status — retired locations still need to count
  // against the recency ratio (a primary used 3× last week then retired
  // should still bias the next pick toward secondary). The invariant this
  // depends on is that rows in rachel_locations are NEVER deleted; status
  // transitions only. If a referential gap is detected (Step 5 warning),
  // someone bypassed the retire flow and deleted a row directly.
  const { data: locationRows, error: locationError } = await getSupabase()
    .from('rachel_locations')
    .select('location_id, tier')
    .in('location_id', candidateIds);

  if (locationError) throw new Error(`[getRecentLocationPicks] ${locationError.message}`);

  // Step 4: build a Map<location_id, tier>
  const tierMap = new Map<string, LocationTier>();
  for (const loc of (locationRows ?? []) as Array<{ location_id: string; tier: LocationTier }>) {
    tierMap.set(loc.location_id, loc.tier);
  }

  // Step 5: iterate content_queue rows, look up tier, build picks
  const picks: RecentLocationPick[] = [];
  for (const row of rows) {
    const locationId = row.avatar_config?.location_id;
    if (typeof locationId !== 'string' || locationId.length === 0) continue;

    const tier = tierMap.get(locationId);
    if (tier === undefined) {
      // True referential orphan — content_queue references a location_id that
      // doesn't exist in rachel_locations at all. Locations should never be
      // deleted (retire is a status change, see Step 3 comment). Log loudly
      // but continue — better to under-count one pick than to throw the
      // entire ratio computation.
      console.warn(
        `[getRecentLocationPicks] referential orphan: content_queue row references location_id '${locationId}' not found in rachel_locations. Skipping. Investigate — rows should never be deleted.`,
      );
      continue;
    }

    picks.push({ location_id: locationId, tier, used_at: row.updated_at });
    if (picks.length >= limit) break;
  }

  return picks;
}
