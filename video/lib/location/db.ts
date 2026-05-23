/**
 * Supabase DB layer for the rachel_locations table — the setting axis of the
 * two-axis wardrobe-rotation schema.
 *
 * Lifted out of wardrobe-rotation/db.ts as part of YAR-136 PR-C, where the
 * location surface grew its own bootstrap/approve/anchored-still flows and
 * earned its own skill module. The shape of every moved function is unchanged.
 *
 * Two new helpers were added here to support the new bootstrap-approve and
 * anchored-still flows:
 *   - updateLocationReferenceImage — atomically writes the locked canonical
 *     reference_image_url + reference_image_id on the location row.
 *   - getLocationReferenceImage    — cheap read for the anchored-still
 *     generator to fetch the canonical to use as nano_banana_pro medias.
 *
 * Uses a lazy-initialized client (getSupabase()) so that importing this module
 * does not call process.exit — env vars are validated on first use, throwing
 * instead, which host processes and test runners can recover from.
 * - Errors surface as thrown exceptions (no error-tuple returns)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RachelLocation, RachelLookStatus } from '../wardrobe-rotation/types.js';
import { nextIdFrom } from '../wardrobe-rotation/flows/generate-id.js';

// ── Client ────────────────────────────────────────────────────────────────────

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      '[location/db] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars',
    );
  }
  _supabase = createClient(url, key, { auth: { persistSession: false } });
  return _supabase;
}

// ── Location queries ──────────────────────────────────────────────────────────

/**
 * Returns all active locations ordered by location_id.
 */
export async function listActiveLocations(): Promise<RachelLocation[]> {
  const { data, error } = await getSupabase()
    .from('rachel_locations')
    .select('*')
    .eq('status', 'active')
    .order('location_id');

  if (error) throw new Error(`[listActiveLocations] ${error.message}`);
  return (data ?? []) as RachelLocation[];
}

/**
 * Returns all locations, optionally filtered by status, ordered by location_id.
 */
export async function listLocations(status?: RachelLookStatus): Promise<RachelLocation[]> {
  let query = getSupabase().from('rachel_locations').select('*').order('location_id');

  if (status !== undefined) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw new Error(`[listLocations] ${error.message}`);
  return (data ?? []) as RachelLocation[];
}

/**
 * Returns a single location by location_id, or null if not found.
 */
export async function getLocation(location_id: string): Promise<RachelLocation | null> {
  const { data, error } = await getSupabase()
    .from('rachel_locations')
    .select('*')
    .eq('location_id', location_id)
    .maybeSingle();

  if (error) throw new Error(`[getLocation] ${error.message}`);
  return data as RachelLocation | null;
}

/**
 * Inserts a new location and returns the inserted row.
 * approved_at/retired_at are set by updateLocationStatus during state transitions,
 * never on insert.
 * Lets DB defaults handle created_at.
 */
export async function insertLocation(
  loc: Omit<RachelLocation, 'created_at' | 'approved_at' | 'retired_at'>,
): Promise<RachelLocation> {
  const { data, error } = await getSupabase()
    .from('rachel_locations')
    .insert(loc)
    .select('*')
    .single();

  if (error) throw new Error(`[insertLocation] ${error.message}`);
  return data as RachelLocation;
}

/**
 * Updates the status of a location, setting approved_at or retired_at as needed.
 * Timestamps are computed JS-side (Date.now()), which is acceptable for our
 * use case. Returns the updated row.
 */
export async function updateLocationStatus(
  location_id: string,
  status: RachelLookStatus,
): Promise<RachelLocation> {
  const patch: Partial<RachelLocation> & { status: RachelLookStatus } = { status };

  if (status === 'active') {
    patch.approved_at = new Date().toISOString();
  } else if (status === 'retired') {
    patch.retired_at = new Date().toISOString();
  }

  const { data, error } = await getSupabase()
    .from('rachel_locations')
    .update(patch)
    .eq('location_id', location_id)
    .select('*')
    .single();

  if (error) throw new Error(`[updateLocationStatus] ${error.message}`);
  return data as RachelLocation;
}

/**
 * Fetches the current MAX(location_id) and returns the next id via nextIdFrom().
 */
export async function generateNextLocationId(): Promise<string> {
  const { data, error } = await getSupabase()
    .from('rachel_locations')
    .select('location_id')
    .order('location_id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`[generateNextLocationId] ${error.message}`);

  const currentMax = data ? (data as { location_id: string }).location_id : null;
  return nextIdFrom('location', currentMax);
}

/**
 * Sets reference_image_url + reference_image_id atomically on a location row.
 * Used by location/flows/approve-location.ts after Yaron picks the approved
 * canonical from the bootstrap candidates.
 */
export async function updateLocationReferenceImage(
  location_id: string,
  reference_image_url: string,
  reference_image_id: string,
): Promise<RachelLocation> {
  const { data, error } = await getSupabase()
    .from('rachel_locations')
    .update({ reference_image_url, reference_image_id })
    .eq('location_id', location_id)
    .select('*')
    .single();

  if (error) throw new Error(`[updateLocationReferenceImage] ${error.message}`);
  return data as RachelLocation;
}

/**
 * Returns the locked reference_image_url (canonical) for a location, or null
 * if not yet bootstrapped. Cheap read used by anchored-still flows.
 */
export async function getLocationReferenceImage(
  location_id: string,
): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from('rachel_locations')
    .select('reference_image_url')
    .eq('location_id', location_id)
    .maybeSingle();

  if (error) throw new Error(`[getLocationReferenceImage] ${error.message}`);
  return (data?.reference_image_url as string | null) ?? null;
}
