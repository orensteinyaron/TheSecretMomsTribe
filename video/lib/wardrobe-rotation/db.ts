/**
 * Supabase DB layer for the `rachel_looks` table.
 *
 * Matches the agents/lib/supabase.js client-construction pattern:
 * - Single eager createClient at module scope
 * - Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env, exits on missing
 * - Errors surface as thrown exceptions (no error-tuple returns)
 */

import { createClient } from '@supabase/supabase-js';
import type { RachelLook, RachelLookStatus, RecentPick } from './types.js';
import { nextLookIdFrom } from './generate-look-id.js';

// ── Client ────────────────────────────────────────────────────────────────────

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('[wardrobe-rotation/db] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Returns all active looks ordered by look_id.
 */
export async function listActiveLooks(): Promise<RachelLook[]> {
  const { data, error } = await supabase
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
  let query = supabase.from('rachel_looks').select('*').order('look_id');

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
  const { data, error } = await supabase
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
 * Implementation note: the Supabase JS builder does not natively support the
 * jsonb `?` key-existence operator, nor `column->>'key'` as a select alias.
 * We therefore use .rpc() with an inline SQL helper declared here as a
 * comment (no migration needed for an RPC in this file — it would require a
 * CREATE FUNCTION migration if called via .rpc(); see DONE_WITH_CONCERNS below).
 *
 * DONE_WITH_CONCERNS: because the jsonb column projection `avatar_config->>'look_id'`
 * and the key-existence predicate `avatar_config ? 'look_id'` cannot be expressed
 * through the standard .from().select() builder, we use a raw SQL approach via
 * the Supabase RPC pattern.  A tiny SQL function `get_recent_avatar_picks` must
 * exist in the DB for this to execute at runtime.  That function is defined in
 * supabase/migrations/20260519140001_get_recent_avatar_picks.sql (to be added in
 * the Task 6 follow-up).  The function signature is:
 *
 *   CREATE OR REPLACE FUNCTION get_recent_avatar_picks(pick_limit int)
 *   RETURNS TABLE(look_id text, used_at timestamptz)
 *   LANGUAGE sql STABLE AS $$
 *     SELECT avatar_config->>'look_id' AS look_id,
 *            updated_at                AS used_at
 *     FROM   content_queue
 *     WHERE  render_profile_id IN ('avatar-v1', 'avatar-full-v5')
 *       AND  avatar_config ? 'look_id'
 *     ORDER  BY updated_at DESC
 *     LIMIT  pick_limit;
 *   $$;
 *
 * Until that migration is applied, callers will receive an empty array (the
 * error is swallowed with a warning so the rest of the pipeline keeps running).
 */
export async function getRecentPicks(limit: number): Promise<RecentPick[]> {
  const { data, error } = await supabase.rpc('get_recent_avatar_picks', {
    pick_limit: limit,
  });

  if (error) {
    // RPC function may not exist yet (migration pending). Log and degrade
    // gracefully — callers treat an empty history as "no cooldown in effect".
    console.warn(`[getRecentPicks] RPC unavailable, returning []: ${error.message}`);
    return [];
  }

  return ((data ?? []) as Array<{ look_id: string; used_at: string }>).map(
    (row) => ({ look_id: row.look_id, used_at: row.used_at }),
  );
}

/**
 * Inserts a new look and returns the inserted row.
 * Lets DB defaults handle created_at.
 */
export async function insertLook(
  look: Omit<RachelLook, 'created_at' | 'approved_at' | 'retired_at'>,
): Promise<RachelLook> {
  const { data, error } = await supabase
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

  const { data, error } = await supabase
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
  const { data, error } = await supabase
    .from('rachel_looks')
    .select('look_id')
    .order('look_id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`[generateNextLookId] ${error.message}`);

  const currentMax = data ? (data as { look_id: string }).look_id : null;
  return nextLookIdFrom(currentMax);
}
