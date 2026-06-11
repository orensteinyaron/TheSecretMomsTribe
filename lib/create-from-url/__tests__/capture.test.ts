import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capture, CaptureIncompleteError, APIFY_ACTORS } from '../capture.js';
import type { CaptureDeps } from '../types.js';

function deps(over: Partial<CaptureDeps> = {}): CaptureDeps {
  return {
    fetchWeb: async () => ({ text: '', title: undefined }),
    runApifyActor: async () => [],
    ...over,
  };
}

test('capture(web): uses fetchWeb, never Apify', async () => {
  let apifyCalled = false;
  const cap = await capture('https://example.com/post', deps({
    fetchWeb: async () => ({ text: 'A real article body about toddler sleep. #sleep #momlife', title: 'Sleep tips' }),
    runApifyActor: async () => { apifyCalled = true; return []; },
  }));
  assert.equal(apifyCalled, false);
  assert.equal(cap.platform, 'web');
  assert.equal(cap.hook, 'Sleep tips');
  assert.deepEqual(cap.hashtags, ['#sleep', '#momlife']);
  assert.equal(cap.complete, true);
});

test('capture(instagram): routes to the IG post scraper and normalizes a carousel', async () => {
  let usedActor = '';
  let usedInput: Record<string, unknown> = {};
  const cap = await capture('https://www.instagram.com/p/ABC/', deps({
    runApifyActor: async (actor, input) => {
      usedActor = actor; usedInput = input;
      return [{
        type: 'Sidecar',
        caption: 'Three things I wish I knew #momtips #newborn',
        ownerUsername: 'somemom',
        likesCount: 1200, commentsCount: 45,
        childPosts: [{ alt: 'slide a' }, { alt: 'slide b' }, { alt: 'slide c' }],
      }];
    },
  }));
  assert.equal(usedActor, APIFY_ACTORS.instagram);
  assert.deepEqual(usedInput, { directUrls: ['https://www.instagram.com/p/ABC/'], resultsType: 'posts', resultsLimit: 1 });
  assert.equal(cap.format, 'carousel');
  assert.equal(cap.slides.length, 3);
  assert.equal(cap.creator_handle, 'somemom');
  assert.equal(cap.engagement.likes, 1200);
  assert.equal(cap.complete, true);
});

test('capture(tiktok): routes to clockworks/free-tiktok-scraper and normalizes a video', async () => {
  let usedActor = '';
  const cap = await capture('https://www.tiktok.com/@user/video/123', deps({
    runApifyActor: async (actor) => {
      usedActor = actor;
      return [{
        text: 'POV: the 5pm meltdown #toddlerlife',
        authorMeta: { name: 'ttmom', nickName: 'TT Mom' },
        playCount: 90000, diggCount: 5000, commentCount: 120, shareCount: 30,
      }];
    },
  }));
  assert.equal(usedActor, APIFY_ACTORS.tiktok);
  assert.equal(cap.format, 'video');
  assert.equal(cap.creator_handle, 'ttmom');
  assert.equal(cap.engagement.views, 90000);
  assert.equal(cap.hook, 'POV: the 5pm meltdown #toddlerlife');
});

test('capture: throws capture_incomplete when the scraper returns nothing', async () => {
  await assert.rejects(
    () => capture('https://www.instagram.com/p/EMPTY/', deps({ runApifyActor: async () => [] })),
    (e: unknown) => e instanceof CaptureIncompleteError && e.code === 'capture_incomplete',
  );
});

test('capture: throws capture_incomplete when an IG post has neither caption nor slides', async () => {
  await assert.rejects(
    () => capture('https://www.instagram.com/p/BLANK/', deps({
      runApifyActor: async () => [{ type: 'Image', ownerUsername: 'x' }],
    })),
    (e: unknown) => e instanceof CaptureIncompleteError,
  );
});
