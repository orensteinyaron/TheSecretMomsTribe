/**
 * User-message prompt builder for the content generation agent.
 *
 * v2.0.0 (CHANNEL_MODEL_V1): the LLM emits `render_profile_slug` and
 * `channels` — never `post_format` or the inline channel columns.
 *
 * Extracted from agents/content.js to enable unit testing of the prompt
 * text (length discipline, schema constraints) without pulling in the
 * whole agent's env-required module initialization.
 *
 * Pure function: takes briefing + context, returns the exact string that
 * gets sent to the LLM. No IO, no mutation of inputs.
 */

import { AXES } from './image-diversity.js';
import {
  CAPTION_MAX_BY_SLUG,
  CAPTION_TARGET_BY_SLUG,
  MIN_CAROUSEL_SLIDES,
} from './format-selector.js';
import { ALL_RENDER_PROFILE_SLUGS } from './render-profiles.js';
import { ALL_CHANNELS, DEFAULT_CHANNELS } from './channels.js';

function capsSchemaLine() {
  // e.g. "static-image: target ≤160, cap ≤200; ..."
  return Object.entries(CAPTION_MAX_BY_SLUG)
    .map(([slug, cap]) => `${slug}: target ≤${CAPTION_TARGET_BY_SLUG[slug]}, cap ≤${cap}`)
    .join('; ');
}

/**
 * @param {object} params
 * @param {{ opportunities: any[] }} params.briefing
 * @param {{ gaps: string }} params.coverageGaps
 * @param {string[]} params.recentHooks
 * @param {Array<{ directive: string, directive_type: string }>} params.directives
 * @param {Array<{ insight: string, insight_type: string, confidence: number }>} params.insights
 * @returns {string}
 */
