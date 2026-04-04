/**
 * SMT Video Generation Pipeline
 * 
 * Usage: npx tsx scripts/generate-video.ts <content-id> [--no-tts] [--no-images]
 * 
 * Pulls approved content from Supabase, generates:
 *  1. Voiceover via OpenAI TTS ($0.01/video)
 *  2. Background images via DALL-E ($0.04-0.08/image, optional)
 *  3. Rendered MP4 via Remotion
 * 
 * Outputs: video/out/<content-id>.mp4
 * 
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   OPENAI_API_KEY
 */

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "path";
import fs from "fs";

// ---- Config ----

const SUPABASE_URL = process.env.SUPABASE_URL || "https://fvxaykkmzsbrggjgdfjj.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_KEY = process.env.OPENAI_API_KEY!;

const TTS_MODEL = "tts-1";
const TTS_VOICE = "nova"; // warm, female — fits SMT brand
const DALLE_MODEL = "dall-e-3";
const DALLE_SIZE = "1024x1792"; // portrait for 1080x1920

const args = process.argv.slice(2);
const contentId = args.find(a => !a.startsWith("--"));
const skipTTS = args.includes("--no-tts");
const skipImages = args.includes("--no-images");

if (!contentId) {
  console.error("Usage: npx tsx scripts/generate-video.ts <content-id> [--no-tts] [--no-images]");
  process.exit(1);
}

// ---- Slide Timing (matches TextSlideshow.tsx logic) ----

const FPS = 30;

function calcWordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

function calcSlideDuration(slide: { text: string; emphasis: string; subtext: string }): number {
  const blocks = [slide.text, slide.emphasis, slide.subtext].filter(Boolean);
  const blockCount = blocks.length;
  const totalWords = blocks.reduce((sum, b) => sum + calcWordCount(b), 0);
  const readTimeSec = Math.max(2, totalWords / 3);
  const revealGapsSec = Math.max(0, blockCount - 1) * 1.5;

  // FIX 3+4: Calculate minimum duration ensuring last block has 3s breathing + 1s fade
  const textReadSec = slide.text ? Math.max(0.8, calcWordCount(slide.text) / 3) : 0;
  const emphasisReadSec = slide.emphasis ? Math.max(0.8, calcWordCount(slide.emphasis) / 3) : 0;
  const subtextReadSec = slide.subtext ? Math.max(0.8, calcWordCount(slide.subtext) / 3) : 0;

  const subtextDelaySec = 0.4 + textReadSec + 1.5 + emphasisReadSec + (slide.subtext ? 1.5 : 0);
  const lastBlockReadSec = slide.subtext ? subtextReadSec : (slide.emphasis ? emphasisReadSec : textReadSec);
  const lastBlockDelaySec = slide.subtext ? subtextDelaySec : (slide.emphasis ? (0.4 + textReadSec + 1.5) : 0.4);

  const fromTimingMin = lastBlockDelaySec + lastBlockReadSec + 3.0 + 1.0;
  const fromReadingMin = revealGapsSec + readTimeSec + 3.0 + 1.0;
  const rawSec = Math.max(fromTimingMin, fromReadingMin);

  // Clamp 5-16 seconds (raised max for dense slides)
  const clampedSec = Math.min(16, Math.max(5, rawSec));
  return Math.round(clampedSec * FPS);
}

// ---- Text Cleanup (FIX 5: strip em dashes) ----

function stripEmDashes(text: string): string {
  return text
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s*--\s*/g, ", ")
    .replace(/,\s*,/g, ",")  // clean double commas
    .replace(/\.\s*,/g, ".")  // clean period-comma
    .trim();
}

// ---- Supabase ----

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface ContentItem {
  id: string;
  hook: string;
  caption: string;
  content_pillar: string;
  age_range: string;
  post_format: string;
  metadata: Record<string, any>;
}

