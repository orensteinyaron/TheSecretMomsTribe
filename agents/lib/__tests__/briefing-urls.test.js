/**
 * Tests for briefing URL validation + sizing constants.
 *
 * Unit tests exercise validateBriefingUrls directly with a fake URL
 * validator and a fake activity logger.
 *
 * The integration test simulates the shape the research agent uses
 * today (8 candidate opportunities from over-generation, 3 with dead
 * TikTok URLs, 5 with live URLs) and asserts the final sliced briefing
 * comes back with 5 live replacements — proving the backfill works.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Env stubs for any transitive imports of ./supabase.js
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub';

const {
  BRIEFING_TARGET,
  BRIEFING_REQUEST_COUNT,
  MIN_ACCEPTABLE_BRIEFING,
  validateBriefingUrls,
} = await import('../briefing-urls.js');

// --- Constants -------------------------------------------------------------

test('constants: BRIEFING_TARGET=5, REQUEST_COUNT=ceil(5*1.6)=8, MIN=3', () => {
  assert.equal(BRIEFING_TARGET, 5);
  assert.equal(BRIEFING_REQUEST_COUNT, 8);
  assert.equal(MIN_ACCEPTABLE_BRIEFING, 3);
});

test('constants: request count gives at least target+1 headroom', () => {
  // Catches regression if someone later reduces the multiplier below 1.2.
  assert.ok(BRIEFING_REQUEST_COUNT >= BRIEFING_TARGET + 1);
});

// --- validateBriefingUrls --------------------------------------------------

function makeFakeValidate({ deadPatterns = [] } = {}) {
  return async (url) => {
    for (const pat of deadPatterns) {
      if (url.includes(pat)) {
        return { valid: false, reason: 'content_removed', status: 200, platform: 'tiktok.com' };
      }
    }
    return { valid: true, status: 200, platform: null };
  };
}

function makeCapturingLog() {
  const events = [];
  return { log: async (ev) => { events.push(ev); }, events };
}

test('validateBriefingUrls: drops dead URLs, keeps live, populates platform slug', async () => {
  const opps = [
    { topic: 'live reddit',      source_url: 'https://reddit.com/r/x/1' },
    { topic: 'dead tiktok',      source_url: 'https://tiktok.com/@a/video/2' },
    { topic: 'live instagram',   source_url: 'https://instagram.com/p/abc/' },
    { topic: 'no url',           source_url: '' },
  ];
  const { log, events } = makeCapturingLog();

  const { surviving, checked, dropped } = await validateBriefingUrls(opps, {
    validate: makeFakeValidate({ deadPatterns: ['tiktok.com'] }),
    log,
  });

  assert.equal(checked, 3);                      // 3 had URLs
  assert.equal(dropped, 1);                      // 1 was dead
  assert.equal(surviving.length, 3);             // live-reddit, live-ig, no-url all survive
  assert.equal(surviving[0].platform, 'reddit');
  assert.equal(surviving[1].platform, 'instagram');
  assert.equal(surviving[2].platform, 'unknown');
});

test('validateBriefingUrls: logs url_validation_dropped_research per dead URL', async () => {
  const opps = [
    { topic: 'a', source_url: 'https://tiktok.com/@a/video/1', signal_id: 'sig-a' },
    { topic: 'b', source_url: 'https://tiktok.com/@b/video/2', signal_id: 'sig-b' },
  ];
  const { log, events } = makeCapturingLog();

  await validateBriefingUrls(opps, {
    validate: makeFakeValidate({ deadPatterns: ['tiktok.com'] }),
    log,
  });

  assert.equal(events.length, 2);
  for (const ev of events) {
    assert.equal(ev.category,   'debug');
    assert.equal(ev.actor_type, 'agent');
    assert.equal(ev.actor_name, 'research-agent');
    assert.equal(ev.action,     'url_validation_dropped_research');   // spec-required suffix
    assert.equal(ev.metadata.platform, 'tiktok');
    assert.equal(ev.metadata.reason,   'content_removed');
    assert.ok(ev.metadata.signal_id.startsWith('sig-'));
  }
});

test('validateBriefingUrls: all-live batch → zero drops, zero log events', async () => {
  const opps = [
    { topic: 'a', source_url: 'https://reddit.com/r/x/1' },
    { topic: 'b', source_url: 'https://reddit.com/r/x/2' },
  ];
  const { log, events } = makeCapturingLog();
  const { dropped } = await validateBriefingUrls(opps, {
    validate: makeFakeValidate({ deadPatterns: [] }),
    log,
  });
  assert.equal(dropped, 0);
  assert.equal(events.length, 0);
});

test('validateBriefingUrls: opportunity without URL survives (not "dropped")', async () => {
  const opps = [{ topic: 'no-url', source_url: '' }];
  const { log } = makeCapturingLog();
  const { surviving, checked, dropped } = await validateBriefingUrls(opps, {
    validate: async () => ({ valid: false }),   // would be dead if it had a URL
    log,
  });
  assert.equal(surviving.length, 1);
  assert.equal(checked, 0);
  assert.equal(dropped, 0);
  assert.equal(surviving[0].platform, 'unknown');
});

test('validateBriefingUrls: malformed URL host still gets platform="other"-or-"unknown"', async () => {
  const opps = [{ topic: 'x', source_url: 'https://some-random.net/thread/1' }];
  const { log } = makeCapturingLog();
  const { surviving } = await validateBriefingUrls(opps, {
    validate: makeFakeValidate({ deadPatterns: [] }),
    log,
  });
  assert.equal(surviving[0].platform, 'other');
});

// --- Integration: 8-candidates-with-3-dead → 5 live replacements ----------

test('integration: 8 candidates with 3 dead TikTok URLs → briefing slices to 5 live replacements', async () => {
  // Shape matches what research.js asks Haiku for after over-generation:
  // BRIEFING_REQUEST_COUNT opportunities from the raw signal pool.
  const candidates = [
    { topic: 't1', source_url: 'https://reddit.com/r/a/1' },              // live
    { topic: 't2', source_url: 'https://tiktok.com/@a/video/1' },         // dead
    { topic: 't3', source_url: 'https://reddit.com/r/c/3' },              // live
    { topic: 't4', source_url: 'https://tiktok.com/@b/video/2' },         // dead
    { topic: 't5', source_url: 'https://instagram.com/p/e/' },            // live
    { topic: 't6', source_url: 'https://reddit.com/r/f/6' },              // live
    { topic: 't7', source_url: 'https://tiktok.com/@c/video/3' },         // dead
    { topic: 't8', source_url: 'https://reddit.com/r/h/8' },              // live
  ];
  assert.equal(candidates.length, BRIEFING_REQUEST_COUNT);

  const { log, events } = makeCapturingLog();
  const { surviving, dropped } = await validateBriefingUrls(candidates, {
    validate: makeFakeValidate({ deadPatterns: ['tiktok.com'] }),
    log,
  });

  // 3 dead dropped, 5 live surviving
  assert.equal(dropped, 3);
  assert.equal(surviving.length, 5);
  assert.equal(events.length, 3);

  // Slice-to-target semantics: finalOpps = surviving.slice(0, BRIEFING_TARGET)
  const finalOpps = surviving.slice(0, BRIEFING_TARGET);
  assert.equal(finalOpps.length, BRIEFING_TARGET);

  // Every final opportunity has a non-tiktok, populated platform.
  for (const opp of finalOpps) {
    assert.ok(opp.platform);
    assert.notEqual(opp.platform, 'tiktok', `${opp.topic} should not be tiktok`);
  }

  // Topic ordering preserved: t1, t3, t5, t6, t8 in that order (drops removed).
  assert.deepEqual(finalOpps.map((o) => o.topic), ['t1', 't3', 't5', 't6', 't8']);
});

test('integration: 8 candidates with 6 dead → MIN_ACCEPTABLE boundary', async () => {
  const candidates = Array.from({ length: 8 }, (_, i) => ({
    topic: `t${i}`,
    source_url: i < 6 ? `https://tiktok.com/@x/video/${i}` : `https://reddit.com/r/x/${i}`,
  }));
  const { log } = makeCapturingLog();
  const { surviving, dropped } = await validateBriefingUrls(candidates, {
    validate: makeFakeValidate({ deadPatterns: ['tiktok.com'] }),
    log,
  });
  assert.equal(dropped, 6);
  assert.equal(surviving.length, 2);
  // Caller (research.js main) would compare to MIN_ACCEPTABLE_BRIEFING and throw.
  assert.ok(surviving.length < MIN_ACCEPTABLE_BRIEFING);
});

// --- V2: signal_source trust rule ------------------------------------------

test('V2: apify_reddit opportunities skip validation entirely', async () => {
  const opps = [
    { topic: 'A', source_url: 'https://reddit.com/r/x/1', signal_source: 'apify_reddit' },
  ];
  let called = 0;
  const fakeValidate = async () => { called++; return { valid: false }; };
  const { log } = makeCapturingLog();
  const out = await validateBriefingUrls(opps, { validate: fakeValidate, log });
  assert.equal(called, 0);
  assert.equal(out.surviving.length, 1);
  assert.equal(out.trusted, 1);
  assert.equal(out.checked, 0);
  assert.equal(out.dropped, 0);
  assert.equal(out.surviving[0].platform, 'reddit');
});

test('V2: apify_tiktok opportunities skip validation even when validator would fail', async () => {
  const opps = [
    { topic: 'B', source_url: 'https://tiktok.com/@x/video/1', signal_source: 'apify_tiktok' },
  ];
  const fakeValidate = async () => ({ valid: false, reason: 'content_removed' });
  const { log } = makeCapturingLog();
  const out = await validateBriefingUrls(opps, { validate: fakeValidate, log });
  assert.equal(out.surviving.length, 1);
  assert.equal(out.dropped, 0);
  assert.equal(out.trusted, 1);
  assert.equal(out.surviving[0].platform, 'tiktok');
});

test('V2: apify_trends opportunities skip validation', async () => {
  const opps = [
    { topic: 'C', source_url: 'https://trends.google.com/trends/x', signal_source: 'apify_trends' },
  ];
  const fakeValidate = async () => ({ valid: false, reason: '404' });
  const { log } = makeCapturingLog();
  const out = await validateBriefingUrls(opps, { validate: fakeValidate, log });
  assert.equal(out.surviving.length, 1);
  assert.equal(out.trusted, 1);
});

test('V2: llm_inferred opportunities still validate and can be dropped', async () => {
  const opps = [
    { topic: 'D', source_url: 'https://example.com/dead', signal_source: 'llm_inferred' },
  ];
  const fakeValidate = async () => ({ valid: false, reason: '404' });
  const { log } = makeCapturingLog();
  const out = await validateBriefingUrls(opps, { validate: fakeValidate, log });
  assert.equal(out.surviving.length, 0);
  assert.equal(out.dropped, 1);
  assert.equal(out.trusted, 0);
});

test('V2: missing signal_source still runs validation (no trust)', async () => {
  const opps = [
    { topic: 'E', source_url: 'https://example.com/check' },
  ];
  const fakeValidate = async () => ({ valid: true, status: 200 });
  const { log } = makeCapturingLog();
  const out = await validateBriefingUrls(opps, { validate: fakeValidate, log });
  assert.equal(out.checked, 1);
  assert.equal(out.trusted, 0);
  assert.equal(out.surviving.length, 1);
});

test('V2: skipAll bypasses validation for all opps and logs url_validation_skipped', async () => {
  const opps = [
    { topic: 'A', source_url: 'https://reddit.com/r/x/1', signal_source: 'apify_reddit' },
    { topic: 'B', source_url: 'https://random.site/', signal_source: 'llm_inferred' },
  ];
  let called = 0;
  const fakeValidate = async () => { called++; return { valid: false }; };
  const { log, events } = makeCapturingLog();
  const out = await validateBriefingUrls(opps, { validate: fakeValidate, log, skipAll: true });
  assert.equal(called, 0);
  assert.equal(out.skipped, 2);
  assert.equal(out.surviving.length, 2);
  assert.equal(out.checked, 0);
  assert.equal(out.dropped, 0);
  // Platform slug still stamped
  assert.equal(out.surviving[0].platform, 'reddit');
  assert.equal(out.surviving[1].platform, 'other');
  // Exactly one bypass event
  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'url_validation_skipped');
  assert.equal(events[0].category, 'alert');
  assert.equal(events[0].metadata.count, 2);
});

test('V2: mixed batch — trusted counted separately from checked and dropped', async () => {
  const opps = [
    { topic: 'a', source_url: 'https://reddit.com/r/x/1', signal_source: 'apify_reddit' },
    { topic: 'b', source_url: 'https://tiktok.com/@y/video/2', signal_source: 'apify_tiktok' },
    { topic: 'c', source_url: 'https://example.com/live',     signal_source: 'llm_inferred' },
    { topic: 'd', source_url: 'https://example.com/dead',     signal_source: 'llm_inferred' },
  ];
  const fakeValidate = async (url) =>
    url.endsWith('/dead') ? { valid: false, reason: '404' } : { valid: true, status: 200 };
  const { log } = makeCapturingLog();
  const out = await validateBriefingUrls(opps, { validate: fakeValidate, log });
  assert.equal(out.trusted, 2);
  assert.equal(out.checked, 2);
  assert.equal(out.dropped, 1);
  assert.equal(out.surviving.length, 3);
});

test('V2: dropped llm_inferred opp logs signal_source in metadata', async () => {
  const opps = [
    { topic: 'x', source_url: 'https://example.com/dead', signal_source: 'llm_inferred', signal_id: 'sig-x' },
  ];
  const fakeValidate = async () => ({ valid: false, reason: '404', status: 404 });
  const { log, events } = makeCapturingLog();
  await validateBriefingUrls(opps, { validate: fakeValidate, log });
  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'url_validation_dropped_research');
  assert.equal(events[0].metadata.signal_source, 'llm_inferred');
});
