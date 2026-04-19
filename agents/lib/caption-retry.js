/**
 * Caption-length retry discipline.
 *
 * Runs between validateBatch (shape gate) and enforceFormatGates
 * (deterministic structural checks). Its only job: catch captions
 * that overshoot the per-format cap by a recoverable margin and
 * regenerate them with explicit feedback — the same pattern the
 * regen-stale-drafts script uses to land 11/11 in-limit captions.
 *
 * Decision tree per post:
 *   caption ≤ cap                              → pass through
 *   cap < caption ≤ cap * (1 + RECOVERABLE)    → one-shot retry
 *   caption > cap * (1 + RECOVERABLE)          → no retry, flag for
 *                                                 draft review
 *
 * Every overshoot (recoverable or not, successful retry or not)
 * emits a caption_length_overshoot debug event. Telemetry for
 * tuning the 20% target margin empirically.
 */

import {
  CAPTION_MAX_BY_FORMAT,
  CAPTION_TARGET_BY_FORMAT,
  RECOVERABLE_OVERSHOOT_FRACTION,
} from './format-selector.js';
import { logActivity } from './activity.js';

const RETRY_MODEL = 'claude-haiku-4-5';

function buildRetryPrompt(post, previousLen, target, cap) {
  return (
    `You are tightening a caption for a parenting Instagram/TikTok post.\n` +
    `The editorial core is LOCKED — preserve hook, voice, emotional angle. Only cut words.\n\n` +
    `Format: ${post.post_format}\n` +
    `Hook (keep intact as orientation, do NOT include in caption): ${JSON.stringify(post.hook || '')}\n` +
    `Previous caption (${previousLen} chars — OVER the ${cap}-char hard cap):\n` +
    `"""${post.caption}"""\n\n` +
    `Rewrite. Target ≤${target} chars. Hard cap ${cap} chars. Be RUTHLESS — cut every ` +
    `non-essential word, kill throat-clearing, pick the one line that lands. Keep it tight.\n\n` +
    `Return ONLY valid JSON: {"caption": "..."}. No explanation, no code fences.`
  );
}

function parseCaptionFromText(text) {
  if (typeof text !== 'string') return null;
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '').trim();
  }
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed.caption === 'string') return parsed.caption;
  } catch {
    // fall through to regex recovery
  }
  const match = cleaned.match(/"caption"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  return match ? JSON.parse(`"${match[1]}"`) : null;
}

/**
 * @param {Array<object>} posts
 * @param {{
 *   client: { messages: { create: Function } },
 *   log?: Function,
 * }} deps
 */
export async function enforceCaptionLengthWithRetry(posts, { client, log = logActivity } = {}) {
  if (!client) throw new Error('enforceCaptionLengthWithRetry: missing deps.client');

  for (const post of posts) {
    const fmt = post?.post_format;
    const cap = CAPTION_MAX_BY_FORMAT[fmt];
    const target = CAPTION_TARGET_BY_FORMAT[fmt];
    const caption = typeof post?.caption === 'string' ? post.caption : '';

    if (cap == null || target == null) continue;              // unknown format — let format gate handle it
    if (caption.length <= cap) continue;                      // clean, no-op

    const overByChars = caption.length - cap;
    const overByPct = overByChars / cap;
    const recoverable = overByPct <= RECOVERABLE_OVERSHOOT_FRACTION;

    let retryFired = false;
    let retrySuccess = false;
    let finalLength = caption.length;

    if (recoverable) {
      retryFired = true;
      try {
        const msg = await client.messages.create({
          model: RETRY_MODEL,
          max_tokens: 400,
          messages: [{ role: 'user', content: buildRetryPrompt(post, caption.length, target, cap) }],
        });
        const newCaption = parseCaptionFromText(msg?.content?.[0]?.text);
        if (typeof newCaption === 'string' && newCaption.length > 0 && newCaption.length <= cap) {
          post.caption = newCaption;
          finalLength = newCaption.length;
          retrySuccess = true;
        } else {
          finalLength = typeof newCaption === 'string' ? newCaption.length : caption.length;
        }
      } catch (err) {
        console.warn(`[Content] caption retry failed: ${err?.message || err}`);
      }
    }

    if (!retrySuccess) {
      post.status_hint = 'draft_needs_review';
    }

    await log({
      category: 'debug',
      actor_type: 'agent',
      actor_name: 'content-agent',
      action: 'caption_length_overshoot',
      description:
        `Caption for ${fmt} was ${caption.length} chars (cap ${cap}, target ${target}). ` +
        (retryFired
          ? (retrySuccess
              ? `Retry succeeded → ${finalLength} chars.`
              : `Retry exhausted, flagged draft_needs_review (final ${finalLength} chars).`)
          : `Overshoot >5%, no retry — flagged draft_needs_review.`),
      metadata: {
        format: fmt,
        target,
        cap,
        actual: caption.length,
        over_by_chars: overByChars,
        over_by_pct: Number(overByPct.toFixed(3)),
        retry_fired: retryFired,
        retry_success: retrySuccess,
        final_length: finalLength,
      },
    });
  }

  return posts;
}
