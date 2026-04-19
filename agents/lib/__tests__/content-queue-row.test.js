/**
 * Tests for the content_queue INSERT-payload builder.
 *
 * Regression pinned: `platform` was dropped from content_queue by
 * migration 20260418171725_drop_platform_add_channel_scheduling per
 * PIECE_PAGE_LIFECYCLE_V1 §3.1. Writing it caused PGRST204 on every
 * content-gen run. These tests ensure the builder never leaks
 * platform into the INSERT payload and that every column it does
 * write still exists in the live schema.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildContentQueueRow } from '../content-queue-row.js';

// Sample piece shaped like what generateBatch + normalizeImageFields produce.
function samplePiece(overrides = {}) {
  return {
    hook: 'The secret mom hack',
    caption: 'A caption that is definitely long enough for the gate',
    hashtags: ['#momlife', '#parentingtips', '#momhacks'],
    content_type: 'wow',
    age_range: 'toddler',
    content_pillar: 'ai_magic',
    post_format: 'tiktok_slideshow',
    platform: 'tiktok',            // in-memory routing — MUST NOT reach DB
    ai_magic_output: 'some magic',
    image_prompt: 'prompt',
    audio_suggestion: null,
    slides: [{ text: 'slide 1' }],
    avatar_config: null,
    source_urls: [{ signal_id: 'sig-a', url: 'https://reddit.com/x' }],
    image_axes: { demographic: 'mom' },
    format_flags: [],
    metadata: { extra: 'ok' },
    ...overrides,
  };
}

const OPTS = { briefingId: 'brief-1', renderProfileId: 'rp-1', density: 'mixed' };

// --- Regression: platform must not appear in the INSERT payload ------------

test('buildContentQueueRow: NEVER includes platform (column was dropped)', () => {
  const row = buildContentQueueRow(samplePiece(), OPTS);
  assert.ok(!('platform' in row), `platform leaked into row: ${JSON.stringify(Object.keys(row))}`);
});

test('buildContentQueueRow: does not include channel_override by default', () => {
  // Per PIECE_PAGE_LIFECYCLE_V1 — default is dual-platform. channel_override
  // is set only by explicit single-platform routing, which no caller does today.
  const row = buildContentQueueRow(samplePiece(), OPTS);
  assert.ok(!('channel_override' in row));
});

// --- Whitelist: columns that SHOULD be written -----------------------------

test('buildContentQueueRow: writes the expected whitelist columns', () => {
  const row = buildContentQueueRow(samplePiece(), OPTS);
  const expected = [
    'briefing_id', 'content_type', 'status',
    'hook', 'caption', 'hashtags',
    'ai_magic_output', 'image_prompt', 'audio_suggestion',
    'age_range', 'content_pillar', 'post_format',
    'slides', 'avatar_config',
    'image_status', 'launch_bank', 'quality_rating',
    'render_profile_id', 'render_status',
    'source_urls', 'metadata',
  ];
  for (const col of expected) {
    assert.ok(col in row, `expected column "${col}" missing from row`);
  }
});

test('buildContentQueueRow: status_hint=draft_needs_review maps status→draft_needs_review', () => {
  const row = buildContentQueueRow(samplePiece({ status_hint: 'draft_needs_review' }), OPTS);
  assert.equal(row.status, 'draft_needs_review');
});

test('buildContentQueueRow: no status_hint defaults status to draft', () => {
  const row = buildContentQueueRow(samplePiece(), OPTS);
  assert.equal(row.status, 'draft');
});

test('buildContentQueueRow: null renderProfileId → render_status null', () => {
  const row = buildContentQueueRow(samplePiece(), { ...OPTS, renderProfileId: null });
  assert.equal(row.render_profile_id, null);
  assert.equal(row.render_status, null);
});

test('buildContentQueueRow: populated renderProfileId → render_status pending', () => {
  const row = buildContentQueueRow(samplePiece(), OPTS);
  assert.equal(row.render_profile_id, 'rp-1');
  assert.equal(row.render_status, 'pending');
});

test('buildContentQueueRow: metadata merges piece.metadata with image_axes, density, format_flags', () => {
  const row = buildContentQueueRow(
    samplePiece({ metadata: { custom: 'keep' }, image_axes: { x: 1 }, format_flags: ['tight'] }),
    { ...OPTS, density: 'dense' },
  );
  assert.equal(row.metadata.custom, 'keep');
  assert.deepEqual(row.metadata.image_axes, { x: 1 });
  assert.equal(row.metadata.density_classification, 'dense');
  assert.deepEqual(row.metadata.format_flags, ['tight']);
});

test('buildContentQueueRow: non-array source_urls defaults to []', () => {
  const row = buildContentQueueRow(samplePiece({ source_urls: undefined }), OPTS);
  assert.deepEqual(row.source_urls, []);
});

// --- Schema integration: whitelist matches live content_queue columns -----
//
// Runs only when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY look real
// (not the 'stub' / 'http://localhost' test defaults). This is the
// drift detector — if a future migration drops another column, this
// test fails before the GitHub Actions run fails.

const hasRealSupabase =
  process.env.SUPABASE_URL &&
  !/localhost|stub/i.test(process.env.SUPABASE_URL) &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY !== 'stub';

test('integration: every column in buildContentQueueRow exists in live content_queue schema', { skip: !hasRealSupabase }, async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  // Cheapest way to discover columns without RPC: head request. Pull
  // a 0-row result; response metadata carries column info via the
  // underlying PostgREST schema cache which is what the failing run hit.
  const { error } = await supabase.from('content_queue').select('*').limit(0);
  assert.equal(error, null, `content_queue select failed: ${error?.message}`);

  // Use information_schema via a proper query through a freshly-inserted
  // view would be overkill. Instead, we attempt a dry-run insert with
  // the built row and assert PostgREST does NOT return PGRST204.
  const row = buildContentQueueRow(samplePiece(), OPTS);

  // Try to insert; roll back whatever we wrote so the test is
  // idempotent. Use a throwaway briefing_id that won't match an FK.
  const { error: insertError } = await supabase
    .from('content_queue')
    .insert({ ...row, briefing_id: '00000000-0000-0000-0000-000000000000' })
    .select()
    .limit(0);

  // Expected: either success (unlikely, FK would break), or an FK
  // violation (23503), or some other NON-PGRST204 error. We specifically
  // want to catch PGRST204 "column not in schema cache" — that's the
  // drift we're guarding against.
  if (insertError) {
    assert.notEqual(insertError.code, 'PGRST204',
      `content_queue schema drifted — column missing: ${insertError.message}`);
  }
});
