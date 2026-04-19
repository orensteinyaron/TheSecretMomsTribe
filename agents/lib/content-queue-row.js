/**
 * content_queue INSERT-payload builder.
 *
 * Single responsibility: take a validated in-memory piece plus a few
 * run-time options and produce the exact row shape we write to
 * Supabase. Every key returned here MUST correspond to a real
 * content_queue column — additions/renames in the schema require an
 * update here, and the integration test in __tests__ catches drift.
 *
 * Why this exists as its own file:
 *   1. `platform` was dropped from content_queue by migration
 *      20260418171725_drop_platform_add_channel_scheduling per
 *      PIECE_PAGE_LIFECYCLE_V1 §3.1. Content is dual-platform by
 *      default; per-piece routing (rare) goes through
 *      `channel_override`, which is NOT set here.
 *   2. Previously, writeContentQueue spread runtime-only fields like
 *      `p.platform` straight into the INSERT, producing PGRST204.
 *      An explicit whitelist closes that class of bug.
 *
 * Adding a new column?
 *   1. Add the field to this function's return object.
 *   2. Add an assertion to content-queue-row.test.js so the
 *      whitelist regression stays locked.
 *   3. Run the integration test (SUPABASE_URL set) to confirm the
 *      column exists in the live schema.
 */

/**
 * @param {object} piece   Validated post from generateBatch +
 *                         normalizeImageFields + resolveSourceUrls.
 * @param {{
 *   briefingId: string,
 *   renderProfileId: string|null,
 *   density: string,
 * }} opts
 * @returns {object}       Plain object ready for
 *                         supabase.from('content_queue').insert(...).
 */
export function buildContentQueueRow(piece, { briefingId, renderProfileId, density }) {
  const status = piece.status_hint === 'draft_needs_review' ? 'draft_needs_review' : 'draft';

  return {
    briefing_id: briefingId,
    content_type: piece.content_type,
    status,
    hook: piece.hook,
    caption: piece.caption,
    hashtags: piece.hashtags,
    ai_magic_output: piece.ai_magic_output || null,
    image_prompt: piece.image_prompt || null,
    audio_suggestion: piece.audio_suggestion || null,
    age_range: piece.age_range,
    content_pillar: piece.content_pillar,
    post_format: piece.post_format,
    slides: piece.slides || [],
    avatar_config: piece.avatar_config || null,
    image_status: 'pending',
    launch_bank: false,
    quality_rating: null,
    render_profile_id: renderProfileId,
    render_status: renderProfileId ? 'pending' : null,
    source_urls: Array.isArray(piece.source_urls) ? piece.source_urls : [],
    metadata: {
      ...(piece.metadata || {}),
      image_axes: piece.image_axes || null,
      density_classification: density,
      format_flags: piece.format_flags || [],
    },
  };
}
