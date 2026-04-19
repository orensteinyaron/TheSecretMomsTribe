/**
 * Tests for content-generate: the LLM call + JSON parse/repair logic
 * extracted from agents/content.js so it can run without the module's
 * env-var / auto-main side effects.
 *
 * The regression test specifically exercises the cost-log description
 * that previously crashed with `ReferenceError: numOpps is not defined`
 * — that variable was dropped when buildUserPrompt was extracted but a
 * stale reference survived in a template literal.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'stub';

const { generateBatch } = await import('../content-generate.js');

function fakeClient({ text, usage = { input_tokens: 10, output_tokens: 20 } } = {}) {
  return {
    messages: {
      create: async () => ({ content: [{ text }], usage }),
    },
  };
}

function makeBriefing(oppCount = 3) {
  return {
    id: `briefing-${oppCount}`,
    opportunities: Array.from({ length: oppCount }, (_, i) => ({
      topic: `topic ${i}`,
      signal_id: `sig-${i}`,
      source_url: '',
    })),
  };
}

const MINIMAL_POSTS_JSON = JSON.stringify([
  {
    hook: 'a hook line long enough',
    caption: 'a caption that is clearly long enough to pass gates',
    hashtags: ['#a', '#b', '#c'],
  },
]);

// --- Regression: numOpps ReferenceError --------------------------------------

test('generateBatch: completes without ReferenceError when logging cost (numOpps regression)', async () => {
  const briefing = makeBriefing(5);
  const costEvents = [];
  const log = async (_db, payload) => costEvents.push(payload);

  const { posts } = await generateBatch(
    { briefing, systemPrompt: 'sys', userPrompt: 'user' },
    { client: fakeClient({ text: MINIMAL_POSTS_JSON }), log, db: null },
  );

  assert.equal(posts.length, 1);
  const generationLog = costEvents.find((e) => /opportunities/.test(e.description || ''));
  assert.ok(generationLog, 'expected a cost log with opportunity count in description');
  // The bug was: description template referenced `numOpps` which was never
  // defined, throwing ReferenceError. This assertion pins the correct count.
  assert.match(generationLog.description, /5 opportunities/);
});

test('generateBatch: includes briefing.id on the cost-log call', async () => {
  const briefing = makeBriefing(3);
  briefing.id = 'briefing-xyz';
  const costEvents = [];
  const log = async (_db, payload) => costEvents.push(payload);

  await generateBatch(
    { briefing, systemPrompt: 'sys', userPrompt: 'user' },
    { client: fakeClient({ text: MINIMAL_POSTS_JSON }), log, db: null },
  );

  const generationLog = costEvents.find((e) => /opportunities/.test(e.description || ''));
  assert.equal(generationLog.briefing_id, 'briefing-xyz');
});

// --- JSON parse path (direct) -----------------------------------------------

test('generateBatch: parses direct JSON output into posts', async () => {
  const briefing = makeBriefing(1);
  const { posts, usage } = await generateBatch(
    { briefing, systemPrompt: 's', userPrompt: 'u' },
    { client: fakeClient({ text: MINIMAL_POSTS_JSON }), log: async () => {}, db: null },
  );
  assert.equal(posts.length, 1);
  assert.equal(posts[0].hook, 'a hook line long enough');
  assert.ok(usage.input_tokens > 0);
});

test('generateBatch: strips ```json code fences before parsing', async () => {
  const briefing = makeBriefing(1);
  const fenced = '```json\n' + MINIMAL_POSTS_JSON + '\n```';
  const { posts } = await generateBatch(
    { briefing, systemPrompt: 's', userPrompt: 'u' },
    { client: fakeClient({ text: fenced }), log: async () => {}, db: null },
  );
  assert.equal(posts.length, 1);
});

// --- JSON repair path (regex extraction) ------------------------------------

test('generateBatch: recovers via regex extraction when LLM wraps JSON in prose', async () => {
  const briefing = makeBriefing(1);
  const noisy = `Here's your batch:\n\n${MINIMAL_POSTS_JSON}\n\nLet me know if you want changes.`;
  const { posts } = await generateBatch(
    { briefing, systemPrompt: 's', userPrompt: 'u' },
    { client: fakeClient({ text: noisy }), log: async () => {}, db: null },
  );
  assert.equal(posts.length, 1);
});
