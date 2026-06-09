import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createLifecycle } from '../lifecycle.js';
import { ShadowLifecycleStore } from '../shadow-store.js';
import type { EnqueueInput } from '../types.js';

function baseInput(overrides: Partial<EnqueueInput> = {}): EnqueueInput {
  return {
    renderProfileSlug: 'carousel',
    pillar: 'parenting',
    hook: 'a hook',
    baseCaption: 'a base caption',
    finalAssetUrl: 'https://example.com/asset.png',
    channels: [
      { channel: 'instagram', caption: 'ig caption' },
      { channel: 'tiktok', caption: 'tt caption' },
    ],
    metadata: { source_url: 'https://src', creator_handle: '@x' },
    ...overrides,
  };
}

function setup() {
  const store = new ShadowLifecycleStore();
  return { store, lifecycle: createLifecycle(store) };
}

// ── enqueue ──────────────────────────────────────────────────────────────────

test('enqueuePiece: inserts content + one pending scheduled_post per channel', async () => {
  const { store, lifecycle } = setup();
  const { contentId, scheduledPosts } = await lifecycle.enqueuePiece(baseInput());

  assert.equal(scheduledPosts.length, 2);
  assert.deepEqual(scheduledPosts.map((p) => p.channel).sort(), ['instagram', 'tiktok']);
  assert.ok(scheduledPosts.every((p) => p.status === 'pending'));

  const content = store.content.get(contentId);
  assert.ok(content);
  assert.equal(content?.render_status, 'complete');
  assert.equal(content?.status, 'pending_approval'); // fail-closed default
  assert.ok(content?.final_asset_url);
  assert.ok(content?.render_completed_at);
});

test('enqueuePiece: approved=true maps to status approved', async () => {
  const { store, lifecycle } = setup();
  const { contentId } = await lifecycle.enqueuePiece(baseInput({ approved: true }));
  assert.equal(store.content.get(contentId)?.status, 'approved');
});

test('enqueuePiece: rejects empty channels', async () => {
  const { lifecycle } = setup();
  await assert.rejects(() => lifecycle.enqueuePiece(baseInput({ channels: [] })), /at least one channel/);
});

test('enqueuePiece: rejects duplicate channel', async () => {
  const { lifecycle } = setup();
  await assert.rejects(
    () =>
      lifecycle.enqueuePiece(
        baseInput({
          channels: [
            { channel: 'instagram', caption: 'a' },
            { channel: 'instagram', caption: 'b' },
          ],
        }),
      ),
    /duplicate channel/,
  );
});

test('enqueuePiece: rejects invalid slug, pillar, and missing required fields', async () => {
  const { lifecycle } = setup();
  await assert.rejects(
    () => lifecycle.enqueuePiece(baseInput({ renderProfileSlug: 'nope' as never })),
    /invalid renderProfileSlug/,
  );
  await assert.rejects(
    () => lifecycle.enqueuePiece(baseInput({ pillar: 'nope' as never })),
    /invalid pillar/,
  );
  await assert.rejects(() => lifecycle.enqueuePiece(baseInput({ hook: '' })), /missing required field: hook/);
  await assert.rejects(
    () => lifecycle.enqueuePiece(baseInput({ finalAssetUrl: '   ' })),
    /missing required field: finalAssetUrl/,
  );
});

// ── markPosted idempotency ───────────────────────────────────────────────────

test('markPosted: second call is an idempotent no-op (REQUIRED)', async () => {
  const { lifecycle } = setup();
  const { contentId } = await lifecycle.enqueuePiece(baseInput());

  const first = await lifecycle.markPosted(contentId, 'instagram', 'https://ig/p/1', 'IG_1');
  assert.equal(first.idempotentNoop, false);
  assert.equal(first.row.status, 'posted');
  assert.equal(first.row.external_post_id, 'IG_1');
  assert.ok(first.row.published_at);

  // Second call — even with different args — must NOT overwrite; first write wins.
  const second = await lifecycle.markPosted(contentId, 'instagram', 'https://ig/p/DIFFERENT', 'IG_DIFFERENT');
  assert.equal(second.idempotentNoop, true);
  assert.equal(second.row.external_post_id, 'IG_1'); // unchanged
  assert.equal(second.row.post_url, 'https://ig/p/1'); // unchanged
});

test('markPosted: fail-closed on a channel that was never enqueued', async () => {
  const { lifecycle } = setup();
  const { contentId } = await lifecycle.enqueuePiece(
    baseInput({ channels: [{ channel: 'instagram', caption: 'ig' }] }),
  );
  await assert.rejects(
    () => lifecycle.markPosted(contentId, 'tiktok', 'https://tt/1', 'TT_1'),
    /fail-closed: no scheduled_posts row/,
  );
});

