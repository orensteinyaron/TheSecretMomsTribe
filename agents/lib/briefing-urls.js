/**
 * Briefing URL validation + sizing constants.
 *
 * Extracted from agents/research.js so the validation logic can be unit
 * + integration tested without triggering research.js's auto-invoked
 * main() (which kicks off Apify scrapers and an Anthropic call on
 * module load).
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

/**
 * Validate every opportunity's source_url. Opportunities whose URL is dead
 * are DROPPED from the briefing entirely and logged to activity_log.
 * Survivors get a short `platform` slug stamped on them (tiktok/reddit/
 * instagram/…) so downstream doesn't have to re-derive from the URL.
 *
 * Opportunities without a URL survive with platform='unknown'.
 *
 * @param {Array<object>} opportunities
 * @param {{validate?: Function, log?: Function}} [deps]
 * @returns {Promise<{surviving: object[], checked: number, dropped: number}>}
 */
export async function validateBriefingUrls(
  opportunities,
  { validate = validateSocialUrl, log = logActivity } = {},
) {
  const surviving = [];
  let checked = 0;
  let dropped = 0;

  for (const opp of opportunities) {
    const url = typeof opp.source_url === 'string' ? opp.source_url.trim() : '';
    if (!url) {
      opp.platform = 'unknown';
      surviving.push(opp);
      continue;
    }
    checked++;

    const result = await validate(url);
    if (result.valid) {
      opp.platform = platformOf(url);
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
        platform: platformOf(url),
        signal_id: opp.signal_id,
        topic: opp.topic,
      },
    });
    // opp dropped — not pushed to surviving
  }

  console.log(`[Research] URL validation: ${checked} checked, ${dropped} dropped, ${surviving.length} surviving`);
  return { surviving, checked, dropped };
}