async function fetchContent(id: string): Promise<ContentItem> {
  const { data, error } = await supabase
    .from("content_queue")
    .select("id, hook, caption, content_pillar, age_range, post_format, metadata")
    .eq("id", id)
    .single();

  if (error || !data) {
    throw new Error(`Content not found: ${id} — ${error?.message}`);
  }
  return data as ContentItem;
}

// ---- Slide Parser ----
// Breaks a long caption into structured slides for the video template

interface SlideData {
  text: string;
  emphasis: string;
  subtext: string;
  illustration?: "heart" | "child" | "brain" | "words" | "grow" | "community";
  imageScene?: string;  // one-sentence visual description for DALL-E
  imageUrl?: string;
}

function parseContentToSlides(content: ContentItem): {
  slides: SlideData[];
  voiceoverScript: string;
} {
  // Use Claude to parse — but for now, deterministic paragraph splitting
  const caption = content.caption || "";
  
  // Split on double newlines, then group into slides
  const paragraphs = caption
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0 && !p.startsWith("#")); // skip hashtag blocks

  // If caption is already structured (3-5 paragraphs), map directly
  // Otherwise, chunk into ~3-4 slides
  const slideTexts: string[] = [];
  
  if (paragraphs.length >= 3 && paragraphs.length <= 6) {
    // Good structure — use paragraphs as-is
    for (const p of paragraphs) {
      if (p.startsWith("#") || p.length < 20) continue;
      slideTexts.push(p);
    }
  } else if (paragraphs.length > 6) {
    // Too many — combine pairs
    for (let i = 0; i < paragraphs.length - 1; i += 2) {
      const combined = paragraphs[i] + " " + (paragraphs[i + 1] || "");
      if (!combined.startsWith("#") && combined.length > 20) {
        slideTexts.push(combined);
      }
    }
  } else {
    // Too few — split long ones by sentences
    for (const p of paragraphs) {
      const sentences = p.match(/[^.!?]+[.!?]+/g) || [p];
      if (sentences.length > 3) {
        const mid = Math.ceil(sentences.length / 2);
        slideTexts.push(sentences.slice(0, mid).join(" ").trim());
        slideTexts.push(sentences.slice(mid).join(" ").trim());
      } else {
        slideTexts.push(p);
      }
    }
  }

  // Cap at 5 slides
  const finalTexts = slideTexts.slice(0, 5);

  // Convert to slide format — first sentence as text, key phrase as emphasis, rest as subtext
  const illustrations: Array<SlideData["illustration"]> = [
    "child", "brain", "words", "grow", "heart",
  ];

  const slides: SlideData[] = finalTexts.map((text, i) => {
    // Try to split into text/emphasis/subtext
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    
    if (sentences.length >= 3) {
      return {
        text: sentences[0].trim(),
        emphasis: sentences[1].trim(),
        subtext: sentences.slice(2).join(" ").trim(),
        illustration: illustrations[i % illustrations.length],
      };
    } else if (sentences.length === 2) {
      return {
        text: sentences[0].trim(),
        emphasis: sentences[1].trim(),
        subtext: "",
        illustration: illustrations[i % illustrations.length],
      };
    } else {
      // Single sentence — put it all in emphasis
      return {
        text: "",
        emphasis: text.trim(),
        subtext: "",
        illustration: illustrations[i % illustrations.length],
      };
    }
  });

  // FIX 5: Strip em dashes from all slide text
  for (const slide of slides) {
    slide.text = stripEmDashes(slide.text);
    slide.emphasis = stripEmDashes(slide.emphasis);
    slide.subtext = stripEmDashes(slide.subtext);
  }

  // Build voiceover script: hook + all slide text
  const voiceoverScript = stripEmDashes([
    content.hook,
    ...slides.map(s => [s.text, s.emphasis, s.subtext].filter(Boolean).join(" ")),
  ].join(". "));

  return { slides, voiceoverScript };
}

// ---- TTS Generation (FIX 6: per-slide TTS for sync) ----