test('markPosted: requires non-empty post_url and external_post_id', async () => {
  const { lifecycle } = setup();
  const { contentId } = await lifecycle.enqueuePiece(baseInput());
  await assert.rejects(() => lifecycle.markPosted(contentId, 'instagram', '', 'IG_1'), /postUrl/);
  await assert.rejects(() => lifecycle.markPosted(contentId, 'instagram', 'https://ig/1', ''), /externalPostId/);
});

// ── markFailed / markSkipped ─────────────────────────────────────────────────

test('markFailed: writes failure_reason and is never silent', async () => {
  const { lifecycle } = setup();
  const { contentId } = await lifecycle.enqueuePiece(baseInput());
  const r = await lifecycle.markFailed(contentId, 'tiktok', 'upload_rejected');
  assert.equal(r.row.status, 'failed');
  assert.equal(r.row.failure_reason, 'upload_rejected');
  await assert.rejects(() => lifecycle.markFailed(contentId, 'instagram', ''), /reason/);
});

test('markSkipped: writes reason; refuses to overwrite a posted channel', async () => {
  const { lifecycle } = setup();
  const { contentId } = await lifecycle.enqueuePiece(baseInput());
  await lifecycle.markPosted(contentId, 'instagram', 'https://ig/1', 'IG_1');
  await assert.rejects(
    () => lifecycle.markSkipped(contentId, 'instagram', 'tiktok_web_photo_unsupported'),
    /refusing to overwrite a 'posted' channel/,
  );
  const ok = await lifecycle.markSkipped(contentId, 'tiktok', 'tiktok_web_photo_unsupported');
  assert.equal(ok.row.status, 'skipped');
  assert.equal(ok.row.failure_reason, 'tiktok_web_photo_unsupported');
});

test('markFailed: fail-closed on a non-enqueued channel', async () => {
  const { lifecycle } = setup();
  const { contentId } = await lifecycle.enqueuePiece(
    baseInput({ channels: [{ channel: 'instagram', caption: 'ig' }] }),
  );
  await assert.rejects(
    () => lifecycle.markFailed(contentId, 'tiktok', 'whatever'),
    /fail-closed: no scheduled_posts row/,
  );
});

// ── postCheck ────────────────────────────────────────────────────────────────

test('postCheck: catches a missing channel row (REQUIRED)', async () => {
  const { lifecycle } = setup();
  const { contentId } = await lifecycle.enqueuePiece(
    baseInput({ channels: [{ channel: 'instagram', caption: 'ig' }] }),
  );
  const report = await lifecycle.postCheck(contentId, ['instagram', 'tiktok']);
  assert.equal(report.fullyPosted, false);
  const tt = report.channels.find((c) => c.channel === 'tiktok');
  assert.equal(tt?.status, 'missing');
  assert.ok(report.issues.some((i) => /tiktok: missing/.test(i)));
});

test('postCheck: catches a half-written posted row (REQUIRED)', async () => {
  const { store, lifecycle } = setup();
  const { contentId } = await lifecycle.enqueuePiece(baseInput());

  // Corrupt the shadow row to simulate a half-written close: status posted but
  // no post_url / external_post_id / published_at (what a bad write looks like).
  for (const row of store.posts.values()) {
    if (row.content_id === contentId && row.channel === 'instagram') {
      row.status = 'posted';
    }
  }
  const report = await lifecycle.postCheck(contentId, ['instagram', 'tiktok']);
  assert.equal(report.fullyPosted, false);
  const ig = report.channels.find((c) => c.channel === 'instagram');
  assert.equal(ig?.ok, false);
  assert.ok(ig?.issues.some((i) => /half-written/.test(i)));
});

test('postCheck: fullyPosted only when every expected channel is posted', async () => {
  const { lifecycle } = setup();
  const { contentId } = await lifecycle.enqueuePiece(baseInput());
  await lifecycle.markPosted(contentId, 'instagram', 'https://ig/1', 'IG_1');
  let report = await lifecycle.postCheck(contentId, ['instagram', 'tiktok']);
  assert.equal(report.fullyPosted, false); // tiktok still pending

  await lifecycle.markPosted(contentId, 'tiktok', 'https://tt/1', 'TT_1');
  report = await lifecycle.postCheck(contentId, ['instagram', 'tiktok']);
  assert.equal(report.fullyPosted, true);
  assert.equal(report.issues.length, 0);
});
