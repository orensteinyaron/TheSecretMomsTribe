/**
 * Unit tests for the Content Regeneration V1 script. Pure helpers are
 * tested directly; the full pipeline is exercised with a fake supabase
 * client and a fake anthropic client so no network is touched.
 *
 * Post CHANNEL_MODEL_V1: format = render profile. Fixtures speak
 * `render_profile_id` + `render_profile_slug`; the legacy format enum
 * column is gone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Env stubs so transitive imports of ./supabase.js don't process.exit.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub';

const {
  parseArgs,
  isEligible,
  projectRenderProfileSlug,
  captionLimitFor,
  normalizePost,
  runRegeneration,
  PRE_FIX_CUTOFF,
  RENDER_PROFILE_SLUGS,
} = await import('../regenerate-stale-drafts.js');

// Fake render_profiles rows the fake supabase serves up for both
// getRenderProfileMap (full table fetch) and the candidate join.
const FAKE_RENDER_PROFILES = [
  { id: 'rp-static',  slug: 'static-image',  name: 'Static Image',  profile_type: 'image', status: 'draft',  cost_estimate_usd: 0.08 },
  { id: 'rp-moving',  slug: 'moving-images', name: 'Moving Images', profile_type: 'video', status: 'active', cost_estimate_usd: 0.33 },
  { id: 'rp-carousel',slug: 'carousel',      name: 'Carousel',      profile_type: 'image', status: 'draft',  cost_estimate_usd: 0.32 },
  { id: 'rp-avatar',  slug: 'avatar-v1',     name: 'Avatar V1',     profile_type: 'video', status: 'active', cost_estimate_usd: 0.50 },
];

const SLUG_TO_ID = Object.fromEntries(FAKE_RENDER_PROFILES.map((p) => [p.slug, p.id]));

// Regression-lock: the legacy format column must never appear on regen
// inserts. Computed so the literal column name doesn't leak into the
// file (purged by CHANNEL_MODEL_V1).
const LEGACY_FORMAT_COLUMN = ['post', 'format'].join('_');

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
  // Default: a row that already has a render profile (static-image) and an
  // OVER-cap caption (500 > 300 cap), so it's eligible for regen.
  return {
    id: 'uuid-1',
    status: 'draft',
    created_at: '2026-04-05T00:00:00Z',
    hook: 'Some hook',
    caption: 'x'.repeat(500),
    slides: [],
    render_profile_id: SLUG_TO_ID['static-image'],
    render_profile_slug: 'static-image',
    metadata: {},
    ...partial,
  };
}

test('isEligible: static-image with 500-char caption (over 300 cap) → true', () => {
  assert.equal(isEligible(draftRow()), true);
});

test('isEligible: static-image with 90-char caption (passes gate) → false', () => {
  assert.equal(isEligible(draftRow({ caption: 'x'.repeat(90) })), false);
});

test('isEligible: status=approved → false', () => {
  assert.equal(isEligible(draftRow({ status: 'approved' })), false);
});

test('isEligible: created_at after cutoff → false', () => {
  assert.equal(isEligible(draftRow({ created_at: '2026-04-18T13:00:00Z' })), false);
});

test('isEligible: render_profile_id=null with caption+hook → true (slug pick)', () => {
  assert.equal(
    isEligible(draftRow({ render_profile_id: null, render_profile_slug: null })),
    true,
  );
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

test('isEligible: batch of 10 synthetic rows returns only failing drafts', () => {
  const batch = [
    draftRow({ id: '1' }),                              // eligible (over-cap caption)
    draftRow({ id: '2', caption: 'short.' }),           // passes gate → false
    draftRow({ id: '3', status: 'approved' }),          // wrong status
    draftRow({ id: '4', render_profile_id: null, render_profile_slug: null }), // null profile → eligible
    draftRow({ id: '5', created_at: '2027-01-01T00:00:00Z' }), // past cutoff
    draftRow({ id: '6', metadata: { superseded_by: 'x' } }),   // already done
    draftRow({ id: '7', hook: null }),                  // no hook
    draftRow({ id: '8', render_profile_id: SLUG_TO_ID['carousel'], render_profile_slug: 'carousel', caption: 'y'.repeat(900), slides: [{}, {}, {}] }), // eligible (>400)
    draftRow({ id: '9' }),                              // eligible (over-cap)
    draftRow({ id: '10', render_profile_id: SLUG_TO_ID['moving-images'], render_profile_slug: 'moving-images', caption: 'x'.repeat(500), slides: [{}, {}, {}] }), // eligible (500>400)
  ];
  const eligible = batch.filter((r) => isEligible(r)).map((r) => r.id);
  assert.deepEqual(eligible, ['1', '4', '8', '9', '10']);
});

// --- Render profile projection ---------------------------------------------

test('projectRenderProfileSlug: method/list insight → carousel on non-tiktok', () => {
  const row = { platform: 'instagram', hook: '3 ways to reset bedtime', caption: '' };
  const brief = { core_insight: 'Here are 3 ways to fix bedtime step 1 step 2 step 3 first second third', topic_summary: 'bedtime' };
  assert.equal(projectRenderProfileSlug(row, brief), RENDER_PROFILE_SLUGS.CAROUSEL);
});

test('projectRenderProfileSlug: short emotional punch → static-image', () => {
  const row = { platform: 'instagram', hook: 'You are not behind.', caption: '' };
  const brief = { core_insight: 'Reminder: you are not behind, you are human.', topic_summary: 'reassurance' };
  assert.equal(projectRenderProfileSlug(row, brief), RENDER_PROFILE_SLUGS.STATIC_IMAGE);
});

test('projectRenderProfileSlug: reveal/twist story → moving-images', () => {
  const row = { platform: 'tiktok', hook: 'I thought she was being defiant', caption: '' };
  const brief = { core_insight: 'But then I realized she was overwhelmed. Turns out it was nervous system.', topic_summary: 'meltdowns' };
  assert.equal(projectRenderProfileSlug(row, brief), RENDER_PROFILE_SLUGS.MOVING_IMAGES);
});

test('captionLimitFor: known slugs', () => {
  assert.equal(captionLimitFor('static-image'),  300);
  assert.equal(captionLimitFor('carousel'),      400);
  assert.equal(captionLimitFor('moving-images'), 400);
  assert.equal(captionLimitFor('avatar-v1'),     400);
  // Unknown slug → default
  assert.equal(captionLimitFor('unknown'),       300);
  assert.equal(captionLimitFor(null),            300);
});

// --- Preservation -----------------------------------------------------------

test('normalizePost: preserves hook, briefing_id, age_range, content_pillar', () => {
  const row = {
    id: 'original-uuid',
    content_type: 'trust',
    hook: "You're not behind, you're human.",
    briefing_id: 'briefing-uuid',
    age_range: 'universal',
    content_pillar: 'health',
    source_urls: [{ url: 'https://example.com', signal_id: 'sig-1', relation: 'primary_inspiration', source: 'reddit' }],
  };
  const gen = {
    render_profile_slug: 'static-image',
    hook: "You're not behind, you're human.",
    caption: 'A quiet reminder for tonight.',
    hashtags: ['momhealth'],
    slides: [],
    image_prompt: { prompt: 'Warm kitchen hands', axes: { shot_type: 'close_up', lighting: 'warm_golden_hour', palette: 'amber_cream', subject: 'rachel_hand', mood: 'tender', rachel_mode: 'broll' } },
  };
  const post = normalizePost(row, gen, 'static-image', { topic_summary: 't', core_insight: 'c', emotional_register: 'tender' });

  assert.equal(post.hook, row.hook);
  assert.equal(post.briefing_id, row.briefing_id);
  assert.equal(post.age_range, row.age_range);
  assert.equal(post.content_pillar, row.content_pillar);
  assert.equal(post.render_profile_slug, 'static-image');
  assert.deepEqual(post.source_urls, row.source_urls);
  assert.equal(post.image_axes.shot_type, 'close_up');
  assert.equal(post.image_axes.rachel_mode, 'broll');
  assert.equal(post.hashtags[0], '#momhealth'); // auto-hashed
});

// --- Full pipeline with fakes ----------------------------------------------

function makeFakeSupabase({ candidates = [], insertFails = false, renderProfiles = FAKE_RENDER_PROFILES } = {}) {
  const inserts = [];
  const updates = [];

  // Synthesize the joined `render_profiles` field that the real
  // supabase-js client would produce for `select('*, render_profiles(slug)')`.
  function joinRenderProfile(row) {
    if (!row.render_profile_id) return { ...row, render_profiles: null };
    const rp = renderProfiles.find((p) => p.id === row.render_profile_id);
    return { ...row, render_profiles: rp ? { slug: rp.slug } : null };
  }

  function makeQB(rows) {
    const filtered = rows.slice();
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
      if (table === 'render_profiles') {
        const qb = makeQB(renderProfiles);
        return qb;
      }
      const isContent = table === 'content_queue';
      const rows = isContent ? candidates.map(joinRenderProfile) : [];
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
  const candidate = draftRow({
    id: 'pre-fix',
    content_type: 'trust',
    age_range: 'universal',
    content_pillar: 'health',
    hook: 'H',
    caption: 'x'.repeat(900),
    slides: [],
  });
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
  const candidate = draftRow({
    id: 'orig-1',
    content_type: 'trust',
    age_range: 'universal',
    content_pillar: 'health',
    hook: 'Locked hook',
    caption: 'x'.repeat(900),
    slides: [],
    metadata: {},
  });
  const supabase = makeFakeSupabase({ candidates: [candidate] });
  const anthropic = makeFakeAnthropic([
    { text: JSON.stringify({ topic_summary: 't', core_insight: 'c', emotional_register: 'tender' }) },
    { text: JSON.stringify({
      render_profile_slug: 'static-image',
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
  // CHANNEL_MODEL_V1: row carries render_profile_id, no legacy format column.
  assert.equal(supabase._inserts[0].render_profile_id, SLUG_TO_ID['static-image']);
  assert.ok(!(LEGACY_FORMAT_COLUMN in supabase._inserts[0]), 'must not write legacy format column');
  assert.equal(supabase._inserts[0].render_status, 'pending');
  // Original should be updated to superseded.
  assert.equal(supabase._updates.length, 1);
  assert.equal(supabase._updates[0].patch.status, 'superseded');
  assert.match(supabase._updates[0].patch.metadata.superseded_by, /^new-/);
});

test('runRegeneration: 2-attempt cap → draft_needs_review when LLM keeps overshooting', async () => {
  const candidate = draftRow({
    id: 'orig-2',
    content_type: 'trust',
    age_range: 'universal',
    content_pillar: 'health',
    hook: 'Locked',
    caption: 'x'.repeat(900),
  });
  const supabase = makeFakeSupabase({ candidates: [candidate] });
  const tooLong = 'y'.repeat(700); // way over static-image 300 cap
  const anthropic = makeFakeAnthropic([
    { text: JSON.stringify({ topic_summary: 't', core_insight: 'c', emotional_register: 'tender' }) },
    { text: JSON.stringify({ render_profile_slug: 'static-image', hook: 'Locked', caption: tooLong, hashtags: ['x'], slides: [], image_prompt: { prompt: 'p', axes: { shot_type: 'close_up', lighting: 'warm_golden_hour', palette: 'amber_cream', subject: 'rachel_hand', mood: 'tender', rachel_mode: 'broll' } } }) },
    { text: JSON.stringify({ render_profile_slug: 'static-image', hook: 'Locked', caption: tooLong, hashtags: ['x'], slides: [], image_prompt: { prompt: 'p', axes: { shot_type: 'close_up', lighting: 'warm_golden_hour', palette: 'amber_cream', subject: 'rachel_hand', mood: 'tender', rachel_mode: 'broll' } } }) },
  ]);
  const stdout = { log: () => {}, error: () => {} };

  await runRegeneration({ argv: ['--confirm'], supabase, anthropic, stdout });
  assert.equal(supabase._inserts.length, 1);
  assert.equal(supabase._inserts[0].status, 'draft_needs_review');
  assert.ok(supabase._inserts[0].metadata.format_flags.length > 0);
  assert.ok(!(LEGACY_FORMAT_COLUMN in supabase._inserts[0]), 'must not write legacy format column');
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
