/**
 * content_queue INSERT-payload builder.
 *
 * Single responsibility: take a validated in-memory piece plus a few
 * run-time options and produce the exact row shape we write to
 * Supabase. Every key returned here MUST correspond to a real
 * content_queue column — additions/renames in the schema require an
 * update here, and the integration test in __tests__ catches drift.
 *
 * v2.0.0 (CHANNEL_MODEL_V1): `post_format` is dropped. Format is the
 * FK `render_profile_id`. Per-channel state (`scheduled_at_*`,
 * `published_at_*`, `published_url_*`, `channel_override`) is dropped
 * too — those live in the `scheduled_posts` table, written separately.
 *
 * Why this exists as its own file:
 *   1. Historical: `platform` and the per-channel inline columns were
 *      dropped from content_queue by their respective migrations. An
 *      explicit whitelist closes the PGRST204 "unknown column" class
 *      of bug that arose when writeContentQueue used to spread runtime
 *      fields straight into the INSERT.
 *   2. The shape returned here is the live `content_queue` column set.
 *      Adding a new column means updating this function AND the
 *      content-queue-row.test.js assertion.
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
