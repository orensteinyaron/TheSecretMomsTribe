/**
 * Schema-contract integration test.
 *
 * Runs against live Supabase when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * look real (skips with the 'http://localhost' / 'stub' test defaults).
 *
 * Purpose: catch schema-code drift at test time, NOT at GitHub Actions
 * time. For every column the agent writes into content_queue, assert
 * that every value the agent can emit is accepted by the DB's CHECK
 * constraint (pillar) or enum type (post_format, content_type,
 * age_range).
 *
 * This is the guard installed alongside the V1.1 pillar rename —
 * next schema migration that tightens a value set will fail this
 * test before it reaches production.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { VALID_PILLARS } from '../pillars.js';

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

// Known-pending drift: the agent's local VALID_POST_FORMATS includes
// tiktok_avatar / tiktok_avatar_visual for the avatar video feature,
// but those values are NOT in the DB post_format enum and are NOT in
// the content-prompt output schema (so the LLM cannot actually emit
// them today). Scope-strict: tracked separately. Remove from this
// exclusion list once the avatar formats are added to the DB enum.
const AGENT_POST_FORMATS = ['tiktok_slideshow', 'tiktok_text', 'ig_carousel', 'ig_static', 'ig_meme', 'video_script'];

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
          post_format: 'tiktok_slideshow',
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

test('content_queue enums accept every agent-emitted age_range / content_type / post_format', { skip: !hasRealSupabase }, async () => {
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
      post_format: 'tiktok_slideshow',
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
  for (const v of AGENT_POST_FORMATS) {
    const err = await probeEnum('post_format', v);
    if (err && err.code === '22P02') findings.push({ column: 'post_format', value: v, error: err.message });
  }

  assert.deepEqual(
    findings,
    [],
    `Agent emits enum values the DB rejects:\n${JSON.stringify(findings, null, 2)}\n` +
    `Fix: align agent vocabulary with the DB, or add a migration.`,
  );
});
