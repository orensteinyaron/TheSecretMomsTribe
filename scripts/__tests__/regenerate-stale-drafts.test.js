/**
 * Unit tests for the Content Regeneration V1 script. Pure helpers are
 * tested directly; the full pipeline is exercised with a fake supabase
 * client and a fake anthropic client so no network is touched.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Env stubs so transitive imports of ./supabase.js don't process.exit.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub';

const {
  parseArgs,
  isEligible,
  projectFormat,
  captionLimitFor,
  normalizePost,
  runRegeneration,
  PRE_FIX_CUTOFF,
} = await import('../regenerate-stale-drafts.js');

// --- Argv parsing -----------------------------------------------------------

test('parseArgs: --dry-run sets dryRun', () => {
  assert.deepEqual(parseArgs(['--dry-run']).dryRun, true);
});

test('parseArgs: --confirm clears default dry-run', () => {
  const a = parseArgs(['--confirm']);
  assert.equal(a.confirm, true);
  assert.equal(a.dryRun, false);
});

test('parseArgs: default is dry-run when no flags', () => {
  assert.equal(parseArgs([]).dryRun, true);
});

test('parseArgs: --limit + --ids in both forms', () => {
  const a = parseArgs(['--limit', '3', '--ids=a,b,c', '--confirm']);
  assert.equal(a.limit, 3);
  assert.deepEqual(a.ids, ['a', 'b', 'c']);
  assert.equal(a.confirm, true);
});

// --- Eligibility ------------------------------------------------------------

function draftRow(partial = {}) {
  return {
    id: 'uuid-1',
    status: 'draft',
    created_at: '2026-04-05T00:00:00Z',
    hook: 'Some hook',
    caption: 'x'.repeat(500),
    slides: [],
    post_format: 'ig_static',
    metadata: {},
    ...partial,
  };
}

test('isEligible: ig_static with 500-char caption (over 125) → true', () => {
  assert.equal(isEligible(draftRow()), true);
});

test('isEligible: ig_static with 90-char caption (passes gate) → false', () => {
  assert.equal(isEligible(draftRow({ caption: 'x'.repeat(90) })), false);
});

test('isEligible: status=approved → false', () => {
  assert.equal(isEligible(draftRow({ status: 'approved' })), false);
});

test('isEligible: created_at after cutoff → false', () => {
  assert.equal(isEligible(draftRow({ created_at: '2026-04-18T13:00:00Z' })), false);
});

test('isEligible: post_format=null with caption+hook → true (format pick)', () => {
  assert.equal(isEligible(draftRow({ post_format: null })), true);
});

test('isEligible: already superseded → false (idempotent)', () => {
  assert.equal(isEligible(draftRow({ metadata: { superseded_by: 'other-uuid' } })), false);
});

test('isEligible: missing hook → false', () => {
  assert.equal(isEligible(draftRow({ hook: '' })), false);
});

test('isEligible: no caption and no slides → false', () => {
  assert.equal(isEligible(draftRow({ caption: '', slides: [] })), false);
});

test('isEligible: batch of 10 synthetic rows returns only the failing drafts', () => {
  const batch = [
    draftRow({ id: '1' }),                              // eligible
    draftRow({ id: '2', caption: 'short.' }),           // passes gate → false
    draftRow({ id: '3', status: 'approved' }),          // wrong status
    draftRow({ id: '4', post_format: null }),           // null format → eligible
    draftRow({ id: '5', created_at: '2027-01-01T00:00:00Z' }), // past cutoff
    draftRow({ id: '6', metadata: { superseded_by: 'x' } }),   // already done
    draftRow({ id: '7', hook: null }),                  // no hook
    draftRow({ id: '8', post_format: 'ig_carousel', caption: 'y'.repeat(900), slides: [{}, {}, {}] }), // eligible
    draftRow({ id: '9' }),                              // eligible
    draftRow({ id: '10', post_format: 'tiktok_slideshow', caption: 'x'.repeat(110), slides: [{}, {}, {}] }), // eligible (110>100)
  ];
  const eligible = batch.filter((r) => isEligible(r)).map((r) => r.id);
  assert.deepEqual(eligible, ['1', '4', '8', '9', '10']);
});

// --- Format projection ------------------------------------------------------

test('projectFormat: insight implying a method → ig_carousel on IG', () => {
  const row = { platform: 'instagram', hook: '3 ways to reset bedtime', caption: '' };
  const brief = { core_insight: 'Here are 3 ways to fix bedtime step 1 step 2 step 3 first second third', topic_summary: 'bedtime' };
  assert.equal(projectFormat(row, brief), 'ig_carousel');
});

test('projectFormat: short emotional punch on IG → ig_static', () => {
  const row = { platform: 'instagram', hook: 'You are not behind.', caption: '' };
  const brief = { core_insight: 'Reminder: you are not behind, you are human.', topic_summary: 'reassurance' };
  assert.equal(projectFormat(row, brief), 'ig_static');
});

test('projectFormat: story with reveal → tiktok_slideshow', () => {
  const row = { platform: 'tiktok', hook: 'I thought she was being defiant', caption: '' };
  const brief = { core_insight: 'But then I realized she was overwhelmed. Turns out it was nervous system.', topic_summary: 'meltdowns' };
  assert.equal(projectFormat(row, brief), 'tiktok_slideshow');
});

test('captionLimitFor: known formats', () => {
  assert.equal(captionLimitFor('ig_static'), 125);
  assert.equal(captionLimitFor('ig_carousel'), 400);
  assert.equal(captionLimitFor('tiktok_slideshow'), 100);
  assert.equal(captionLimitFor('tiktok_avatar'), 150);
});

// --- Preservation -----------------------------------------------------------

test('normalizePost: preserves hook, briefing_id, age_range, content_pillar', () => {
  const row = {
    id: 'original-uuid',
    platform: 'instagram',
    content_type: 'trust',
    hook: "You're not behind, you're human.",
    briefing_id: 'briefing-uuid',
    age_range: 'universal',
    content_pillar: 'mom_health',
    source_urls: [{ url: 'https://example.com', signal_id: 'sig-1', relation: 'primary_inspiration', source: 'reddit' }],
  };
  const gen = {
    post_format: 'ig_static',
    hook: "You're not behind, you're human.",
    caption: 'A quiet reminder for tonight.',
    hashtags: ['momhealth'],
    slides: [],
    image_prompt: { prompt: 'Warm kitchen hands', axes: { shot_type: 'close_up', lighting: 'warm_golden_hour', palette: 'amber_cream', subject: 'rachel_hand', mood: 'tender', rachel_mode: 'broll' } },
  };
  const post = normalizePost(row, gen, 'ig_static', { topic_summary: 't', core_insight: 'c', emotional_register: 'tender' });

  assert.equal(post.hook, row.hook);
  assert.equal(post.briefing_id, row.briefing_id);
  assert.equal(post.age_range, row.age_range);
  assert.equal(post.content_pillar, row.content_pillar);
  assert.deepEqual(post.source_urls, row.source_urls);
  assert.equal(post.image_axes.shot_type, 'close_up');
  assert.equal(post.image_axes.rachel_mode, 'broll');
  assert.equal(post.hashtags[0], '#momhealth'); // auto-hashed
});

// --- Full pipeline with fakes ----------------------------------------------

function makeFakeSupabase({ candidates = [], insertFails = false } = {}) {
  const inserts = [];
  const updates = [];

  function makeQB(rows) {
    let filtered = rows.slice();
    const qb = {
      _filtered: filtered,
      select() { return qb; },
      eq(col, val) { qb._filtered = qb._filtered.filter((r) => r[col] === val); return qb; },
      lt(col, val) { qb._filtered = qb._filtered.filter((r) => new Date(r[col]) < new Date(val)); return qb; },
      order() { return qb; },
      in(col, arr) { qb._filtered = qb._filtered.filter((r) => arr.includes(r[col])); return qb; },
      async then(resolve) { resolve({ data: qb._filtered, error: null }); },
      limit() { return qb; },
      async single() { return { data: qb._filtered[0] || null, error: null }; },
    };
    return qb;
  }

  return {
    _inserts: inserts,
    _updates: updates,
    from(table) {
      const isContent = table === 'content_queue';
      const rows = isContent ? candidates : [];
      const qb = makeQB(rows);
      qb.insert = (row) => {
        if (insertFails) return { select: () => ({ single: async () => ({ data: null, error: { message: 'insert failed' } }) }) };
        const id = `new-${inserts.length + 1}`;
        // Only count writes to content_queue — cost_log/activity_log writes
        // are infrastructure noise for these tests.
        if (isContent) inserts.push({ id, ...row });
        return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) };
      };
      qb.update = (patch) => ({
        eq: (col, val) => {
          if (isContent) updates.push({ table, col, val, patch });
          return Promise.resolve({ error: null });
        },
      });
      return qb;
    },
  };
}

function makeFakeAnthropic(responses) {
  const plan = Array.isArray(responses) ? [...responses] : [responses];
  return {
    messages: {
      async create({ messages }) {
        const body = messages[0].content;
        const next = plan.shift() || { text: '{}', usage: { input_tokens: 100, output_tokens: 50 } };
        const text = typeof next === 'function' ? next(body) : next.text;
        return {
          content: [{ type: 'text', text }],
          usage: next.usage || { input_tokens: 100, output_tokens: 50 },
        };
      },
    },
  };
}

test('runRegeneration: dry-run returns plan without any DB writes', async () => {
  const candidate = draftRow({ id: 'pre-fix', platform: 'instagram', content_type: 'trust', age_range: 'universal', content_pillar: 'mom_health', hook: 'H', caption: 'x'.repeat(900), slides: [] });
  const supabase = makeFakeSupabase({ candidates: [candidate] });
  const anthropic = makeFakeAnthropic([
    { text: JSON.stringify({ topic_summary: 'topic', core_insight: 'insight', emotional_register: 'tender' }) },
  ]);
  const logged = [];
  const stdout = { log: (m) => logged.push(m), error: (m) => logged.push(`ERR ${m}`) };

  const out = await runRegeneration({ argv: ['--dry-run'], supabase, anthropic, stdout });
  assert.equal(out.mode, 'dry-run');
  assert.equal(out.count, 1);
  assert.equal(supabase._inserts.length, 0);
  assert.equal(supabase._updates.length, 0);
});

test('runRegeneration: confirm run writes new row + marks superseded', async () => {
  const candidate = draftRow({ id: 'orig-1', platform: 'instagram', content_type: 'trust', age_range: 'universal', content_pillar: 'mom_health', hook: 'Locked hook', caption: 'x'.repeat(900), slides: [], metadata: {} });
  const supabase = makeFakeSupabase({ candidates: [candidate] });
  const anthropic = makeFakeAnthropic([
    { text: JSON.stringify({ topic_summary: 't', core_insight: 'c', emotional_register: 'tender' }) },
    { text: JSON.stringify({
      post_format: 'ig_static',
      hook: 'Locked hook',
      caption: 'Short in-limit caption.',
      hashtags: ['momhealth'],
      slides: [],
      image_prompt: { prompt: 'warm kitchen', axes: { shot_type: 'close_up', lighting: 'warm_golden_hour', palette: 'amber_cream', subject: 'rachel_hand', mood: 'tender', rachel_mode: 'broll' } },
    }) },
  ]);
  const stdout = { log: () => {}, error: () => {} };

  const out = await runRegeneration({ argv: ['--confirm'], supabase, anthropic, stdout });
  assert.equal(out.mode, 'confirm');
  assert.equal(supabase._inserts.length, 1);
  assert.equal(supabase._inserts[0].hook, 'Locked hook');
  assert.equal(supabase._inserts[0].status, 'draft');
  // Original should be updated to superseded
  assert.equal(supabase._updates.length, 1);
  assert.equal(supabase._updates[0].patch.status, 'superseded');
  assert.match(supabase._updates[0].patch.metadata.superseded_by, /^new-/);
});

test('runRegeneration: 2-attempt cap → draft_needs_review when LLM keeps overshooting', async () => {
  const candidate = draftRow({ id: 'orig-2', platform: 'instagram', content_type: 'trust', age_range: 'universal', content_pillar: 'mom_health', hook: 'Locked', caption: 'x'.repeat(900) });
  const supabase = makeFakeSupabase({ candidates: [candidate] });
  const tooLong = 'y'.repeat(500); // way over ig_static 125 cap
  const anthropic = makeFakeAnthropic([
    { text: JSON.stringify({ topic_summary: 't', core_insight: 'c', emotional_register: 'tender' }) },
    { text: JSON.stringify({ post_format: 'ig_static', hook: 'Locked', caption: tooLong, hashtags: ['x'], slides: [], image_prompt: { prompt: 'p', axes: { shot_type: 'close_up', lighting: 'warm_golden_hour', palette: 'amber_cream', subject: 'rachel_hand', mood: 'tender', rachel_mode: 'broll' } } }) },
    { text: JSON.stringify({ post_format: 'ig_static', hook: 'Locked', caption: tooLong, hashtags: ['x'], slides: [], image_prompt: { prompt: 'p', axes: { shot_type: 'close_up', lighting: 'warm_golden_hour', palette: 'amber_cream', subject: 'rachel_hand', mood: 'tender', rachel_mode: 'broll' } } }) },
  ]);
  const stdout = { log: () => {}, error: () => {} };

  await runRegeneration({ argv: ['--confirm'], supabase, anthropic, stdout });
  assert.equal(supabase._inserts.length, 1);
  assert.equal(supabase._inserts[0].status, 'draft_needs_review');
  assert.ok(supabase._inserts[0].metadata.format_flags.length > 0);
});

test('runRegeneration: idempotency — pre-superseded rows are skipped in filter', async () => {
  const already = draftRow({ id: 'orig-3', metadata: { superseded_by: 'new-9' } });
  const supabase = makeFakeSupabase({ candidates: [already] });
  const anthropic = makeFakeAnthropic([]);
  const stdout = { log: () => {}, error: () => {} };

  const out = await runRegeneration({ argv: ['--dry-run'], supabase, anthropic, stdout });
  assert.equal(out.count, 0);
  assert.equal(supabase._inserts.length, 0);
});

// Sanity: the PRE_FIX_CUTOFF constant matches spec.
test('PRE_FIX_CUTOFF is pre-V1 timestamp', () => {
  assert.equal(PRE_FIX_CUTOFF, '2026-04-18T12:50:00Z');
});
