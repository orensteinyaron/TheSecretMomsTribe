/**
 * AI-powered slide parser — uses Haiku to split content into
 * structured video slides. Falls back to deterministic parsing.
 * 
 * Cost: ~$0.001 per call (Haiku)
 */

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

interface SlideData {
  text: string;
  emphasis: string;
  subtext: string;
  illustration?: "heart" | "child" | "brain" | "words" | "grow" | "community";
  imageScene?: string;
}

interface ParseResult {
  slides: SlideData[];
  voiceoverScript: string;
}

const SYSTEM_PROMPT = `You are a content strategist for a parenting social media brand called SMT (The Secret Moms Tribe).

Your job: take a post's hook and caption, and break them into 3-5 VIDEO SLIDES for a text-overlay slideshow video.

Each slide has:
- text: the lead-in or context sentence (conversational, light)
- emphasis: the emotional punch line (the line that hits — italic, colored)
- subtext: the supporting thought or follow-up
- imageScene: a one-sentence visual description of a RELATABLE parenting moment for this slide's background image

Rules:
- 3-5 slides MAX. Fewer is better.
- Each slide's duration is calculated dynamically from word count (shorter slides for punchy lines, longer for dense text)
- emphasis should be SHORT and punchy (under 15 words ideally)
- Skip hashtags, skip "save this" CTAs (those go elsewhere)
- The content should flow as a narrative arc: setup → insight → shift → resolution
- Pick an illustration type for each slide from: heart, child, brain, words, grow, community
- NEVER use em dashes (—) or double hyphens (--) in any output. Use commas or periods instead.

imageScene rules:
- Describe a candid moment a mom would recognize from real life
- Real environments: kitchen floor, living room couch, grocery store aisle, car backseat
- Show parent-child connection through body language, NOT faces (hands, backs of heads, over-shoulder)
- Include specific tangible details (broken cracker, toy trucks, school backpack, messy countertop)
- One sentence, max 30 words
- Translate the EMOTION of the slide into a VISIBLE moment

Also output a voiceoverScript: a natural spoken version of the full content, as if a warm friend is reading it aloud. No hashtags, no emojis, no "comment below" — just the story.

Respond ONLY with JSON, no markdown fences:
{
  "slides": [...],
  "voiceoverScript": "..."
}`;

export async function parseWithAI(
  hook: string,
  caption: string,
): Promise<ParseResult | null> {
  if (!ANTHROPIC_KEY) return null;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `HOOK: ${hook}\n\nCAPTION:\n${caption}`,
          },
        ],
      }),
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    if (parsed.slides && Array.isArray(parsed.slides) && parsed.slides.length > 0) {
      console.log(`  AI parser: ${parsed.slides.length} slides, ${parsed.voiceoverScript?.length || 0} char voiceover`);
      return parsed as ParseResult;
    }
  } catch (err) {
    console.warn(`  AI parser failed, falling back to deterministic: ${err}`);
  }

  return null;
}
