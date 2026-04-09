/**
 * Enriches a raw avatar script with ElevenLabs v3 audio tags
 * using Claude Haiku as an audio director.
 *
 * Input: raw script text (no tags)
 * Output: enriched script with [thoughtful], [sighs], etc. at emotional shift points
 */

import Anthropic from "@anthropic-ai/sdk";
import { logCost } from "../lib/cost-tracker";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are an audio director for a mom talking-to-camera video. Add ElevenLabs v3 audio tags to this script to make it sound natural and emotionally authentic.

Rules:
- Use tags SPARINGLY — max 3-5 tags per 30 seconds of script
- Only use tags at genuine emotional shift points
- Available tags: [thoughtful], [sighs], [softly], [excited], [exhales sharply], [pause], [whispers], [laughs], [nervous], [frustrated]
- Do NOT change any words in the script
- Do NOT add tags at the beginning unless it's a genuine emotional opener
- Preserve all punctuation exactly
- Return ONLY the enriched script text, nothing else`;

export async function enrichScriptWithEmotionTags(
  rawScript: string,
  contentId: string,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[enrich] No ANTHROPIC_API_KEY — returning raw script");
    return rawScript;
  }

  const client = new Anthropic({ apiKey });

  console.log(`[enrich] Enriching script with emotion tags (${rawScript.length} chars)...`);

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Script:\n${rawScript}`,
      },
    ],
  });

  const enriched = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("")
    .trim();

  // Log cost
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  const cost = inputTokens * 0.0000008 + outputTokens * 0.000004; // Haiku pricing
  await logCost(contentId, "anthropic", HAIKU_MODEL, inputTokens, outputTokens, cost);

  // Count tags added
  const tagCount = (enriched.match(/\[[\w\s]+\]/g) || []).length;
  console.log(`[enrich] Added ${tagCount} emotion tags ($${cost.toFixed(4)})`);

  // Validate: enriched must contain all original words
  const rawWords = rawScript.split(/\s+/).filter((w) => w.length > 0);
  const enrichedClean = enriched.replace(/\[[\w\s]+\]\s*/g, "");
  const enrichedWords = enrichedClean.split(/\s+/).filter((w) => w.length > 0);

  if (enrichedWords.length !== rawWords.length) {
    console.warn(`[enrich] Word count mismatch: raw=${rawWords.length} enriched=${enrichedWords.length} — using raw script`);
    return rawScript;
  }

  return enriched;
}
