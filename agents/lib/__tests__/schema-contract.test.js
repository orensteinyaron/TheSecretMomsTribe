/**
 * Schema-contract integration test.
 *
 * Runs against live Supabase when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * look real (skips with the 'http://localhost' / 'stub' test defaults).
 *
 * Purpose: catch schema-code drift at test time, NOT at GitHub Actions
 * time. For every column the agent writes into content_queue, assert
 * that every value the agent can emit is accepted by the DB.
 *
 * v2.0.0 (CHANNEL_MODEL_V1): the legacy `post_format` enum probe is
 * gone — that column is being dropped. The render_profile_slug → ID
 * resolution is exercised via the agent's lib helpers (covered by
 * render-profiles.test.js) and by a sanity probe here that confirms
 * every slug in ALL_RENDER_PROFILE_SLUGS resolves to a live row.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { VALID_PILLARS } from '../pillars.js';
import { ALL_RENDER_PROFILE_SLUGS } from '../render-profiles.js';

const hasRealSupabase =
  process.env.SUPABASE_URL &&
  !/localhost|stub/i.test(process.env.SUPABASE_URL) &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY !== 'stub';

// Agent-emitted value sets. Re-declared here rather than imported
// from agents/content.js because content.js has auto-main side
// effects (env checks, Supabase client init). These values must
// track content.js.
const AGENT_AGE_RANGES = ['toddler', 'little_kid', 'school_age', 'teen', 'universal'];
const AGENT_CONTENT_TYPES = ['wow', 'trust', 'cta'];

async function getSupabase() {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Parse PostgreSQL's `pg_get_constraintdef` for a CHECK-array form:
 *   CHECK ((column = ANY (ARRAY['a'::text, 'b'::text, ...])))
 * Returns the array of allowed literal values, or null if the
 * constraint doesn't match the expected shape.
 */
function parseCheckArray(def) {
  const match = def.match(/ARRAY\[([^\]]+)\]/);
  if (!match) return null;
  return match[1]
    .split(',')
    .map((s) => s.trim())
    .map((s) => s.replace(/::\w+$/, ''))      // strip type casts
    .map((s) => s.replace(/^'(.*)'$/, '$1')); // strip quotes
}

function expectSubset({ name, agent, dbAllowed }) {
  const missing = agent.filter((v) => !dbAllowed.includes(v));
  assert.deepEqual(
    missing,
    [],
    `${name}: agent emits values the DB does not accept.\n` +
    `  agent set:    ${JSON.stringify([...agent].sort())}\n` +
    `  DB accepts:   ${JSON.stringify([...dbAllowed].sort())}\n` +
    `  mismatch:     ${JSON.stringify(missing)}\n` +
    `Fix: align agent vocabulary with the DB, or add a migration.`,
  );
}

test('content_queue.content_pillar CHECK accepts every VALID_PILLARS value', { skip: !hasRealSupabase }, async () => {
  const supabase = await getSupabase();

  // Validate via synthetic insert probes — one per pillar.
  // briefing_id='0000…' fails FK (23503) for ALL of them (expected),
  // but any pillar value that fails with 23514 (check_violation) is
  // the drift we're looking for.
  const probeResults = await Promise.all(
    VALID_PILLARS.map(async (pillar) => {
      const { error: insertError } = await supabase
        .from('content_queue')
        .insert({
          briefing_id: '00000000-0000-0000-0000-000000000000',
          content_type: 'wow',
          status: 'draft',
          hook: 'probe hook',
          caption: 'probe caption that is long enough to satisfy constraints',
          hashtags: ['#probe'],
          age_range: 'universal',
          content_pillar: pillar,
          image_status: 'pending',
          launch_bank: false,
          slides: [],
          source_urls: [],
          metadata: {},
        })
        .select()
        .limit(0);
      return { pillar, error: insertError };
    }),
  );

  const pillarDrift = probeResults.filter(
    (r) => r.error && r.error.code === '23514' && /pillar_taxonomy/.test(r.error.message || ''),
  );
  assert.deepEqual(
    pillarDrift.map((r) => r.pillar),
    [],
    `VALID_PILLARS contains values rejected by content_queue_pillar_taxonomy:\n` +
    `  rejected: ${JSON.stringify(pillarDrift.map((r) => r.pillar))}\n` +
    `Either update pillars.js to match the DB or add a migration.`,
  );
});

