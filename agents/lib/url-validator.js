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
const SOCIAL_DEAD_MARKERS = {
  'tiktok.com': [
    /video\s+isn'?t\s+available/i,
    /this\s+video\s+is\s+unavailable/i,
    /page\s+not\s+available/i,
    /couldn'?t\s+find\s+this\s+account/i,
  ],
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
 * Full social-URL validation. For known platforms (TikTok, Reddit, IG) we
 * always fetch the body and scan for known "content removed" markers. Other
 * URLs just get a HEAD+GET liveness check. Cached for 1h per URL.
 *
 * @param {string} url
 * @param {{fetch?: typeof fetch, now?: () => number, cache?: Map<string,{timestamp:number,result:object}>}} [deps]
 * @returns {Promise<{valid: boolean, reason?: string, status?: number, platform: string|null}>}
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
      // Social platforms: always GET the body so we can scan it.
      const res = await fetchFn(url, { method: 'GET', redirect: 'follow' });
      if (!res.ok) {
        result = { valid: false, reason: `http_${res.status}`, status: res.status, platform };
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
          : { valid: false, reason: `http_${get.status}`, status: get.status, platform: null };
      }
    }
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'timeout' : 'network_error';
    result = { valid: false, reason, error: err?.message || String(err), platform };
  }

  cacheRef.set(url, { timestamp: now, result });
  return result;
}
