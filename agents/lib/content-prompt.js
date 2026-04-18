/**
 * User-message prompt builder for the content generation agent.
 *
 * Extracted from agents/content.js to enable unit testing of the prompt
 * text (length discipline, schema constraints) without pulling in the
 * whole agent's env-required module initialization.
 *
 * Pure function: takes briefing + context, returns the exact string that
 * gets sent to the LLM. No IO, no mutation of inputs.
 */

import { AXES } from './image-diversity.js';
import { CAPTION_MAX_BY_FORMAT, MIN_CAROUSEL_SLIDES } from './format-selector.js';

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

Pick the best post_format for each opportunity:
- TikTok slideshow (tiktok_slideshow) — best for step-by-step, lists, swaps
- TikTok text-on-screen (tiktok_text) — best for single powerful statements
- IG carousel (ig_carousel) — best for 5-7 slide deep dives
- IG static (ig_static) — best for single powerful quotes/statements
- IG meme (ig_meme) — best for relatable humor

## QUALITY RULES (these still apply to EVERY post)
- Follow ALL voice rules from Brand Voice Bible
- Use hook formulas from Content DNA Framework
- Caption LENGTH is enforced by the per-format char caps listed below under "Caption length caps". Word counts are NOT the rule — char counts are. Any caption over the cap for its post_format will be REJECTED; stay under the char cap for your chosen format.
- Hashtags: 5-8 per post, NEVER use #momlife or #parenting (mega-tags)
- Emoji: only 👀 🤍 💛, max 1-2 per caption
- No duplicate topics within this batch
- Apply The SMT Test to every hook

## IMPORTANT: Every post MUST include image_prompt and slides

### image_prompt (REQUIRED for ALL posts — OBJECT, not string)

Return image_prompt as an OBJECT shaped like:
{
  "prompt": "Full DALL-E prompt. Describe angle, subject, gesture, environment, light, palette, mood, style. NO FACES EVER. No stock, no AI-looking.",
  "axes": {
    "shot_type": one of ${JSON.stringify(AXES.shot_type)},
    "lighting": one of ${JSON.stringify(AXES.lighting)},
    "palette": one of ${JSON.stringify(AXES.palette)},
    "subject": one of ${JSON.stringify(AXES.subject)},
    "mood": one of ${JSON.stringify(AXES.mood)},
    "rachel_mode": "rachel_in_frame" if post_format is tiktok_avatar or tiktok_avatar_visual, else "broll"
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

### Format selection (content density rule)
BEFORE picking post_format, classify the content:
- Core payload words (irreducible message).
- Structure: single_punch | method | list | story | conversation.

Then pick format:
- payload ≤20 words AND single_punch → ig_static (or tiktok_text / ig_meme)
- method or list with ${MIN_CAROUSEL_SLIDES}+ distinct points → ig_carousel (IG) or tiktok_slideshow (TT)
- story with reveal/twist → tiktok_slideshow
- Rachel-delivered direct-to-camera → tiktok_avatar / tiktok_avatar_visual

Caption length caps (HARD — captions over the cap are REJECTED and regenerated):
${Object.entries(CAPTION_MAX_BY_FORMAT).map(([f, n]) => `  ${f}: ≤${n} chars`).join('\n')}

Count characters — this is not a soft target. Picking ig_static then writing a 200-char caption = rejection. If your content needs more room, pick ig_carousel (400 char cap) or tiktok_avatar (150 char cap) instead.

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
  "platform": "tiktok" | "instagram",
  "post_format": "tiktok_slideshow" | "tiktok_text" | "ig_carousel" | "ig_static" | "ig_meme",
  "content_type": "wow" | "trust" | "cta",
  "content_pillar": "ai_magic" | "parenting_insights" | "tech_for_moms" | "mom_health" | "trending",
  "age_range": "toddler" | "little_kid" | "school_age" | "teen" | "universal",
  "hook": "First thing viewer sees. Stops scroll in 0-2 seconds.",
  "caption": "Caption under the cap for your chosen post_format. HARD CAPS: ig_static≤125, ig_carousel≤400, ig_meme≤125, tiktok_slideshow≤100, tiktok_text≤100, tiktok_avatar≤150, tiktok_avatar_visual≤150. Count chars. Going over = REJECTED.",
  "hashtags": ["#example1", "#example2", "... 5-8 relevant hashtags"],
  "ai_magic_output": "For wow: FULL magic content, min 200 words. Show input AND output for AI Magic. null for trust/cta.",
  "image_prompt": { "prompt": "...NO FACES EVER...", "axes": { "shot_type": "...", "lighting": "...", "palette": "...", "subject": "...", "mood": "...", "rachel_mode": "rachel_in_frame|broll" } },
  "slides": [{"slide_number": 1, "text": "...", "type": "hook", "image_prompt": "...or null"}],
  "audio_suggestion": "TikTok only. null for IG.",
  "source_signal_ids": ["uuid-of-primary-opp"],  // REQUIRED: signal_id(s) of the briefing opportunity/opportunities that ACTUALLY inspired this post. Only include signals that directly informed the content. First element is the primary inspiration.
  "source_indices": [0, 2]  // deprecated fallback: integer indices into briefing.opportunities. Prefer source_signal_ids.
}

Return ONLY the JSON array. No explanation.`;
}