test('content_queue enums accept every agent-emitted age_range / content_type', { skip: !hasRealSupabase }, async () => {
  const supabase = await getSupabase();

  // Probe each enum field by inserting a synthetic row with the
  // target value. Because briefing_id is a fake UUID we always get
  // an error back; we're checking its CODE.
  //   '22P02' = invalid_text_representation (enum rejected the value)
  //   '23503' = FK violation (value was accepted, FK then caught)
  //   '23514' = CHECK violation (pillar etc)
  async function probeEnum(column, value) {
    const baseline = {
      briefing_id: '00000000-0000-0000-0000-000000000000',
      content_type: 'wow',
      status: 'draft',
      hook: 'probe hook',
      caption: 'probe caption long enough to satisfy constraints',
      hashtags: ['#probe'],
      age_range: 'universal',
      content_pillar: 'ai_magic',
      image_status: 'pending',
      launch_bank: false,
      slides: [],
      source_urls: [],
      metadata: {},
    };
    const { error } = await supabase
      .from('content_queue')
      .insert({ ...baseline, [column]: value })
      .select()
      .limit(0);
    return error;
  }

  const findings = [];
  for (const v of AGENT_AGE_RANGES) {
    const err = await probeEnum('age_range', v);
    if (err && err.code === '22P02') findings.push({ column: 'age_range', value: v, error: err.message });
  }
  for (const v of AGENT_CONTENT_TYPES) {
    const err = await probeEnum('content_type', v);
    if (err && err.code === '22P02') findings.push({ column: 'content_type', value: v, error: err.message });
  }

  assert.deepEqual(
    findings,
    [],
    `Agent emits enum values the DB rejects:\n${JSON.stringify(findings, null, 2)}\n` +
    `Fix: align agent vocabulary with the DB, or add a migration.`,
  );
});

// v2.0.0 (CHANNEL_MODEL_V1): every agent-emitted render_profile_slug
// must resolve to a live row in render_profiles. Catches the case
// where the agent grows a new slug ahead of the DB seed.
test('render_profiles table has a row for every agent-emitted slug', { skip: !hasRealSupabase }, async () => {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from('render_profiles')
    .select('slug')
    .in('slug', [...ALL_RENDER_PROFILE_SLUGS]);
  assert.equal(error, null, `render_profiles select failed: ${error?.message}`);
  const present = new Set((data || []).map((r) => r.slug));
  const missing = ALL_RENDER_PROFILE_SLUGS.filter((s) => !present.has(s));
  assert.deepEqual(
    missing,
    [],
    `render_profiles is missing rows for slugs the agent emits: ${JSON.stringify(missing)}\n` +
    `Fix: seed render_profiles with the missing slug, or remove it from agents/lib/render-profiles.js.`,
  );
});

// v2.0.0: channel enum must accept the canonical channel set.
test('scheduled_posts.channel enum accepts tiktok + instagram', { skip: !hasRealSupabase }, async () => {
  const supabase = await getSupabase();
  for (const channel of ['tiktok', 'instagram']) {
    const { error } = await supabase
      .from('scheduled_posts')
      .insert({
        content_id: '00000000-0000-0000-0000-000000000000',
        channel,
        status: 'pending',
      })
      .select()
      .limit(0);
    // FK violation (23503) = channel accepted, content_id rejected → good.
    // Enum rejection (22P02) = drift → bad.
    if (error) {
      assert.notEqual(error.code, '22P02', `channel "${channel}" rejected by enum: ${error.message}`);
    }
  }
});

