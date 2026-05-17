/**
 * Render profile resolution and validation.
 *
 * Per CHANNEL_MODEL_V1: format = render profile. One render profile per
 * piece, one rendered output file. `render_profile_id` (FK to
 * `render_profiles`) is the source of truth for "what shape is this piece."
 *
 * The Content Agent (LLM) emits `render_profile_slug` at generation time;
 * this module validates the slug against the live render_profiles table
 * and resolves to the row. No pillar→format inference lives here — the
 * LLM is the recommender, gate_validators rejects invalid slugs before
 * they reach Supabase.
 */

export const RENDER_PROFILE_SLUGS = Object.freeze({
  AVATAR_V1:     'avatar-v1',
  MOVING_IMAGES: 'moving-images',
  STATIC_IMAGE:  'static-image',
  CAROUSEL:      'carousel',
});

export const ALL_RENDER_PROFILE_SLUGS = Object.freeze(Object.values(RENDER_PROFILE_SLUGS));

export function isValidRenderProfileSlug(slug) {
  return typeof slug === 'string' && ALL_RENDER_PROFILE_SLUGS.includes(slug);
}

/**
 * Fetch all render_profiles rows and return a {slug: row} map.
 * Used by writers to convert an LLM-emitted slug into a render_profile_id.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<Record<string, { id: string, slug: string, name: string, profile_type: string, status: string, cost_estimate_usd: number|null }>>}
 */
export async function getRenderProfileMap(supabase) {
  const { data, error } = await supabase
    .from('render_profiles')
    .select('id, slug, name, profile_type, status, cost_estimate_usd');
  if (error) throw new Error(`getRenderProfileMap: ${error.message}`);
  const map = {};
  for (const rp of data || []) map[rp.slug] = rp;
  return map;
}

/**
 * Resolve a slug to its render_profile row. Throws if invalid or missing.
 */
export async function getRenderProfileBySlug(supabase, slug) {
  if (!isValidRenderProfileSlug(slug)) {
    throw new Error(`getRenderProfileBySlug: invalid slug "${slug}"`);
  }
  const { data, error } = await supabase
    .from('render_profiles')
    .select('id, slug, name, profile_type, status, cost_estimate_usd')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(`getRenderProfileBySlug: ${error.message}`);
  if (!data) throw new Error(`getRenderProfileBySlug: no row for slug "${slug}"`);
  return data;
}

/**
 * Get only render profiles with status='active'.
 *
 * Note: `static-image` and `carousel` are currently `status='draft'` in
 * the DB but are in active use. Don't gate writes on status alone —
 * use this only when you specifically want the active subset.
 */
export async function getActiveRenderProfiles(supabase) {
  const { data, error } = await supabase
    .from('render_profiles')
    .select('id, slug, name, profile_type, status')
    .eq('status', 'active');
  if (error) throw new Error(`getActiveRenderProfiles: ${error.message}`);
  return data || [];
}
