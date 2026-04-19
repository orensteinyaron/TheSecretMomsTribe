/**
 * External URL liveness validator.
 *
 * Performs HTTP + platform-specific body content checks so social platforms
 * that return 200 for dead content are still flagged (TikTok "Video isn't
 * available", Reddit [removed], private Instagram pages).
 *
 * Results are cached in-memory for 1 hour per URL so we never re-hit the
 * same URL multiple times within a single pipeline run.
 */

const CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10_000;
const cache = new Map();

// Domain → regexes that identify a dead/removed page even when HTTP is 200.
//
// V2 NOTE: TikTok is recognized as a social host for platform
// classification, but its marker list is intentionally empty.
// TikTok serves "Video isn't available" / "Couldn't find this
// account" as its *region-block* response, indistinguishable from a
// true takedown when viewed from a cloud-provider IP range (GitHub
// Actions runners hit geo-blocks). Body-scanning from the runner
// produces false negatives, so we trust apify-scraped TikTok URLs
// instead of re-validating them. See URL_VALIDATION_V2_SPEC.
const SOCIAL_DEAD_MARKERS = {
  'tiktok.com': [],
  'reddit.com': [
    /\[removed\]/i,
    /\[deleted\]/i,
    /sorry,\s+this\s+post\s+was\s+removed/i,
    /there\s+doesn'?t\s+seem\s+to\s+be\s+anything\s+here/i,
    /this\s+community\s+is\s+private/i,
  ],
  'instagram.com': [
    /sorry,\s+this\s+page\s+isn'?t\s+available/i,
    /the\s+link\s+you\s+followed\s+may\s+be\s+broken/i,
    /this\s+account\s+is\s+private/i,
  ],
};

// HTTP status codes that unambiguously mean the URL is dead. Anything
// outside this set gets a softer treatment (valid-with-caveat) so
// cloud-IP fingerprinting or transient errors don't drop real URLs.
const UNAMBIGUOUS_DEAD_STATUSES = new Set([404, 410, 451]);

export function clearCache() {
  cache.clear();
}

/**
 * Short platform slug for an opportunity's source URL. For the full host
 * (e.g. "tiktok.com") use the internal classifier via validateSocialUrl's
 * result.platform. This returns compact slugs suitable for storage on
 * daily_briefings.opportunities[].platform.
 *
 * Returns one of: tiktok, reddit, instagram, youtube, twitter,
 * google_trends, other, unknown.
 */
export function platformOf(url) {
  if (!url || typeof url !== 'string') return 'unknown';
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'tiktok.com'    || host.endsWith('.tiktok.com'))    return 'tiktok';
    if (host === 'reddit.com'    || host.endsWith('.reddit.com'))    return 'reddit';
    if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
    if (host === 'youtube.com'   || host.endsWith('.youtube.com') || host === 'youtu.be') return 'youtube';
    if (host === 'twitter.com'   || host.endsWith('.twitter.com')
     || host === 'x.com'         || host.endsWith('.x.com'))         return 'twitter';
    if (host === 'google.com'    || host.endsWith('.google.com'))    return 'google_trends';
    return 'other';
  } catch {
    return 'unknown';
  }
}

export function getCacheSize() {
  return cache.size;
}

function classifyPlatform(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const domain of Object.keys(SOCIAL_DEAD_MARKERS)) {
      if (host === domain || host.endsWith(`.${domain}`)) return domain;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Low-level HTTP liveness check: HEAD with GET fallback. Status only.
 * Injectable `fetch` for tests.
 *
 * @param {string} url
 * @param {{fetch?: typeof fetch}} [deps]
 * @returns {Promise<{valid: boolean, status?: number, error?: string}>}
 */
export async function validateUrl(url, deps = {}) {
  const fetchFn = deps.fetch || fetchWithTimeout;
  try {
    const head = await fetchFn(url, { method: 'HEAD', redirect: 'follow' });
    if (head.ok) return { valid: true, status: head.status };
    const get = await fetchFn(url, { method: 'GET', redirect: 'follow' });
    return get.ok
      ? { valid: true, status: get.status }
      : { valid: false, status: get.status, error: `http_${get.status}` };
  } catch (err) {
    return { valid: false, error: err?.message || String(err) };
  }
}

/**
 * Full social-URL validation (V2 — trust-biased).
 *
 * Only drops on UNAMBIGUOUS server signals: HTTP 404, 410, 451, or a
 * Reddit/Instagram body marker that only appears for real moderation
 * actions. Everything else (403, timeout, network error, TikTok body
 * text) returns valid-with-caveat. The caller logs the caveat but
 * does not drop the URL — the runner's vantage point is unreliable
 * for cloud-IP-fingerprinted and geo-blocked content.
 *
 * Cached for 1h per URL.
 *
 * @param {string} url
 * @param {{fetch?: typeof fetch, now?: () => number, cache?: Map<string,{timestamp:number,result:object}>}} [deps]
 * @returns {Promise<{valid: boolean, reason?: string, caveat?: string, status?: number, platform: string|null}>}
 */
export async function validateSocialUrl(url, deps = {}) {
  const cacheRef = deps.cache || cache;
  const now = deps.now ? deps.now() : Date.now();
  const cached = cacheRef.get(url);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) return cached.result;

  const platform = classifyPlatform(url);
  const fetchFn = deps.fetch || fetchWithTimeout;

  let result;
  try {
    if (platform) {
      // Social platforms: always GET so we can scan the body for
      // unambiguous moderation markers (Reddit [removed], IG private).
      const res = await fetchFn(url, { method: 'GET', redirect: 'follow' });
      if (!res.ok) {
        result = statusResult(res.status, platform);
      } else {
        const body = typeof res.text === 'function' ? await res.text() : '';
        const markers = SOCIAL_DEAD_MARKERS[platform] || [];
        const deadMarker = markers.find((re) => re.test(body));
        result = deadMarker
          ? { valid: false, reason: 'content_removed', status: res.status, platform }
          : { valid: true, status: res.status, platform };
      }
    } else {
      const head = await fetchFn(url, { method: 'HEAD', redirect: 'follow' });
      if (head.ok) {
        result = { valid: true, status: head.status, platform: null };
      } else {
        const get = await fetchFn(url, { method: 'GET', redirect: 'follow' });
        result = get.ok
          ? { valid: true, status: get.status, platform: null }
          : statusResult(get.status, null);
      }
    }
  } catch (err) {
    result = {
      valid: true,
      caveat: 'fetch_failed',
      error: err?.message || String(err),
      platform,
    };
  }

  cacheRef.set(url, { timestamp: now, result });
  return result;
}

function statusResult(status, platform) {
  if (UNAMBIGUOUS_DEAD_STATUSES.has(status)) {
    return { valid: false, reason: `http_${status}`, status, platform };
  }
  if (status === 403) {
    return { valid: true, caveat: 'http_403_likely_ip_block', status, platform };
  }
  // Any other non-2xx: treat as valid-with-caveat. The runner's HTTP
  // status is a weak signal; downstream should not drop on it.
  return { valid: true, caveat: `http_${status}_ambiguous`, status, platform };
}
