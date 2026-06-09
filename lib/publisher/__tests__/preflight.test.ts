import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preflightChannel } from '../preflight.js';
import type { DuePiece } from '../types.js';

const NOW = new Date('2026-06-09T12:00:00Z');

function piece(over: Partial<DuePiece> = {}): DuePiece {
  return {
    contentId: 'cq_1', status: 'approved', renderStatus: 'complete',
    renderProfileSlug: 'avatar-v1', pillar: 'parenting',
    finalAssetUrl: 'https://x/a.mp4', caption: 'base', metadata: {},
    channels: [
      { channel: 'instagram', status: 'pending', caption: 'ig', scheduledFor: null, externalPostId: null },
    ],
    ...over,
  };
}

test('preflight: approved + rendered + pending + due → proceed', () => {
  assert.deepEqual(preflightChannel(piece(), 'instagram', NOW), { action: 'proceed' });
});

test('preflight: NEVER acts on an unapproved row → noop', () => {
  assert.deepEqual(preflightChannel(piece({ status: 'draft' }), 'instagram', NOW), {
    action: 'noop', reason: 'not_approved',
  });
  assert.deepEqual(preflightChannel(piece({ status: 'pending_approval' }), 'instagram', NOW), {
    action: 'noop', reason: 'not_approved',
  });
});

test('preflight: not rendered → noop', () => {
  assert.equal(preflightChannel(piece({ renderStatus: 'rendering' }), 'instagram', NOW).reason, 'not_rendered');
});

test('preflight: idempotent — external id or posted status → noop already_posted', () => {
  const withId = piece({ channels: [{ channel: 'instagram', status: 'pending', caption: 'ig', scheduledFor: null, externalPostId: 'IG_1' }] });
  assert.deepEqual(preflightChannel(withId, 'instagram', NOW), { action: 'noop', reason: 'already_posted' });
  const posted = piece({ channels: [{ channel: 'instagram', status: 'posted', caption: 'ig', scheduledFor: null, externalPostId: 'IG_1' }] });
  assert.equal(preflightChannel(posted, 'instagram', NOW).reason, 'already_posted');
});

test('preflight: already skipped/failed → noop', () => {
  const skipped = piece({ channels: [{ channel: 'instagram', status: 'skipped', caption: 'ig', scheduledFor: null, externalPostId: null }] });
  assert.equal(preflightChannel(skipped, 'instagram', NOW).reason, 'already_skipped');
});

test('preflight: future scheduled_for → noop not_due', () => {
  const future = piece({ channels: [{ channel: 'instagram', status: 'scheduled', caption: 'ig', scheduledFor: '2026-06-09T18:00:00Z', externalPostId: null }] });
  assert.deepEqual(preflightChannel(future, 'instagram', NOW), { action: 'noop', reason: 'not_due' });
});

test('preflight: financial without disclaimer → fail; with disclaimer → proceed', () => {
  const noDisc = piece({ pillar: 'financial', channels: [{ channel: 'instagram', status: 'pending', caption: 'budget tips', scheduledFor: null, externalPostId: null }] });
  assert.deepEqual(preflightChannel(noDisc, 'instagram', NOW), { action: 'fail', reason: 'financial_disclaimer_missing' });
  const withDisc = piece({ pillar: 'financial', channels: [{ channel: 'instagram', status: 'pending', caption: 'budget tips. not financial advice.', scheduledFor: null, externalPostId: null }] });
  assert.deepEqual(preflightChannel(withDisc, 'instagram', NOW), { action: 'proceed' });
});

test('preflight: expired trending → skip; live trending → proceed', () => {
  const expired = piece({ pillar: 'trending', metadata: { expires_at: '2026-06-08T12:00:00Z' } });
  assert.deepEqual(preflightChannel(expired, 'instagram', NOW), { action: 'skip', reason: 'trending_expired' });
  const live = piece({ pillar: 'trending', metadata: { expires_at: '2026-06-10T12:00:00Z' } });
  assert.deepEqual(preflightChannel(live, 'instagram', NOW), { action: 'proceed' });
});

test('preflight: missing asset → fail', () => {
  assert.deepEqual(preflightChannel(piece({ finalAssetUrl: null }), 'instagram', NOW), {
    action: 'fail', reason: 'missing_asset',
  });
});

test('preflight: a channel not on the piece → noop', () => {
  assert.equal(preflightChannel(piece(), 'tiktok', NOW).reason, 'no_channel_row');
});