// Issue 1 regression lock (Run #667). Legacy single-column unique index
// `idx_published_posts_content` survived the published_posts → scheduled_posts
// rename and blocked every batch insert (5 pieces × 2 channels each → all
// rolled back atomically; pipeline reported clean while 0 rows persisted).
//
// This test pins the correct invariant: scheduled_posts permits exactly one
// row per (content_id, channel) pair — meaning N rows per content_id when
// the piece targets N channels, but never two rows with the same
// (content_id, channel).
test('scheduled_posts: 2 rows per content_id (one per channel) allowed; duplicate (content_id, channel) rejected', { skip: !hasRealSupabase }, async () => {
  const supabase = await getSupabase();
  const { randomUUID } = await import('node:crypto');

  // 1. Create a real content_queue row to attach to (avoids FK violation).
  //    Use a valid render_profile_id resolved at runtime.
  const { data: profile } = await supabase
    .from('render_profiles')
    .select('id')
    .eq('slug', 'static-image')
    .maybeSingle();
  assert.ok(profile?.id, 'static-image render profile must exist for this test');

  const probeHook = `schema-contract-probe-${randomUUID()}`;
  const { data: piece, error: pieceErr } = await supabase
    .from('content_queue')
    .insert({
      content_type: 'wow',
      status: 'draft',
      hook: probeHook,
      caption: 'schema-contract probe — please ignore',
      hashtags: ['#probe'],
      age_range: 'universal',
      content_pillar: 'ai_magic',
      image_status: 'pending',
      launch_bank: false,
      slides: [],
      source_urls: [],
      metadata: { probe: true },
      render_profile_id: profile.id,
    })
    .select('id')
    .single();
  assert.equal(pieceErr, null, `content_queue insert failed: ${pieceErr?.message}`);

  try {
    // 2. Insert one tiktok + one instagram row for this piece. Both must persist.
    const { error: ttErr } = await supabase
      .from('scheduled_posts')
      .insert({ content_id: piece.id, channel: 'tiktok', status: 'pending' })
      .select()
      .limit(0);
    assert.equal(ttErr, null, `tiktok row should insert: ${ttErr?.message}`);

    const { error: igErr } = await supabase
      .from('scheduled_posts')
      .insert({ content_id: piece.id, channel: 'instagram', status: 'pending' })
      .select()
      .limit(0);
    assert.equal(igErr, null, `instagram row should insert (this is the Run #667 regression): ${igErr?.message}`);

    const { data: rows } = await supabase
      .from('scheduled_posts')
      .select('channel')
      .eq('content_id', piece.id);
    assert.equal(rows?.length, 2, 'both channels must persist; expected 2 rows');
    assert.deepEqual(
      [...rows.map((r) => r.channel)].sort(),
      ['instagram', 'tiktok'],
      'expected one row per channel',
    );

    // 3. Duplicate (content_id, channel) MUST be rejected by the composite
    //    UNIQUE constraint. This is the correct invariant — the legacy
    //    single-column unique index was wrong, the composite is right.
    const { error: dupErr } = await supabase
      .from('scheduled_posts')
      .insert({ content_id: piece.id, channel: 'tiktok', status: 'pending' })
      .select()
      .limit(0);
    assert.ok(dupErr, 'duplicate (content_id, channel) must be rejected');
    assert.equal(dupErr.code, '23505', `expected unique_violation (23505), got ${dupErr.code}: ${dupErr.message}`);
  } finally {
    // Cleanup. ON DELETE CASCADE on scheduled_posts.content_id → content_queue
    // takes care of the children. If it doesn't, scheduled_posts cleanup is
    // explicit for safety.
    await supabase.from('scheduled_posts').delete().eq('content_id', piece.id);
    await supabase.from('content_queue').delete().eq('id', piece.id);
  }
});