export function buildUserPrompt({ briefing, coverageGaps, recentHooks, directives, insights }) {
  const numOpps = briefing.opportunities.length;

  // Build strategy context block
  let strategyBlock = '';
  if (directives.length > 0) {
    strategyBlock += '\n## Active Directives (follow these)\n';
    for (const d of directives) strategyBlock += `- [${d.directive_type}] ${d.directive}\n`;
  }
  if (insights.length > 0) {
    strategyBlock += '\n## Confirmed Strategy Insights (apply these learnings)\n';
    for (const ins of insights.slice(0, 10)) {
      strategyBlock += `- [${ins.insight_type}, confidence: ${ins.confidence}] ${ins.insight}\n`;
    }
  }

  return `Generate a post for EVERY good opportunity below. Be GREEDY — stockpile everything good. AI Magic and Tech posts are rare, always generate them.
${strategyBlock}

## Today's Briefing Opportunities (${numOpps} total)
${JSON.stringify(briefing.opportunities, null, 2)}

## Coverage Gaps (last 7 days — for reference, NOT a constraint)
${coverageGaps.gaps}

## Recent Hooks to AVOID (do not duplicate)
${recentHooks.slice(0, 20).map((h) => `- "${h}"`).join('\n') || 'None yet.'}

## For Each Opportunity, Generate One Post

Pick the best render_profile_slug for each opportunity (one of ${JSON.stringify(ALL_RENDER_PROFILE_SLUGS)}):
- moving-images — slideshow video (hook → 4 magic slides → payoff). Best for step-by-step, lists, swaps, reveals, AI Magic walkthroughs.
- static-image — single PNG (1080×1920). Best for single powerful statements, memes, tight quotes.
- carousel — multi-slide image swipe (3–7 slides). Best for IG-style deep dives.
- avatar-v1 — Rachel speaking. Best for hot takes, personal stories, emotional topics. Carries avatar_config.format ("full_avatar" or "avatar_visual").

Default the \`channels\` array to ${JSON.stringify([...DEFAULT_CHANNELS])} for every piece. Only narrow it if a specific channel makes no sense for the piece.

## QUALITY RULES (these still apply to EVERY post)
- Follow ALL voice rules from Brand Voice Bible
- Use hook formulas from Content DNA Framework
- Base caption LENGTH: aim for the per-render-profile TARGET listed below. The TARGET is 20% under the HARD cap — that's your headroom. Word counts are NOT the rule; char counts are. Any caption over the cap will be REJECTED. Treat the target as the real limit and the cap as a safety net. (Per-channel platform-native variants are produced by a downstream Haiku polish step — your job is the base caption.)
- Hashtags: 5-8 per post, NEVER use #momlife or #parenting (mega-tags)
- Emoji: only 👀 🤍 💛, max 1-2 per caption
- No duplicate topics within this batch
- Apply The SMT Test to every hook

## IMPORTANT: Every post MUST include image_prompt and slides

### image_prompt (REQUIRED for ALL posts — OBJECT, not string)

Return image_prompt as an OBJECT shaped like:
{
  "prompt": "Full DALL-E prompt. Describe angle, subject (+ expression if emotional), gesture, environment, light, palette, mood, style. Faces are welcome when the emotion is the point; keep one expressive subject with a full, anatomically correct body (no missing/merged/distorted parts). No stock, no AI-looking.",
  "axes": {
    "shot_type": one of ${JSON.stringify(AXES.shot_type)},
    "lighting": one of ${JSON.stringify(AXES.lighting)},
    "palette": one of ${JSON.stringify(AXES.palette)},
    "subject": one of ${JSON.stringify(AXES.subject)},
    "mood": one of ${JSON.stringify(AXES.mood)},
    "rachel_mode": "rachel_in_frame" if render_profile_slug is "avatar-v1", else "broll"
  }
}

### Rachel location constraint
If axes.rachel_mode is "rachel_in_frame", the scene MUST be one of Rachel's
real locations: kitchen, living_room_couch, car_drivers_seat, bedroom,
bathroom, front_door_porch_walk, school_pickup, grocery_cafe.
If axes.rachel_mode is "broll", ANY scene that supports the content is fine.

### Batch-level diversity (HARD RULE)
Across this batch, NO TWO posts may share the same shot_type + lighting pair.
Maximize variation across all axes. The feed grid must feel visually diverse,
not one repeated photo. Avoid over-using warm_golden_hour + amber_cream.

### Render profile selection (content density rule)
BEFORE picking render_profile_slug, classify the content:
- Core payload words (irreducible message).
- Structure: single_punch | method | list | story | conversation.

Then pick slug:
- payload ≤20 words AND single_punch → static-image
- method or list with ${MIN_CAROUSEL_SLIDES}+ distinct points → moving-images (slideshow) OR carousel (IG-style swipe)
- story with reveal/twist → moving-images
- Rachel-delivered direct-to-camera → avatar-v1 (set avatar_config.format to "full_avatar" or "avatar_visual")

Base caption length caps by render profile — each has a TARGET (write to this) and a HARD cap (over = REJECTED):
${Object.entries(CAPTION_MAX_BY_SLUG).map(([slug, cap]) => `  ${slug}: target ≤${CAPTION_TARGET_BY_SLUG[slug]} chars, hard cap ≤${cap} chars`).join('\n')}

Count characters. Write to the TARGET. The 20% headroom between target and cap exists because
LLMs (you) systematically miscalibrate caption length. If you feel the content needs more room,
pick a longer-cap render profile (carousel target 320) rather than stretching the caption past
its target.

### slides (REQUIRED for slideshow and carousel posts)
JSON array of slide objects. Each slide:
{
  "slide_number": 1,
  "text": "The text shown on this slide",
  "type": "hook" | "content" | "cta",
  "image_prompt": "DALL-E prompt for this specific slide's background, or null for text-on-color slides"
}
Only the hook slide and CTA slide typically need image_prompts. Content slides use brand color backgrounds.

## Output: JSON array of objects (one per opportunity)

Each object:
{
  "render_profile_slug": ${JSON.stringify(ALL_RENDER_PROFILE_SLUGS).replace(/"/g, '"')},
  "channels": array containing one or more of ${JSON.stringify(ALL_CHANNELS)},
  "content_type": "wow" | "trust" | "cta",
  "content_pillar": "ai_magic" | "parenting" | "tech" | "health" | "trending",
  "age_range": "toddler" | "little_kid" | "school_age" | "teen" | "universal",
  "hook": "First thing viewer sees. Stops scroll in 0-2 seconds.",
  "caption": "Base caption. Write to the TARGET for your chosen render_profile_slug. Targets/caps — ${capsSchemaLine()}. Count chars. Over target = retry; over cap = REJECTED.",
  "hashtags": ["#example1", "#example2", "... 5-8 relevant hashtags"],
  "ai_magic_output": "For wow: FULL magic content, min 200 words. Show input AND output for AI Magic. null for trust/cta.",
  "image_prompt": { "prompt": "...faces welcome when emotional; one full anatomically-correct body, no distorted/merged parts; real, not AI-looking...", "axes": { "shot_type": "...", "lighting": "...", "palette": "...", "subject": "...", "mood": "...", "rachel_mode": "rachel_in_frame|broll" } },
  "slides": [{"slide_number": 1, "text": "...", "type": "hook", "image_prompt": "...or null"}],
  "audio_suggestion": "TikTok-channel hint. null otherwise.",
  "source_signal_ids": ["uuid-of-primary-opp"],  // REQUIRED: signal_id(s) of the briefing opportunity/opportunities that ACTUALLY inspired this post. Only include signals that directly informed the content. First element is the primary inspiration.
  "source_indices": [0, 2]  // deprecated fallback: integer indices into briefing.opportunities. Prefer source_signal_ids.
}

**Do NOT emit**: post_format, scheduled_at_ig, scheduled_at_tt, published_at_ig, published_at_tt, published_url_ig, published_url_tt, channel_override. These columns are dropped in v2.0.0. Emitting any of them causes the gate validator (rejectLegacyFormatFields) to hard-fail the row.

Return ONLY the JSON array. No explanation.`;
}