async function generateTTSSegment(
  text: string,
  outputPath: string,
  label: string,
): Promise<string> {
  const openai = new OpenAI({ apiKey: OPENAI_KEY });

  const response = await openai.audio.speech.create({
    model: TTS_MODEL,
    voice: TTS_VOICE,
    input: text,
    response_format: "mp3",
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);

  console.log(`    ${label}: ${(buffer.length / 1024).toFixed(0)} KB (${text.length} chars)`);
  return outputPath;
}

async function generatePerSlideTTS(
  hook: string,
  slides: SlideData[],
  cta: string,
  outDir: string,
  publicDir: string,
  contentId: string,
): Promise<{ hookAudio: string; slideAudios: string[]; ctaAudio: string; totalCost: number }> {
  const segments: { text: string; label: string; filename: string }[] = [];

  // Hook
  segments.push({ text: stripEmDashes(hook), label: "Hook", filename: `tts-${contentId}-hook.mp3` });

  // Each slide
  for (let i = 0; i < slides.length; i++) {
    const slideText = [slides[i].text, slides[i].emphasis, slides[i].subtext]
      .filter(Boolean).join(". ");
    segments.push({ text: slideText, label: `Slide ${i + 1}`, filename: `tts-${contentId}-slide${i}.mp3` });
  }

  // CTA
  segments.push({ text: stripEmDashes(cta), label: "CTA", filename: `tts-${contentId}-cta.mp3` });

  let totalChars = 0;
  const paths: string[] = [];

  for (const seg of segments) {
    const localPath = path.join(outDir, seg.filename);
    await generateTTSSegment(seg.text, localPath, seg.label);
    // Copy to public/ for Remotion
    fs.copyFileSync(localPath, path.join(publicDir, seg.filename));
    paths.push(seg.filename);
    totalChars += seg.text.length;
  }

  const totalCost = totalChars * 0.000015;
  return {
    hookAudio: paths[0],
    slideAudios: paths.slice(1, 1 + slides.length),
    ctaAudio: paths[paths.length - 1],
    totalCost,
  };
}

// ---- AI Scene Generator ----
// Translates slide content into a relatable parenting scene description for DALL-E

async function generateImageScenes(
  hook: string,
  slides: SlideData[],
): Promise<string[]> {
  // If slides already have imageScene from AI parser, use those
  const existing = slides.map(s => s.imageScene).filter(Boolean);
  if (existing.length === slides.length) return existing as string[];

  // Generate via Haiku
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.log("  No ANTHROPIC_API_KEY — using slide text as scene fallback");
    return slides.map(s => [s.text, s.emphasis, s.subtext].filter(Boolean).join(" ").slice(0, 150));
  }

  try {
    console.log("  Generating image scenes via Haiku...");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        system: `You translate parenting content into visual scene descriptions for AI image generation. Images are PORTRAIT format (tall, 9:16).

CRITICAL RULES:
- ABSOLUTELY NO FACES. Never describe faces, expressions, tears, mouths, eyes, or emotions on a face.
- NEVER use words: face, tears, crying, upset, fist, clenching, grabbing, holding tight, clinging
- Only describe: HANDS (open, resting, touching objects), BACKS OF HEADS, FEET, LAPS, ARMS IN SLEEVES, SHOULDERS FROM BEHIND
- Every scene must have a human body part BUT only from behind, above, or extreme close-up on hands/feet

GOOD EXAMPLES (follow these exactly):
- "small hands holding two pieces of a broken cracker on a highchair tray, crumbs scattered, warm morning light from kitchen window, shot from above"
- "woman's hand resting gently on a small back, both seated on living room carpet, toy blocks nearby, viewed from behind"
- "over-shoulder view of adult looking down at small feet in mismatched socks on a bathroom step stool"
- "close-up of adult lap with picture book open, small fingers pointing at a page, soft blanket draped over legs"
- "two pairs of hands, one adult one small, sorting colorful crayons on a kitchen table, shot from directly above"

BAD (will be rejected by image AI):
- Anything mentioning face, tears, crying, upset expression, mouth
- "toddler sitting on parent's lap" (too direct, triggers filters)
- "child's face" / "adult's face" (NO FACES EVER)

One sentence max 30 words. Always specify "shot from above" or "viewed from behind" or "close-up of hands".

Respond with JSON array of strings, one per slide. No markdown fences.`,
        messages: [{
          role: "user",
          content: `POST TOPIC: ${hook}\n\nSLIDES:\n${slides.map((s, i) => `${i + 1}. ${[s.text, s.emphasis, s.subtext].filter(Boolean).join(" ")}`).join("\n")}`,
        }],
      }),
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || "";
    const scenes = JSON.parse(text.replace(/```json|```/g, "").trim());
    if (Array.isArray(scenes) && scenes.length >= slides.length) {
      console.log(`  Generated ${scenes.length} scene descriptions`);
      return scenes.slice(0, slides.length);
    }
  } catch (err) {
    console.warn(`  Scene generation failed, using fallback: ${err}`);
  }

  // Fallback: use slide text
  return slides.map(s => [s.text, s.emphasis, s.subtext].filter(Boolean).join(" ").slice(0, 150));
}

