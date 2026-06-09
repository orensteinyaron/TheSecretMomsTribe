import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createLifecycle } from '../../lifecycle/lifecycle.js';
import { ShadowLifecycleStore } from '../../lifecycle/shadow-store.js';
import { closeChannel, failChannel, skipChannel } from '../close.js';
import { ApiPublishProvider, BrowserAssistedProvider, COMPOSER_URLS } from '../provider.js';

async function seeded() {
  const store = new ShadowLifecycleStore();
  const lifecycle = createLifecycle(store);
  const { contentId } = await lifecycle.enqueuePiece({
    renderProfileSlug: 'avatar-v1',
    pillar: 'parenting',
    hook: 'h',
    baseCaption: 'base',
    finalAssetUrl: 'https://x/a.mp4',
    approved: true,
    channels: [
      { channel: 'instagram', caption: 'ig' },
      { channel: 'tiktok', caption: 'tt' },
    ],
  });
  return { store, lifecycle, contentId };
}

test('closeChannel: human-confirmed permalink + id → posted + postCheck', async () => {
  const { lifecycle, contentId } = await seeded();
  const res = await closeChannel(lifecycle, {
    contentId, channel: 'instagram', postUrl: 'https://instagram.com/p/REAL', externalPostId: 'IG_REAL',
  });
  assert.equal(res.outcome, 'posted');
  assert.equal(res.mark?.row.status, 'posted');
  assert.equal(res.mark?.row.external_post_id, 'IG_REAL');
  const ig = res.postCheck?.channels.find((c) => c.channel === 'instagram');
  assert.equal(ig?.status, 'posted');
});

test('closeChannel: idempotent — second close is a no-op, first write wins', async () => {
  const { lifecycle, contentId } = await seeded();
  await closeChannel(lifecycle, { contentId, channel: 'instagram', postUrl: 'https://ig/1', externalPostId: 'IG_1' });
  const second = await closeChannel(lifecycle, { contentId, channel: 'instagram', postUrl: 'https://ig/2', externalPostId: 'IG_2' });
  assert.equal(second.outcome, 'posted');
  assert.equal(second.mark?.idempotentNoop, true);
  assert.equal(second.mark?.row.external_post_id, 'IG_1');
});

test('closeChannel: missing permalink/id → left_scheduled, NEVER marked posted', async () => {
  const { store, lifecycle, contentId } = await seeded();
  const res = await closeChannel(lifecycle, { contentId, channel: 'instagram', postUrl: '', externalPostId: 'IG_1' });
  assert.equal(res.outcome, 'left_scheduled');
  assert.equal(res.mark, undefined);
  // The row was not touched — still pending for manual reconcile.
  assert.equal(store.posts.get(`${contentId}::instagram`)?.status, 'pending');
});

test('skipChannel / failChannel: write a reason, never silent', async () => {
  const { lifecycle, contentId } = await seeded();
  const skip = await skipChannel(lifecycle, contentId, 'tiktok', 'tiktok_web_photo_unsupported');
  assert.equal(skip.outcome, 'skipped');
  assert.equal(skip.mark?.row.failure_reason, 'tiktok_web_photo_unsupported');
  const fail = await failChannel(lifecycle, contentId, 'instagram', 'composer_upload_error');
  assert.equal(fail.outcome, 'failed');
  assert.equal(fail.mark?.row.failure_reason, 'composer_upload_error');
});

// ── provider seam ────────────────────────────────────────────────────────────

test('BrowserAssistedProvider: builds a staging plan that stops at publish; has no publish method', () => {
  const provider = new BrowserAssistedProvider();
  const plan = provider.buildStagingPlan({
    contentId: 'cq_1', channel: 'instagram', assetPath: '/tmp/a.mp4', caption: 'cap',
    media: { channel: 'instagram', action: 'video' },
  });
  assert.equal(plan.stopAtPublish, true);
  assert.equal(plan.composerUrl, COMPOSER_URLS.instagram);
  assert.equal(plan.caption, 'cap');
  // The seam exposes nothing that publishes.
  assert.equal((provider as unknown as Record<string, unknown>).publish, undefined);
});

test('ApiPublishProvider: Phase 2, explicitly not implemented', () => {
  assert.throws(() => new ApiPublishProvider().buildStagingPlan(), /not implemented/);
});
