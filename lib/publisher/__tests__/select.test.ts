import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupDueRows } from '../select.js';
import type { DueRowRaw } from '../types.js';

function row(over: Partial<DueRowRaw>): DueRowRaw {
  return {
    content_id: 'cq_1', cq_status: 'approved', render_status: 'complete',
    render_profile_slug: 'carousel', content_pillar: 'parenting',
    final_asset_url: 'https://x/a.png', thumbnail_asset_url: null, cover_asset_url: null,
    cq_caption: 'base', metadata: { source: 'create-from-url' },
    sp_channel: 'instagram', sp_status: 'pending', sp_caption: 'ig', sp_scheduled_for: null, sp_external_post_id: null,
    ...over,
  };
}

test('groupDueRows: folds channels under one piece', () => {
  const pieces = groupDueRows([
    row({ sp_channel: 'instagram', sp_caption: 'ig' }),
    row({ sp_channel: 'tiktok', sp_caption: 'tt', sp_status: 'scheduled' }),
  ]);
  assert.equal(pieces.length, 1);
  assert.equal(pieces[0].contentId, 'cq_1');
  assert.equal(pieces[0].renderProfileSlug, 'carousel');
  assert.equal(pieces[0].pillar, 'parenting');
  assert.deepEqual(pieces[0].channels.map((c) => c.channel).sort(), ['instagram', 'tiktok']);
});

test('groupDueRows: separates distinct pieces and preserves per-channel fields', () => {
  const pieces = groupDueRows([
    row({ content_id: 'cq_1', sp_channel: 'instagram' }),
    row({ content_id: 'cq_2', sp_channel: 'tiktok', sp_external_post_id: 'TT_9', sp_status: 'posted' }),
  ]);
  assert.equal(pieces.length, 2);
  const p2 = pieces.find((p) => p.contentId === 'cq_2');
  assert.equal(p2?.channels[0].externalPostId, 'TT_9');
  assert.equal(p2?.channels[0].status, 'posted');
});

test('groupDueRows: empty input → empty', () => {
  assert.deepEqual(groupDueRows([]), []);
});

test('groupDueRows: carries thumbnail_asset_url + cover_asset_url onto the piece', () => {
  const pieces = groupDueRows([
    row({ thumbnail_asset_url: 'https://x/thumb.png', cover_asset_url: 'https://x/cover.png' }),
  ]);
  assert.equal(pieces[0].thumbnailAssetUrl, 'https://x/thumb.png');
  assert.equal(pieces[0].coverAssetUrl, 'https://x/cover.png');
});
