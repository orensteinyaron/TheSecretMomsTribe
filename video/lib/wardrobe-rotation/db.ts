/**
 * Supabase DB layer for the `rachel_looks` table.
 *
 * Uses a lazy-initialized client (getSupabase()) so that importing this module
 * does not call process.exit — env vars are validated on first use, throwing
 * instead, which host processes and test runners can recover from.
 * - Errors surface as thrown exceptions (no error-tuple returns)
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RachelLook, RachelLookStatus, RecentPick } from './types.js';
import { nextLookIdFrom } from './generate-look-id.js';

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

// ── Queries ───────────────────────────────────────────────────────────────────

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
 * Returns recent look picks from content_queue rows that carry avatar_config.look_id.
 *
 * Fetches the full `avatar_config` jsonb column and applies the
 * `avatar_config ? 'look_id'` semantics in JS (typeof string check).
 * Overfetches 3× so the in-JS filter still yields `limit` results when
 * some rows lack a `look_id`.
 */
export async function getRecentPicks(limit: number): Promise<RecentPick[]> {
  const { data, error } = await getSupabase()
    .from('content_queue')
    .select('avatar_config, updated_at')
    .in('render_profile_id', ['avatar-v1', 'avatar-full-v5'])
    .not('avatar_config', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(limit * 3);

  if (error) throw new Error(`[getRecentPicks] ${error.message}`);

  const picks: RecentPick[] = [];
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
 * Fetches the current MAX(look_id) and returns the next id via nextLookIdFrom().
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
  return nextLookIdFrom(currentMax);
}
