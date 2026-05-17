/**
 * Tests for caption-length retry discipline.
 *
 * v2.0.0 (CHANNEL_MODEL_V1): operates on render_profile_slug + caption.
 * Caps come from CAPTION_MAX_BY_SLUG.
 *
 * Per PR #13 plan (carried into v2.0.0):
 * - Overshoot ≤5% of cap  → one-shot retry with explicit feedback.
 * - Overshoot >5% of cap  → no retry, straight to draft_needs_review.
 * - Retry success         → replace caption, log caption_length_overshoot
 *                           with retry_success: true.
 * - Retry exhaustion      → keep the longer caption, set
 *                           status_hint='draft_needs_review', log with
 *                           retry_success: false.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub';

const { enforceCaptionLengthWithRetry } = await import('../caption-retry.js');
const { CAPTION_MAX_BY_SLUG } = await import('../format-selector.js');

// Tests target the moving-images slug throughout (cap 300, target 240).
// The slug choice is arbitrary — what matters is the retry discipline.
const SLUG = 'moving-images';
const CAP = CAPTION_MAX_BY_SLUG[SLUG];           // 300
const TARGET = Math.round(CAP * 0.8);            // 240

function makeCapturingLog() {
  const events = [];
  return { log: async (e) => { events.push(e); }, events };
}

function makePost({ render_profile_slug = SLUG, caption = 'x'.repeat(80), hook = 'Probe hook' } = {}) {
  return { render_profile_slug, caption, hook, content_pillar: 'ai_magic', age_range: 'universal' };
}

// --- No-op path --------------------------------------------------------------

test('posts at or under cap pass through untouched, no client call, no log', async () => {
  const posts = [makePost({ caption: 'x'.repeat(CAP) })];
  let called = 0;
  const client = { messages: { create: async () => { called++; throw new Error('should not call'); } } };
  const { log, events } = makeCapturingLog();

  const out = await enforceCaptionLengthWithRetry(posts, { client, log });

  assert.equal(called, 0);
  assert.equal(events.length, 0);
  assert.equal(out[0].caption.length, CAP);
  assert.equal(out[0].status_hint, undefined);
});

// --- Retry success path ------------------------------------------------------

test('overshoot ≤5% → retry fires once, succeeds, replaces caption, logs retry_success=true', async () => {
  const overLen = CAP + Math.floor(CAP * 0.05);    // exactly 5% over
  const recoveredLen = CAP - 20;                   // under cap
  const posts = [makePost({ caption: 'x'.repeat(overLen) })];

  let calls = 0;
  const client = {
    messages: {
      create: async () => {
        calls++;
        return {
          content: [{ text: JSON.stringify({ caption: 'y'.repeat(recoveredLen) }) }],
          usage: { input_tokens: 10, output_tokens: 10 },
        };
      },
    },
  };
  const { log, events } = makeCapturingLog();

  const out = await enforceCaptionLengthWithRetry(posts, { client, log });

  assert.equal(calls, 1, 'retry fires exactly once');
  assert.equal(out[0].caption.length, recoveredLen);
  assert.equal(out[0].status_hint, undefined, 'successful retry must NOT flag');

  const logged = events.find((e) => e.action === 'caption_length_overshoot');
  assert.ok(logged, 'must log caption_length_overshoot');
  assert.equal(logged.category, 'debug');
  assert.equal(logged.metadata.render_profile_slug, SLUG);
  assert.equal(logged.metadata.target, TARGET);
  assert.equal(logged.metadata.cap, CAP);
  assert.equal(logged.metadata.actual, overLen);
  assert.equal(logged.metadata.over_by_chars, overLen - CAP);
  assert.equal(logged.metadata.retry_fired, true);
  assert.equal(logged.metadata.retry_success, true);
  assert.equal(logged.metadata.final_length, recoveredLen);
});

// --- Retry exhaustion path ---------------------------------------------------

test('overshoot ≤5% but retry returns still-over caption → draft_needs_review + retry_success=false', async () => {
  const overLen = CAP + 3;                     // 1% over → recoverable
  const stillOver = CAP + 10;                  // retry returns still-over
  const posts = [makePost({ caption: 'x'.repeat(overLen) })];

  const client = {
    messages: {
      create: async () => ({
        content: [{ text: JSON.stringify({ caption: 'z'.repeat(stillOver) }) }],
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    },
  };
  const { log, events } = makeCapturingLog();

  const out = await enforceCaptionLengthWithRetry(posts, { client, log });

  assert.equal(out[0].status_hint, 'draft_needs_review');
  const logged = events.find((e) => e.action === 'caption_length_overshoot');
  assert.equal(logged.metadata.retry_fired, true);
  assert.equal(logged.metadata.retry_success, false);
  assert.equal(logged.metadata.final_length, stillOver);
});

// --- Structural miss (>5% over) — skip retry entirely ------------------------

test('overshoot >5% → NO retry, flag immediately as draft_needs_review, retry_fired=false', async () => {
  const overLen = CAP + Math.ceil(CAP * 0.2);    // 20% over
  const posts = [makePost({ caption: 'x'.repeat(overLen) })];
  let called = 0;
  const client = { messages: { create: async () => { called++; throw new Error('should not call'); } } };
  const { log, events } = makeCapturingLog();

  const out = await enforceCaptionLengthWithRetry(posts, { client, log });

  assert.equal(called, 0, 'retry must NOT fire when overshoot >5%');
  assert.equal(out[0].caption.length, overLen, 'caption preserved verbatim for draft review');
  assert.equal(out[0].status_hint, 'draft_needs_review');

  const logged = events.find((e) => e.action === 'caption_length_overshoot');
  assert.equal(logged.metadata.retry_fired, false);
  assert.equal(logged.metadata.retry_success, false);
  assert.equal(logged.metadata.over_by_chars, overLen - CAP);
});

// --- Retry prompt shape ------------------------------------------------------

test('retry prompt includes previous length, cap, and ruthless-cut directive', async () => {
  const overLen = CAP + 2;
  const posts = [makePost({ caption: 'x'.repeat(overLen) })];
  const captured = [];
  const client = {
    messages: {
      create: async (req) => {
        captured.push(req);
        return {
          content: [{ text: JSON.stringify({ caption: 'ok'.repeat(40) }) }],
          usage: { input_tokens: 5, output_tokens: 5 },
        };
      },
    },
  };
  await enforceCaptionLengthWithRetry(posts, { client, log: async () => {} });

  assert.equal(captured.length, 1);
  const content = captured[0].messages[0].content;
  // Must tell the LLM what it did wrong last time + new marching orders.
  assert.match(content, new RegExp(String(overLen)));     // previous length
  assert.match(content, new RegExp(`\\b${CAP}\\b`));      // hard cap
  assert.match(content, new RegExp(`\\b${TARGET}\\b`));   // target
  assert.match(content, /ruthless|cut|tight/i);           // tone: cut aggressively
});

// --- Non-JSON retry response -------------------------------------------------

test('retry returns malformed response → flag draft_needs_review, caption unchanged', async () => {
  const overLen = CAP + 4;
  const posts = [makePost({ caption: 'x'.repeat(overLen) })];
  const client = {
    messages: {
      create: async () => ({
        content: [{ text: 'this is not JSON' }],
        usage: { input_tokens: 5, output_tokens: 5 },
      }),
    },
  };
  const { log, events } = makeCapturingLog();

  const out = await enforceCaptionLengthWithRetry(posts, { client, log });

  assert.equal(out[0].status_hint, 'draft_needs_review');
  assert.equal(out[0].caption.length, overLen, 'unparseable retry leaves original caption in place');
  const logged = events.find((e) => e.action === 'caption_length_overshoot');
  assert.equal(logged.metadata.retry_success, false);
});

// --- Multiple posts: mix of paths in one batch ------------------------------

test('batch: one clean, one retry-success, one >5% flag — all handled correctly', async () => {
  const clean     = makePost({ caption: 'x'.repeat(CAP - 50) });
  const overSmall = makePost({ caption: 'x'.repeat(CAP + 3) });               // 1% over → retry
  const overBig   = makePost({ caption: 'x'.repeat(CAP + Math.ceil(CAP * 0.3)) }); // 30% over → flag
  const posts = [clean, overSmall, overBig];

  const client = {
    messages: {
      create: async () => ({
        content: [{ text: JSON.stringify({ caption: 'ok'.repeat(30) }) }],
        usage: { input_tokens: 5, output_tokens: 5 },
      }),
    },
  };
  const { log, events } = makeCapturingLog();

  const out = await enforceCaptionLengthWithRetry(posts, { client, log });

  assert.equal(out[0].status_hint, undefined);                      // clean
  assert.equal(out[1].status_hint, undefined);                      // retry success
  assert.equal(out[2].status_hint, 'draft_needs_review');           // structural miss
  const logEvents = events.filter((e) => e.action === 'caption_length_overshoot');
  assert.equal(logEvents.length, 2);                                // clean one does not log
});