// ---- DALL-E Image Generation ----

function buildImagePrompt(scene: string): string {
  // Sanitize scene to reduce DALL-E content filter triggers
  const sanitized = scene
    .replace(/\bchild('?s)?\b/gi, "small person's")
    .replace(/\bkid('?s)?\b/gi, "small person's")
    .replace(/\btoddler('?s)?\b/gi, "tiny person's")
    .replace(/\bbaby('?s)?\b/gi, "small person's")
    .replace(/\bson('?s)?\b/gi, "person's")
    .replace(/\bdaughter('?s)?\b/gi, "person's")
    .replace(/\b5-year-old('?s)?\b/gi, "small person's")
    .replace(/\b(grabbing|holding onto|clutching|hugging|clinging|clenching)\b/gi, "near")
    .replace(/\b(meltdown|tantrum|crying|screaming|sobbing|tears|upset|distress)\b/gi, "quiet moment")
    .replace(/\b(face|faces|facial|expression|mouth|eyes|tear-streaked)\b/gi, "")
    .replace(/\b(parent|mother|father|mom|dad)\b/gi, "adult")
    .replace(/\bfist\b/gi, "hand")
    .replace(/\bwrapped around\b/gi, "near")
    .replace(/\bnestled against\b/gi, "beside")
    .replace(/\bat eye-level with\b/gi, "near")
    .replace(/\s{2,}/g, " ")
    .trim();

  return [
    "PORTRAIT ORIENTATION vertical photograph (taller than wide, 9:16 aspect ratio).",
    "Intimate close-up lifestyle photograph of a real domestic moment.",
    "Human hands or body parts MUST be visible but NO faces shown.",
    "Shot from behind, above, or over-shoulder angle.",
    "NO TEXT, NO WORDS, NO LETTERS, NO WATERMARKS.",
    "Warm natural indoor lighting, soft golden hour shadows.",
    "35mm film aesthetic, slightly desaturated warm tones, deep purple and mauve pink color grading.",
    `Scene: ${sanitized}`,
    "Real lived-in home, warm textures, soft fabrics. Shallow depth of field, editorial photography.",
  ].join(" ");
}

async function generateSlideImage(
  scene: string,
  index: number,
  outputDir: string,
): Promise<string> {
  const openai = new OpenAI({ apiKey: OPENAI_KEY });
  const prompt = buildImagePrompt(scene);

  console.log(`  Generating image ${index + 1} (~$0.08)...`);
  console.log(`    Scene: "${scene.slice(0, 80)}..."`);

  const response = await openai.images.generate({
    model: DALLE_MODEL,
    prompt,
    n: 1,
    size: DALLE_SIZE,
    quality: "standard",
  });

  const imageUrl = response.data[0]?.url;
  if (!imageUrl) throw new Error("DALL-E returned no image URL");

  const imgResponse = await fetch(imageUrl);
  const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
  const outputPath = path.join(outputDir, `slide-${index}.png`);
  fs.writeFileSync(outputPath, imgBuffer);

  console.log(`  Image saved: ${outputPath}`);
  return outputPath;
}

// ---- Upload to Supabase Storage ----

async function uploadToStorage(
  localPath: string,
  storagePath: string,
): Promise<string> {
  const fileBuffer = fs.readFileSync(localPath);
  const { error } = await supabase.storage
    .from("post-images")
    .upload(storagePath, fileBuffer, {
      contentType: localPath.endsWith(".mp4") ? "video/mp4" : "image/png",
      upsert: true,
    });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { data } = supabase.storage.from("post-images").getPublicUrl(storagePath);
  return data.publicUrl;
}

// ---- Remotion Render ----

async function renderVideo(
  props: Record<string, any>,
  outputPath: string,
): Promise<void> {
  console.log("  Bundling Remotion project...");

  const bundled = await bundle({
    entryPoint: path.resolve("src/index.ts"),
    webpackOverride: (config) => config,
  });

  const HOOK_DURATION = 210;
  const CTA_DURATION = 180;
  const slideDurations: number[] = props.slideDurations || props.slides.map(calcSlideDuration);
  const totalSlideFrames = slideDurations.reduce((a: number, b: number) => a + b, 0);
  const totalFrames = HOOK_DURATION + totalSlideFrames + CTA_DURATION;
  // Ensure slideDurations is passed to the composition
  props.slideDurations = slideDurations;

  console.log(`  Selecting composition (${totalFrames} frames, ${(totalFrames / 30).toFixed(1)}s)...`);

  const composition = await selectComposition({
    serveUrl: bundled,
    id: "TextSlideshow",
    inputProps: props,
  });

  // Override duration based on actual slide count
  composition.durationInFrames = totalFrames;

  console.log("  Rendering video...");

  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: "h264",
    outputLocation: outputPath,
    inputProps: props,
  });

  const stats = fs.statSync(outputPath);
  console.log(`  Video rendered: ${outputPath} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
}

// ---- Cost Logging ----

async function logCost(
  contentId: string,
  service: string,
  model: string,
  inputTokens: number,
  costUsd: number,
) {
  await supabase.from("cost_log").insert({
    pipeline_stage: "video_generation",
    content_id: contentId,
    service,
    model,
    input_tokens: inputTokens,
    cost_usd: costUsd,
  });
}

// ---- Main Pipeline ----

async function main() {
  console.log(`\n🎬 SMT Video Generator`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Content ID: ${contentId}`);
  console.log(`TTS: ${skipTTS ? "SKIP" : "ON"}  |  Images: ${skipImages ? "SKIP" : "ON"}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // 1. Fetch content
  console.log("1. Fetching content...");
  const content = await fetchContent(contentId!);
  console.log(`   Hook: "${content.hook.slice(0, 60)}..."`);
  console.log(`   Pillar: ${content.content_pillar}  |  Age: ${content.age_range}`);

  // 2. Parse into slides
  console.log("\n2. Parsing content into slides...");
  const { slides, voiceoverScript } = parseContentToSlides(content);
  console.log(`   ${slides.length} slides  |  ${voiceoverScript.length} chars voiceover`);

  // 3. Create output directory
  const outDir = path.resolve("out", contentId!);
  fs.mkdirSync(outDir, { recursive: true });

  // 4. Generate per-slide TTS voiceover (FIX 6)
  const publicDir = path.resolve("public");
  fs.mkdirSync(publicDir, { recursive: true });

  let hookAudioUrl: string | undefined;
  let ctaAudioUrl: string | undefined;

  // Build CTA text early so we can TTS it
  const captionLines = content.caption.split("\n").filter(l => l.trim());
  const ctaText = stripEmDashes(
    captionLines.filter(l => !l.startsWith("#")).pop() || "Follow for more"
  );

  if (!skipTTS) {
    console.log("\n3. Generating per-slide TTS...");
    const tts = await generatePerSlideTTS(
      content.hook, slides, ctaText, outDir, publicDir, contentId!,
    );
    hookAudioUrl = tts.hookAudio;
    ctaAudioUrl = tts.ctaAudio;
    for (let i = 0; i < slides.length; i++) {
      slides[i].audioUrl = tts.slideAudios[i];
    }
    console.log(`  Total TTS cost: ~$${tts.totalCost.toFixed(4)}`);
    await logCost(contentId!, "openai", TTS_MODEL, 0, tts.totalCost);
  }

  // 5. Generate background images

  if (!skipImages) {
    console.log("\n4. Generating background images...");

    // Step 1: Generate relatable scene descriptions via Haiku
    const scenes = await generateImageScenes(content.hook, slides);

    // Step 2: Generate DALL-E images from scene descriptions
    for (let i = 0; i < slides.length; i++) {
      try {
        const imgPath = await generateSlideImage(
          scenes[i],
          i,
          outDir,
        );
        const staticName = `slide-${contentId}-${i}.png`;
        fs.copyFileSync(imgPath, path.join(publicDir, staticName));
        slides[i].imageUrl = staticName;
        await logCost(contentId!, "openai", DALLE_MODEL, 0, 0.08);
      } catch (err) {
        console.warn(`   ⚠ Image ${i + 1} failed, using gradient fallback: ${err}`);
      }
    }
  }

  // 6. Calculate dynamic slide durations
  const slideDurations = slides.map(calcSlideDuration);
  console.log(`\n   Slide timing (dynamic):`);
  slides.forEach((s, i) => {
    const dur = slideDurations[i];
    const blocks = [s.text, s.emphasis, s.subtext].filter(Boolean).length;
    const words = [s.text, s.emphasis, s.subtext].filter(Boolean).join(" ").split(/\s+/).length;
    console.log(`     Slide ${i + 1}: ${(dur / 30).toFixed(1)}s (${words} words, ${blocks} blocks)`);
  });
  const totalSlideSec = slideDurations.reduce((a, b) => a + b, 0) / 30;
  console.log(`     Total slides: ${totalSlideSec.toFixed(1)}s (was ${(slides.length * 9).toFixed(1)}s fixed)`);

  // 8. Render video
  console.log("\n5. Rendering video...");
  const videoPath = path.join(outDir, `${contentId}.mp4`);

  await renderVideo(
    {
      hook: stripEmDashes(content.hook),
      slides,
      slideDurations,
      cta: ctaText,
      pillar: content.content_pillar || "default",
      hookAudioUrl,
      ctaAudioUrl,
    },
    videoPath,
  );

  // 8. Upload to Supabase Storage
  console.log("\n6. Uploading to Supabase Storage...");
  try {
    const publicUrl = await uploadToStorage(
      videoPath,
      `videos/${contentId}.mp4`,
    );
    console.log(`   Public URL: ${publicUrl}`);

    // Update content_queue with video URL
    await supabase
      .from("content_queue")
      .update({
        metadata: {
          ...content.metadata,
          video_url: publicUrl,
          video_generated: true,
          video_generated_at: new Date().toISOString(),
        },
      })
      .eq("id", contentId);

    console.log("   content_queue updated with video URL");
  } catch (err) {
    console.warn(`   ⚠ Upload failed, video available locally: ${videoPath}`);
  }

  // Summary
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Done!`);
  console.log(`   Video: ${videoPath}`);
  const totalDuration = (210 + slideDurations.reduce((a, b) => a + b, 0) + 180) / 30;
  console.log(`   Duration: ${totalDuration.toFixed(1)}s (was ${((210 + slides.length * 270 + 180) / 30).toFixed(1)}s fixed)`);
  console.log(`   Slides: ${slides.length}`);
  const totalCost = (skipTTS ? 0 : voiceoverScript.length * 0.000015) +
    (skipImages ? 0 : slides.length * 0.08);
  console.log(`   Est. cost: $${totalCost.toFixed(3)}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

main().catch((err) => {
  console.error("❌ Pipeline failed:", err);
  process.exit(1);
});
