import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createLifecycle } from '../../lifecycle/lifecycle.js';
import { ShadowLifecycleStore } from '../../lifecycle/shadow-store.js';
import { enqueueRemix } from '../enqueue.js';
import type { RemixEnqueuePlan } from '../types.js';

function plan(over: Partial<RemixEnqueuePlan> = {}): RemixEnqueuePlan {
  return {
    renderProfileSlug: 'carousel',
    pillar: 'parenting_insights',
    hook: 'three things I wish I knew',
    baseCaption: 'A warm mom-to-mom story in our own words.',
    finalAssetUrl: 'https://cdn.example.com/remix.png',
    channelCaptions: { instagram: 'IG native caption', tiktok: 'TT native caption' },
    provenance: { sourceUrl: 'https://www.instagram.com/p/SRC/', creatorHandle: '@somemom' },
    approved: true,
    ...over,
  };
}

function setup() {
  const store = new ShadowLifecycleStore();
  return { store, lifecycle: createLifecycle(store) };
}

test('enqueueRemix(carousel): ig pending, tiktok skipped, provenance stored, approved', async () => {
  const { store, lifecycle } = setup();
  const res = await enqueueRemix(plan(), lifecycle);

  assert.deepEqual(res.skipped, ['tiktok']);
  const byChannel = Object.fromEntries(res.scheduledPosts.map((r) => [r.channel, r.status]));
  assert.equal(byChannel.instagram, 'pending');
  assert.equal(byChannel.tiktok, 'skipped');
  const tt = res.scheduledPosts.find((r) => r.channel === 'tiktok');
  assert.equal(tt?.failure_reason, 'tiktok_web_photo_unsupported');

  const content = store.content.get(res.contentId);
  assert.equal(content?.status, 'approved'); // approval #2 is the human gate
  assert.equal(content?.pillar, 'parenting'); // canonical → DB pillar boundary
  assert.equal((content?.metadata as Record<string, unknown>).source, 'create-from-url');
  assert.equal((content?.metadata as Record<string, unknown>).source_url, 'https://www.instagram.com/p/SRC/');
  assert.equal((content?.metadata as Record<string, unknown>).creator_handle, '@somemom');
});

test('enqueueRemix(avatar-v1 video): both channels pending, nothing skipped', async () => {
  const { lifecycle } = setup();
  const res = await enqueueRemix(plan({ renderProfileSlug: 'avatar-v1' }), lifecycle);
  assert.deepEqual(res.skipped, []);
  assert.ok(res.scheduledPosts.every((r) => r.status === 'pending'));
});

test('enqueueRemix: no-credit guard rejects a creator handle that leaks into a caption', async () => {
  const { lifecycle } = setup();
  await assert.rejects(
    () => enqueueRemix(plan({ channelCaptions: { instagram: 'Credit to @somemom for this', tiktok: 'x' } }), lifecycle),
    /no-credit violation/,
  );
});

test('enqueueRemix: requires provenance.sourceUrl', async () => {
  const { lifecycle } = setup();
  await assert.rejects(
    () => enqueueRemix(plan({ provenance: { sourceUrl: '', creatorHandle: null } }), lifecycle),
    /provenance.sourceUrl is required/,
  );
});

test('enqueueRemix(financial): rejects without a disclaimer, accepts with one', async () => {
  const { lifecycle } = setup();
  const financialNoDisc = plan({
    pillar: 'financial', renderProfileSlug: 'avatar-v1',
    baseCaption: 'How I think about our family budget.',
    channelCaptions: { instagram: 'budget story', tiktok: 'budget story' },
    provenance: { sourceUrl: 'https://x.com/p/1', creatorHandle: null },
  });
  await assert.rejects(() => enqueueRemix(financialNoDisc, lifecycle), /financial pillar requires a disclaimer/);

  const financialWithDisc = plan({
    pillar: 'financial', renderProfileSlug: 'avatar-v1',
    baseCaption: 'How I think about our family budget. This is not financial advice.',
    channelCaptions: { instagram: 'budget. not financial advice.', tiktok: 'budget. not financial advice.' },
    provenance: { sourceUrl: 'https://x.com/p/1', creatorHandle: null },
  });
  const res = await enqueueRemix(financialWithDisc, lifecycle);
  assert.equal(res.skipped.length, 0);
});

test('enqueueRemix(ai_magic): rejects without verbatim artifacts, accepts with the four-field gate', async () => {
  const { store, lifecycle } = setup();
  const base = plan({
    pillar: 'ai_magic', renderProfileSlug: 'avatar-v1',
    baseCaption: 'I asked an AI and the result floored me.',
    channelCaptions: { instagram: 'ai story', tiktok: 'ai story' },
    provenance: { sourceUrl: 'https://reddit.com/r/x/p', creatorHandle: null },
  });
  await assert.rejects(() => enqueueRemix(base, lifecycle), /ai_magic_gate_failed/);

  const withArtifacts = {
    ...base,
    aiMagic: {
      original_prompt: 'Write a bedtime story about a brave little fox',
      original_output: 'Once upon a time there was a brave little fox who was not afraid of the dark...',
      ai_tool_name: 'ChatGPT',
      source_url: 'https://reddit.com/r/x/p',
    },
  };
  const res = await enqueueRemix(withArtifacts, lifecycle);
  const content = store.content.get(res.contentId);
  assert.ok((content?.metadata as Record<string, unknown>).ai_magic);
});

test('enqueueRemix: slideshow strategy on a carousel slug is a hard error', async () => {
  const { lifecycle } = setup();
  await assert.rejects(
    () => enqueueRemix(plan({ tiktokCarouselStrategy: 'slideshow' }), lifecycle),
    /requires a moving-images render/,
  );
});

test('enqueueRemix: defaults to both channels and falls back to the base caption', async () => {
  const { store, lifecycle } = setup();
  const res = await enqueueRemix(plan({
    renderProfileSlug: 'avatar-v1',
    channels: undefined,
    channelCaptions: {}, // no per-channel captions → fall back to base
  }), lifecycle);
  assert.deepEqual(res.scheduledPosts.map((r) => r.channel).sort(), ['instagram', 'tiktok']);
  for (const r of res.scheduledPosts) {
    assert.equal(store.posts.get(`${res.contentId}::${r.channel}`)?.caption, 'A warm mom-to-mom story in our own words.');
  }
});
