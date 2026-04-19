/**
 * Briefing URL validation + sizing constants.
 *
 * V2 (2026-04-19): trust-on-scrape model. Opportunities carry a
 * `signal_source` tag set by the scraper that produced them. Sources
 * beginning with `apify_` are trusted — the scrape itself is proof of
 * liveness and we skip the URL check entirely. This is the only way
 * to get correct results: GitHub Actions runners sit in cloud IP
 * ranges that Reddit/TikTok fingerprint or geo-block, so validation
 * from the runner is structurally unable to distinguish "dead" from
 * "blocked from our vantage point."
 *
 * `llm_inferred`, `user_submitted`, or missing signal_source values
 * still validate — the safety net for hallucinated URLs.
 */

import { logActivity } from './activity.js';
import { validateSocialUrl, platformOf } from './url-validator.js';

// How many final opportunities a briefing should carry.
export const BRIEFING_TARGET = 5;

// Over-generate at synthesis time with this headroom so URL drops don't
// shorten the final briefing. 60% headroom survives up to a ~40% dead
// rate before the buffer is exhausted.
export const BRIEFING_REQUEST_COUNT = Math.ceil(BRIEFING_TARGET * 1.6); // 8

// Below this, the run FAILS LOUDLY. Silent short briefings starve
// downstream content capacity; fail-loud surfaces upstream source-health
// issues via pipeline-monitor → email alert.
export const MIN_ACCEPTABLE_BRIEFING = 3;

function isTrustedSource(signalSource) {
  return typeof signalSource === 'string' && signalSource.startsWith('apify_');
}

/**
 * Validate every opportunity's source_url — or skip based on provenance.
 *
 * Decision tree per opportunity:
 *   1. skipAll=true → survive, platform stamped, no fetch, no log-per-opp
 *   2. No source_url → survive with platform='unknown'
 *   3. signal_source starts with 'apify_' → trusted, survive, no fetch
 *   4. Otherwise → run validate(); drop if invalid.
 *
 * @param {Array<object>} opportunities
 * @param {{validate?: Function, log?: Function, skipAll?: boolean}} [deps]
 * @returns {Promise<{surviving: object[], checked: number, dropped: number, trusted: number, skipped?: number}>}
 */
export async function validateBriefingUrls(
  opportunities,
  { validate = validateSocialUrl, log = logActivity, skipAll = false } = {},
) {
  if (skipAll) {
    for (const opp of opportunities) {
      const url = typeof opp.source_url === 'string' ? opp.source_url.trim() : '';
      opp.platform = url ? platformOf(url) : 'unknown';
    }
    await log({
      category: 'alert',
      actor_type: 'agent',
      actor_name: 'research-agent',
      action: 'url_validation_skipped',
      description: 'URL validation bypassed via SKIP_URL_VALIDATION flag',
      metadata: { count: opportunities.length },
    });
    console.warn(
      `[Research] URL validation SKIPPED (SKIP_URL_VALIDATION active): ${opportunities.length} opps passed through untouched.`,
    );
    return {
      surviving: opportunities,
      checked: 0,
      dropped: 0,
      trusted: 0,
      skipped: opportunities.length,
    };
  }

  const surviving = [];
  let checked = 0;
  let dropped = 0;
  let trusted = 0;

  for (const opp of opportunities) {
    const url = typeof opp.source_url === 'string' ? opp.source_url.trim() : '';

    if (!url) {
      opp.platform = 'unknown';
      surviving.push(opp);
      continue;
    }

    opp.platform = platformOf(url);

    if (isTrustedSource(opp.signal_source)) {
      trusted++;
      surviving.push(opp);
      continue;
    }

    checked++;
    const result = await validate(url);
    if (result.valid) {
      surviving.push(opp);
      continue;
    }

    dropped++;
    const reason = result.reason || result.error || 'unknown';
    console.warn(`[Research] URL validation failed — dropping: ${url} (${reason})`);

    await log({
      category: 'debug',
      actor_type: 'agent',
      actor_name: 'research-agent',
      action: 'url_validation_dropped_research',
      description: `URL validation failed: ${url} — ${reason}`,
      metadata: {
        url,
        reason,
        status: result.status ?? null,
        platform: opp.platform,
        signal_source: opp.signal_source ?? 'missing',
        signal_id: opp.signal_id,
        topic: opp.topic,
      },
    });
  }

  console.log(
    `[Research] URL validation: ${trusted} trusted (apify), ${checked} checked, ${dropped} dropped, ${surviving.length} surviving`,
  );
  return { surviving, checked, dropped, trusted };
}
