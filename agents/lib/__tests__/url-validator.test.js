/**
 * Tests for url-validator. All network calls are stubbed via a fake fetch
 * so the suite runs offline and deterministically.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Env stubs so any transitive import of ./supabase.js doesn't process.exit.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub';

const { validateUrl, validateSocialUrl, platformOf } = await import('../url-validator.js');

function makeResponse({ ok = true, status = 200, body = '' } = {}) {
  return { ok, status, text: async () => body };
}

function makeFakeFetch(planByUrlOrMethod) {
  // planByUrlOrMethod: (url, opts) => Response
  return async (url, opts) => planByUrlOrMethod(url, opts || {});
}

test('validateUrl: HEAD 200 → valid', async () => {
  const fakeFetch = makeFakeFetch(() => makeResponse({ ok: true, status: 200 }));
  const out = await validateUrl('https://example.com', { fetch: fakeFetch });
  assert.equal(out.valid, true);
  assert.equal(out.status, 200);
});

test('validateUrl: HEAD 405 → GET 200 → valid', async () => {
  let call = 0;
  const fakeFetch = makeFakeFetch((_url, opts) => {
    call++;
    if (opts.method === 'HEAD') return makeResponse({ ok: false, status: 405 });
    return makeResponse({ ok: true, status: 200 });
  });
  const out = await validateUrl('https://example.com', { fetch: fakeFetch });
  assert.equal(out.valid, true);
  assert.equal(call, 2);
});

test('validateUrl: HEAD + GET both fail → invalid with status', async () => {
  const fakeFetch = makeFakeFetch(() => makeResponse({ ok: false, status: 404 }));
  const out = await validateUrl('https://example.com/dead', { fetch: fakeFetch });
  assert.equal(out.valid, false);
  assert.equal(out.status, 404);
});

test('validateUrl: network throws → invalid with error', async () => {
  const fakeFetch = async () => {
    throw new Error('ECONNREFUSED');
  };
  const out = await validateUrl('https://example.com', { fetch: fakeFetch });
  assert.equal(out.valid, false);
  assert.match(out.error, /ECONNREFUSED/);
});

test('validateSocialUrl: live Reddit post → valid', async () => {
  const cache = new Map();
  const fakeFetch = makeFakeFetch(() =>
    makeResponse({ ok: true, status: 200, body: '<html>A lively post body about toddlers</html>' }),
  );
  const out = await validateSocialUrl('https://www.reddit.com/r/Parenting/comments/abc/', {
    fetch: fakeFetch,
    cache,
  });
  assert.equal(out.valid, true);
  assert.equal(out.platform, 'reddit.com');
});

test('validateSocialUrl: [removed] Reddit post → invalid content_removed', async () => {
  const cache = new Map();
  const fakeFetch = makeFakeFetch(() =>
    makeResponse({ ok: true, status: 200, body: '<p>[removed]</p>' }),
  );
  const out = await validateSocialUrl('https://reddit.com/r/x/comments/y/', {
    fetch: fakeFetch,
    cache,
  });
  assert.equal(out.valid, false);
  assert.equal(out.reason, 'content_removed');
  assert.equal(out.platform, 'reddit.com');
});

test('V2: TikTok "Video isn\'t available" body (geo-block) → treated as valid', async () => {
  // The exact string TikTok serves as a REGION BLOCK — not a removed-content
  // response. GitHub Actions runners hit geo-blocks, so this marker is a
  // false positive and must not cause a drop.
  const cache = new Map();
  const fakeFetch = makeFakeFetch(() =>
    makeResponse({
      ok: true,
      status: 200,
      body: '<html><body><h1>Video isn\'t available</h1></body></html>',
    }),
  );
  const out = await validateSocialUrl('https://www.tiktok.com/@user/video/123', {
    fetch: fakeFetch,
    cache,
  });
  assert.equal(out.valid, true);
  assert.equal(out.platform, 'tiktok.com');
});

test('V2: TikTok "Couldn\'t find this account" body → also treated as valid', async () => {
  const cache = new Map();
  const fakeFetch = makeFakeFetch(() =>
    makeResponse({ ok: true, status: 200, body: "<h1>Couldn't find this account</h1>" }),
  );
  const out = await validateSocialUrl('https://tiktok.com/@ghost', {
    fetch: fakeFetch,
    cache,
  });
  assert.equal(out.valid, true);
});

test('V2: HTTP 403 returns valid with caveat=http_403_likely_ip_block (Reddit cloud-IP fingerprint)', async () => {
  const cache = new Map();
  const fakeFetch = makeFakeFetch(() => makeResponse({ ok: false, status: 403, body: '' }));
  const out = await validateSocialUrl('https://reddit.com/r/x/comments/y/', {
    fetch: fakeFetch,
    cache,
  });
  assert.equal(out.valid, true);
  assert.equal(out.caveat, 'http_403_likely_ip_block');
  assert.equal(out.status, 403);
});

test('V2: HTTP 404 still returns invalid', async () => {
  const cache = new Map();
  const fakeFetch = makeFakeFetch(() => makeResponse({ ok: false, status: 404, body: '' }));
  const out = await validateSocialUrl('https://example.com/nope', {
    fetch: fakeFetch,
    cache,
  });
  assert.equal(out.valid, false);
  assert.equal(out.reason, 'http_404');
  assert.equal(out.status, 404);
});

test('V2: HTTP 410 Gone still returns invalid', async () => {
  const cache = new Map();
  const fakeFetch = makeFakeFetch(() => makeResponse({ ok: false, status: 410, body: '' }));
  const out = await validateSocialUrl('https://example.com/gone', {
    fetch: fakeFetch,
    cache,
  });
  assert.equal(out.valid, false);
  assert.equal(out.reason, 'http_410');
});

test('V2: HTTP 451 legal removal still returns invalid', async () => {
  const cache = new Map();
  const fakeFetch = makeFakeFetch(() => makeResponse({ ok: false, status: 451, body: '' }));
  const out = await validateSocialUrl('https://example.com/dmca', {
    fetch: fakeFetch,
    cache,
  });
  assert.equal(out.valid, false);
  assert.equal(out.reason, 'http_451');
});

test('validateSocialUrl: private Instagram page → invalid', async () => {
  const cache = new Map();
  const fakeFetch = makeFakeFetch(() =>
    makeResponse({
      ok: true,
      status: 200,
      body: '<h2>Sorry, this page isn\'t available.</h2>',
    }),
  );
  const out = await validateSocialUrl('https://www.instagram.com/p/abc/', {
    fetch: fakeFetch,
    cache,
  });
  assert.equal(out.valid, false);
  assert.equal(out.reason, 'content_removed');
});

test('validateSocialUrl: caches within TTL, expires after', async () => {
  const cache = new Map();
  let calls = 0;
  const fakeFetch = makeFakeFetch(() => {
    calls++;
    return makeResponse({ ok: true, status: 200, body: 'ok' });
  });
  const url = 'https://reddit.com/r/x/comments/y/';

  await validateSocialUrl(url, { fetch: fakeFetch, cache, now: () => 1000 });
  await validateSocialUrl(url, { fetch: fakeFetch, cache, now: () => 1500 });
  assert.equal(calls, 1, 'second call within TTL should hit cache');

  // advance past 1-hour TTL
  await validateSocialUrl(url, { fetch: fakeFetch, cache, now: () => 1000 + 60 * 60 * 1000 + 1 });
  assert.equal(calls, 2, 'call after TTL should re-fetch');
});

test('validateSocialUrl: non-social URL uses HEAD first', async () => {
  const cache = new Map();
  const methods = [];
  const fakeFetch = makeFakeFetch((_url, opts) => {
    methods.push(opts.method);
    return makeResponse({ ok: true, status: 200 });
  });
  const out = await validateSocialUrl('https://example.com/article', {
    fetch: fakeFetch,
    cache,
  });
  assert.equal(out.valid, true);
  assert.equal(out.platform, null);
  assert.equal(methods[0], 'HEAD');
});

test('V2: timeout/AbortError → valid with caveat=fetch_failed (our infra flakiness)', async () => {
  const cache = new Map();
  const fakeFetch = async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  };
  const out = await validateSocialUrl('https://www.tiktok.com/@user/video/123', {
    fetch: fakeFetch,
    cache,
  });
  assert.equal(out.valid, true);
  assert.equal(out.caveat, 'fetch_failed');
});

test('V2: generic network error → valid with caveat=fetch_failed', async () => {
  const cache = new Map();
  const fakeFetch = async () => {
    throw new Error('ECONNRESET');
  };
  const out = await validateSocialUrl('https://example.com/flaky', {
    fetch: fakeFetch,
    cache,
  });
  assert.equal(out.valid, true);
  assert.equal(out.caveat, 'fetch_failed');
});

// --- platformOf ------------------------------------------------------------

test('platformOf: major social platforms return short slugs', () => {
  assert.equal(platformOf('https://www.tiktok.com/@x/video/1'),     'tiktok');
  assert.equal(platformOf('https://tiktok.com/@x/video/1'),         'tiktok');
  assert.equal(platformOf('https://www.reddit.com/r/Parenting/'),   'reddit');
  assert.equal(platformOf('https://old.reddit.com/r/x/'),           'reddit');
  assert.equal(platformOf('https://www.instagram.com/p/abc/'),      'instagram');
  assert.equal(platformOf('https://www.youtube.com/watch?v=abc'),   'youtube');
  assert.equal(platformOf('https://youtu.be/abc'),                  'youtube');
  assert.equal(platformOf('https://twitter.com/u/status/1'),        'twitter');
  assert.equal(platformOf('https://x.com/u/status/1'),              'twitter');
  assert.equal(platformOf('https://trends.google.com/trends/x'),    'google_trends');
});

test('platformOf: unrecognized host → "other"', () => {
  assert.equal(platformOf('https://nytimes.com/article'), 'other');
  assert.equal(platformOf('https://some-blog.net/post'),  'other');
});

test('platformOf: null / empty / malformed → "unknown"', () => {
  assert.equal(platformOf(null),        'unknown');
  assert.equal(platformOf(undefined),   'unknown');
  assert.equal(platformOf(''),          'unknown');
  assert.equal(platformOf('not a url'), 'unknown');
  assert.equal(platformOf(12345),       'unknown');
});
