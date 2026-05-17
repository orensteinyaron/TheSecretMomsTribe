/**
 * Tests for channels helper. Pure-function tests (no DB) plus a fake
 * supabase client for the mutation helper.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub';

const {
  CHANNEL,
  ALL_CHANNELS,
  DEFAULT_CHANNELS,
  SCHEDULED_POST_STATUS,
  CHANNEL_STYLE,
  isValidChannel,
  isValidScheduledPostStatus,
  resolveTargetChannels,
  buildScheduledPostsRows,
  generateChannelCaptions,
  getScheduledPostsForContent,
  updateScheduledPostStatus,
} = await import('../channels.js');

test('CHANNEL exposes tiktok and instagram', () => {
  assert.equal(CHANNEL.TIKTOK, 'tiktok');
  assert.equal(CHANNEL.INSTAGRAM, 'instagram');
});

test('DEFAULT_CHANNELS is [tiktok, instagram] per CHANNEL_MODEL_V1', () => {
  assert.deepEqual([...DEFAULT_CHANNELS], ['tiktok', 'instagram']);
});

test('ALL_CHANNELS contains exactly the two channels (closed set)', () => {
  assert.deepEqual([...ALL_CHANNELS].sort(), ['instagram', 'tiktok']);
});

test('SCHEDULED_POST_STATUS exposes the five valid statuses', () => {
  assert.deepEqual(
    Object.values(SCHEDULED_POST_STATUS).sort(),
    ['failed', 'pending', 'posted', 'scheduled', 'skipped'],
  );
});

test('CHANNEL_STYLE exposes per-channel writing guidance', () => {
  assert.ok(CHANNEL_STYLE.tiktok.tone);
  assert.ok(CHANNEL_STYLE.instagram.tone);
  assert.ok(CHANNEL_STYLE.tiktok.max_chars < CHANNEL_STYLE.instagram.max_chars);
});

test('isValidChannel accepts only canonical channels', () => {
  assert.equal(isValidChannel('tiktok'), true);
  assert.equal(isValidChannel('instagram'), true);
  assert.equal(isValidChannel('ig'), false);
  assert.equal(isValidChannel('tt'), false);
  assert.equal(isValidChannel('youtube_shorts'), false);
  assert.equal(isValidChannel(null), false);
});

test('isValidScheduledPostStatus catches typos', () => {
  assert.equal(isValidScheduledPostStatus('pending'), true);
  assert.equal(isValidScheduledPostStatus('posted'), true);
  assert.equal(isValidScheduledPostStatus('published'), false);
  assert.equal(isValidScheduledPostStatus(''), false);
});

test('resolveTargetChannels returns [tiktok, instagram] regardless of inputs', () => {
  assert.deepEqual([...resolveTargetChannels({}, 'ai_magic')], ['tiktok', 'instagram']);
  assert.deepEqual([...resolveTargetChannels(null, null)], ['tiktok', 'instagram']);
});

test('buildScheduledPostsRows: one row per channel, pending status', () => {
  const rows = buildScheduledPostsRows('content-uuid', ['tiktok', 'instagram'], {
    tiktok: 'TT caption',
    instagram: 'IG caption',
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].content_id, 'content-uuid');
  assert.equal(rows[0].channel, 'tiktok');
  assert.equal(rows[0].caption, 'TT caption');
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[1].channel, 'instagram');
  assert.equal(rows[1].caption, 'IG caption');
});

test('buildScheduledPostsRows: missing caption becomes null', () => {
  const rows = buildScheduledPostsRows('cid', ['tiktok'], {});
  assert.equal(rows[0].caption, null);
});

test('buildScheduledPostsRows: invalid channel throws', () => {
  assert.throws(
    () => buildScheduledPostsRows('cid', ['tiktok', 'youtube'], {}),
    /invalid channel "youtube"/,
  );
});

test('buildScheduledPostsRows: missing contentId throws', () => {
  assert.throws(() => buildScheduledPostsRows('', ['tiktok'], {}), /contentId required/);
});

test('buildScheduledPostsRows: empty channels throws', () => {
  assert.throws(() => buildScheduledPostsRows('cid', [], {}), /non-empty array/);
});

test('generateChannelCaptions: 2 calls for 2 channels, results keyed by channel', async () => {
  const calls = [];
  const generateOne = async (content, channel) => {
    calls.push({ contentHook: content.hook, channel });
    return channel === 'tiktok' ? 'TT! 🔥' : 'IG storytelling caption.';
  };
  const out = await generateChannelCaptions(
    { hook: 'Hook' },
    ['tiktok', 'instagram'],
    generateOne,
  );
  assert.equal(calls.length, 2);
  assert.equal(out.tiktok, 'TT! 🔥');
  assert.equal(out.instagram, 'IG storytelling caption.');
});

test('generateChannelCaptions: empty caption from generateOne rejects', async () => {
  await assert.rejects(
    () => generateChannelCaptions({ hook: 'H' }, ['tiktok'], async () => ''),
    /empty caption for channel "tiktok"/,
  );
});

test('generateChannelCaptions: invalid channel rejects', async () => {
  await assert.rejects(
    () => generateChannelCaptions({ hook: 'H' }, ['youtube'], async () => 'x'),
    /invalid channel "youtube"/,
  );
});

test('generateChannelCaptions: missing generateOne rejects', async () => {
  await assert.rejects(
    () => generateChannelCaptions({ hook: 'H' }, ['tiktok'], null),
    /generateOne function required/,
  );
});

// --- DB-backed helpers: smoke-test via a fake supabase client ---

function fakeSupabaseQuery({ rows = [], error = null, captureUpdate = null } = {}) {
  return {
    from(table) {
      assert.equal(table, 'scheduled_posts');
      const filters = {};
      const builder = {
        select() { return builder; },
        update(payload) { if (captureUpdate) captureUpdate.payload = payload; return builder; },
        eq(col, val) { filters[col] = val; return builder; },
        maybeSingle: async () => {
          if (error) return { data: null, error };
          const match = rows.find((r) =>
            Object.entries(filters).every(([k, v]) => r[k] === v),
          ) || null;
          return { data: match, error: null };
        },
        then(resolve) {
          if (error) return resolve({ data: null, error });
          const matches = rows.filter((r) =>
            Object.entries(filters).every(([k, v]) => r[k] === v),
          );
          resolve({ data: matches, error: null });
        },
      };
      return builder;
    },
  };
}

test('getScheduledPostsForContent returns rows for a content_id', async () => {
  const rows = [
    { id: 's1', content_id: 'cid', channel: 'tiktok', status: 'pending' },
    { id: 's2', content_id: 'cid', channel: 'instagram', status: 'pending' },
    { id: 's3', content_id: 'other', channel: 'tiktok', status: 'pending' },
  ];
  const result = await getScheduledPostsForContent(fakeSupabaseQuery({ rows }), 'cid');
  assert.equal(result.length, 2);
  assert.ok(result.every((r) => r.content_id === 'cid'));
});

test('updateScheduledPostStatus rejects invalid channel before DB call', async () => {
  await assert.rejects(
    () => updateScheduledPostStatus(fakeSupabaseQuery({}), 'cid', 'youtube', 'posted'),
    /invalid channel "youtube"/,
  );
});

test('updateScheduledPostStatus rejects invalid status before DB call', async () => {
  await assert.rejects(
    () => updateScheduledPostStatus(fakeSupabaseQuery({}), 'cid', 'tiktok', 'published'),
    /invalid status "published"/,
  );
});

test('updateScheduledPostStatus passes status + extras to update payload', async () => {
  const captureUpdate = {};
  const rows = [{ id: 's1', content_id: 'cid', channel: 'tiktok', status: 'pending' }];
  await updateScheduledPostStatus(
    fakeSupabaseQuery({ rows, captureUpdate }),
    'cid',
    'tiktok',
    'posted',
    { post_url: 'https://x.test/1', external_post_id: 'abc' },
  );
  assert.equal(captureUpdate.payload.status, 'posted');
  assert.equal(captureUpdate.payload.post_url, 'https://x.test/1');
  assert.equal(captureUpdate.payload.external_post_id, 'abc');
});
