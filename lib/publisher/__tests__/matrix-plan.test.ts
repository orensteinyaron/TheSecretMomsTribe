import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMedia, TIKTOK_PHOTO_UNSUPPORTED } from '../media-matrix.js';
import { planChannel } from '../plan.js';
import type { DuePiece } from '../types.js';

const NOW = new Date('2026-06-09T12:00:00Z');

// ── media matrix ─────────────────────────────────────────────────────────────

test('matrix: avatar-v1 and moving-images → video on both channels', () => {
  for (const slug of ['avatar-v1', 'moving-images'] as const) {
    assert.equal(resolveMedia(slug, 'instagram').action, 'video');
    assert.equal(resolveMedia(slug, 'tiktok').action, 'video');
  }
});

test('matrix: carousel → IG carousel, TikTok skip tiktok_web_photo_unsupported', () => {
  assert.deepEqual(resolveMedia('carousel', 'instagram'), { channel: 'instagram', action: 'carousel' });
  assert.deepEqual(resolveMedia('carousel', 'tiktok'), {
    channel: 'tiktok', action: 'skip', reason: TIKTOK_PHOTO_UNSUPPORTED,
  });
});

test('matrix: static-image → IG image, TikTok skip', () => {
  assert.equal(resolveMedia('static-image', 'instagram').action, 'image');
  assert.equal(resolveMedia('static-image', 'tiktok').reason, TIKTOK_PHOTO_UNSUPPORTED);
});

test('matrix: tiktokSlideshow opt-in uploads carousel/static-image as video', () => {
  assert.equal(resolveMedia('carousel', 'tiktok', { tiktokSlideshow: true }).action, 'video');
  assert.equal(resolveMedia('static-image', 'tiktok', { tiktokSlideshow: true }).action, 'video');
});

// ── plan (preflight × matrix) ────────────────────────────────────────────────

function piece(over: Partial<DuePiece> = {}): DuePiece {
  return {
    contentId: 'cq_1', status: 'approved', renderStatus: 'complete',
    renderProfileSlug: 'carousel', pillar: 'parenting',
    finalAssetUrl: 'https://x/a.png', caption: 'base', metadata: {},
    channels: [
      { channel: 'instagram', status: 'pending', caption: 'ig native', scheduledFor: null, externalPostId: null },
      { channel: 'tiktok', status: 'pending', caption: 'tt native', scheduledFor: null, externalPostId: null },
    ],
    ...over,
  };
}

test('plan: carousel → IG stages (carousel), TikTok skips', () => {
  const ig = planChannel(piece(), 'instagram', NOW);
  assert.equal(ig.action, 'stage');
  if (ig.action === 'stage') {
    assert.equal(ig.media.action, 'carousel');
    assert.equal(ig.caption, 'ig native');
  }
  const tt = planChannel(piece(), 'tiktok', NOW);
  assert.deepEqual(tt, { channel: 'tiktok', action: 'skip', reason: TIKTOK_PHOTO_UNSUPPORTED });
});

test('plan: video piece stages on both channels', () => {
  const p = piece({ renderProfileSlug: 'avatar-v1', finalAssetUrl: 'https://x/a.mp4' });
  assert.equal(planChannel(p, 'instagram', NOW).action, 'stage');
  assert.equal(planChannel(p, 'tiktok', NOW).action, 'stage');
});

test('plan: preflight wins — unapproved → noop, never staged', () => {
  assert.deepEqual(planChannel(piece({ status: 'draft' }), 'instagram', NOW), {
    channel: 'instagram', action: 'noop', reason: 'not_approved',
  });
});

test('plan: financial-no-disclaimer → fail before any media decision', () => {
  const p = piece({ renderProfileSlug: 'avatar-v1', pillar: 'financial',
    channels: [{ channel: 'instagram', status: 'pending', caption: 'no disclaimer here', scheduledFor: null, externalPostId: null }] });
  assert.deepEqual(planChannel(p, 'instagram', NOW), { channel: 'instagram', action: 'fail', reason: 'financial_disclaimer_missing' });
});

test('plan: caption falls back to the base caption when the channel caption is null', () => {
  const p = piece({ renderProfileSlug: 'avatar-v1', finalAssetUrl: 'https://x/a.mp4',
    channels: [{ channel: 'instagram', status: 'pending', caption: null, scheduledFor: null, externalPostId: null }] });
  const ig = planChannel(p, 'instagram', NOW);
  assert.equal(ig.action === 'stage' && ig.caption, 'base');
});
