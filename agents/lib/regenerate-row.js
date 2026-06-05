/**
 * Pure helpers for the single-row regenerate mode (YAR-142).
 *
 * These are IO-free so they can be unit-tested without env vars. The
 * orchestration (Supabase reads/writes, generateBatch, gates) lives in
 * content.js runRegenerate(); this file only reconstructs the synthetic
 * briefing and produces the metadata-versioned supersession patches.
 *
 * Supersession convention (cribbed from
 * scripts/regenerate-stale-drafts.js — there is NO supersedes_id column):
 *   original row → status='superseded' + metadata.superseded_by=<newId>
 *   new row      → metadata.regenerated_from=<originalId>
 * Both MERGE prior metadata; neither clobbers existing keys.
 */

/**
 * Reconstruct a briefing-shaped object from a content_queue row so the
 * existing generateBatch + resolveSourceUrls pipeline can run on ONE row.
 *
 * The opportunity carries exactly the fields the pipeline reads:
 *   - resolveSourceUrls reads `signal_id`, `source_url`, `source` on each opp
 *   - generateBatch JSON-stringifies the opps into the user prompt, so we
 *     also carry `content_pillar` + `age_range` (the inherited routing
 *     fields) and the original hook/caption as authoring context.
 *
 * The opportunity's signal_id is derived from the row's primary source_url
 * entry when present; otherwise a stable per-row id (`regen:<row.id>`) so
 * resolveSourceUrls' signalMap always has a key to match against.
 *
 * @param {object} row                content_queue row (SELECT *).
 * @param {object|null} [overrideOpportunity]  When provided (from
 *        --briefing-json), used verbatim as the single opportunity.
 * @returns {{ id: string, opportunities: object[] }}
 */
export function buildSyntheticBriefing(row, overrideOpportunity = null) {
  if (overrideOpportunity) {
    return { id: row.briefing_id, opportunities: [overrideOpportunity] };
  }

  const sources = Array.isArray(row.source_urls) ? row.source_urls : [];
  const primary = sources.find((s) => s && s.relation === 'primary_inspiration') || sources[0] || null;

  const signalId = (primary && primary.signal_id) || `regen:${row.id}`;

  const opportunity = {
    signal_id: signalId,
    source_url: (primary && primary.url) || '',
    source: (primary && primary.source) || 'regenerate',
    // Inherited routing context (also surfaced to the LLM via the prompt).
    content_pillar: row.content_pillar,
    age_range: row.age_range,
    // Authoring context so the regen is anchored to the original idea.
    title: row.hook || '',
    summary: row.caption || '',
  };

  return { id: row.briefing_id, opportunities: [opportunity] };
}

/**
 * Patch for the ORIGINAL row: flip to superseded, stamp superseded_by.
 * Merges prior metadata so existing keys (image_axes, etc.) survive.
 *
 * @param {object|null} priorMetadata  row.metadata before the patch.
 * @param {string} newId               id of the freshly inserted row.
 * @returns {{ status: 'superseded', metadata: object }}
 */
export function supersedeOriginalPatch(priorMetadata, newId) {
  return {
    status: 'superseded',
    metadata: {
      ...(priorMetadata || {}),
      superseded_by: newId,
      superseded_at: new Date().toISOString(),
    },
  };
}

/**
 * Metadata for the NEW row: stamp regenerated_from on top of whatever
 * metadata the insert already produced. Merge, never clobber.
 *
 * @param {object|null} priorMetadata  new row.metadata as inserted.
 * @param {string} originalId          id of the superseded original.
 * @returns {object}
 */
export function regeneratedFromMetadata(priorMetadata, originalId) {
  return {
    ...(priorMetadata || {}),
    regenerated_from: originalId,
  };
}
