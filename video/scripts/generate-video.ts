/**
 * SMT Video Generation Pipeline — V6
 *
 * Usage: npx tsx scripts/generate-video.ts <content-id> [--no-tts] [--no-images]
 *
 * Flow:
 *   1. Fetch content from Supabase
 *   2. Parse caption into slides, strip em dashes
 *   3. Generate image scenes via Haiku (hook + slides)
 *   4. Generate DALL-E images, rotate to portrait if needed
 *   5. Generate ONE continuous TTS voiceover (no hook, slides + CTA)
 *   6. Get audio duration, calculate audio-driven slide timing
 *   7. Render MP4 via Remotion with crossfade transitions
 *   8. Upload to Supabase Storage
 */

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import sharp from "sharp";
import { parseFile } from "music-metadata";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "path";
import fs from "fs";

// ---- Config ----

const SUPABASE_URL = process.env.SUPABASE_URL || "https://fvxaykkmzsbrggjgdfjj.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_KEY = process.env.OPENAI_API_KEY!;

const TTS_MODEL = "tts-1";
const TTS_VOICE = "nova";
const DALLE_MODEL = "dall-e-3";
const DALLE_SIZE = "1024x1792" as const;
const FPS = 30;
const HOOK_DURATION = 150; // 5 seconds (Fix 6)
const CTA_DURATION = 120;  // 4 seconds
const CROSSFADE = 9;       // 0.3s overlap (Fix 9)

const args = process.argv.slice(2);
const contentId = args.find(a => !a.startsWith("--"));
const skipTTS = args.includes("--no-tts");
const skipImages = args.includes("--no-images");

if (!contentId) {
  console.error("Usage: npx tsx scripts/generate-video.ts <content-id> [--no-tts] [--no-images]");
  process.exit(1);
}

// ---- Utilities ----

function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

function stripEmDashes(text: string): string {
  return text
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s*--\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/\.\s*,/g, ".")
    .trim();
}

function slideWordCount(slide: SlideData): number {
  return [slide.text, slide.emphasis, slide.subtext]
    .filter(Boolean)
    .reduce((sum, b) => sum + wordCount(b), 0);
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
  if (error || !data) throw new Error(`Content not found: ${id} — ${error?.message}`);
  return data as ContentItem;
}

// ---- Slide Parser ----

interface SlideData {
  text: string;
  emphasis: string;
  subtext: string;
  illustration?: "heart" | "child" | "brain" | "words" | "grow" | "community";
  imageUrl?: string;
}

function parseContentToSlides(content: ContentItem): {
  slides: SlideData[];
  voiceoverScript: string;
} {
  const caption = content.caption || "";
  const paragraphs = caption
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0 && !p.startsWith("#"));

  const slideTexts: string[] = [];

  if (paragraphs.length >= 3 && paragraphs.length <= 6) {
    for (const p of paragraphs) {
      if (p.startsWith("#") || p.length < 20) continue;
      slideTexts.push(p);
    }
  } else if (paragraphs.length > 6) {
    for (let i = 0; i < paragraphs.length - 1; i += 2) {
      const combined = paragraphs[i] + " " + (paragraphs[i + 1] || "");
      if (!combined.startsWith("#") && combined.length > 20) slideTexts.push(combined);
    }
  } else {
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

  const finalTexts = slideTexts.slice(0, 5);
  const illustrations: Array<SlideData["illustration"]> = ["child", "brain", "words", "grow", "heart"];

  const slides: SlideData[] = finalTexts.map((text, i) => {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    if (sentences.length >= 3) {
      return { text: sentences[0].trim(), emphasis: sentences[1].trim(), subtext: sentences.slice(2).join(" ").trim(), illustration: illustrations[i % illustrations.length] };
    } else if (sentences.length === 2) {
      return { text: sentences[0].trim(), emphasis: sentences[1].trim(), subtext: "", illustration: illustrations[i % illustrations.length] };
    } else {
      return { text: "", emphasis: text.trim(), subtext: "", illustration: illustrations[i % illustrations.length] };
    }
  });

  // Strip em dashes from all text (Fix 10)
  for (const slide of slides) {
    slide.text = stripEmDashes(slide.text);
    slide.emphasis = stripEmDashes(slide.emphasis);
    slide.subtext = stripEmDashes(slide.subtext);
  }

  // Voiceover script: slides + CTA only, NO hook (Fix 7)
  const voiceoverScript = stripEmDashes(
    slides.map(s => [s.text, s.emphasis, s.subtext].filter(Boolean).join(" ")).join(". ")
  );

  return { slides, voiceoverScript };
}

// ---- TTS: One Continuous Voiceover (Fix 7) ----

async function generateContinuousVoiceover(
  slides: SlideData[],
  cta: string,
  outDir: string,
  publicDir: string,
  contentId: string,
): Promise<{ audioFile: string; durationSec: number; cost: number }> {
  const openai = new OpenAI({ apiKey: OPENAI_KEY });

  // Build one continuous script: all slide text + CTA
  const slideScript = slides
    .map(s => [s.text, s.emphasis, s.subtext].filter(Boolean).join(". "))
    .join(". ");
  const fullScript = stripEmDashes(slideScript + ". " + cta);

  console.log(`  Generating continuous voiceover (${fullScript.length} chars)...`);

  const response = await openai.audio.speech.create({
    model: TTS_MODEL,
    voice: TTS_VOICE,
    input: fullScript,
    response_format: "mp3",
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  const localPath = path.join(outDir, `voiceover-${contentId}.mp3`);
  fs.writeFileSync(localPath, buffer);
  console.log(`  Voiceover saved: ${(buffer.length / 1024).toFixed(0)} KB`);

  // Copy to public/ for Remotion
  const staticName = `voiceover-${contentId}.mp3`;
  fs.copyFileSync(localPath, path.join(publicDir, staticName));

  // Get audio duration via music-metadata (Fix 8)
  const metadata = await parseFile(localPath);
  const durationSec = metadata.format.duration || 0;
  console.log(`  Audio duration: ${durationSec.toFixed(1)}s`);

  const cost = fullScript.length * 0.000015;
  return { audioFile: staticName, durationSec, cost };
}

// ---- Audio-Driven Slide Timing (Fix 8) ----

function calculateAudioDrivenDurations(
  slides: SlideData[],
  audioDurationSec: number,
): number[] {
  const totalWords = slides.reduce((sum, s) => sum + slideWordCount(s), 0);
  if (totalWords === 0) return slides.map(() => Math.round(8 * FPS));

  return slides.map(slide => {
    const words = slideWordCount(slide);
    const share = words / totalWords;
    const durationSec = share * audioDurationSec + 2.0; // 2s breathing
    const clamped = Math.min(16, Math.max(5, durationSec));
    return Math.round(clamped * FPS);
  });
}

// Fallback timing when no TTS (word-count based)
function calculateFallbackDurations(slides: SlideData[]): number[] {
  return slides.map(slide => {
    const words = slideWordCount(slide);
    const readSec = Math.max(2, words / 3);
    const blocks = [slide.text, slide.emphasis, slide.subtext].filter(Boolean).length;
    const gaps = Math.max(0, blocks - 1) * 1.5;
    const rawSec = gaps + readSec + 3.0 + 1.0;
    return Math.round(Math.min(16, Math.max(5, rawSec)) * FPS);
  });
}

// ---- AI Scene Generator (Fix 3: Hook + Slides) ----

async function generateImageScenes(
  hook: string,
  slides: SlideData[],
): Promise<{ hookScene: string; slideScenes: string[] }> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const fallbackHook = "close-up of small hands on a kitchen highchair tray, crumbs scattered, warm morning light, shot from above";
  const fallbackSlides = slides.map(s => [s.text, s.emphasis, s.subtext].filter(Boolean).join(" ").slice(0, 150));

  if (!anthropicKey) {
    console.log("  No ANTHROPIC_API_KEY, using fallback scenes");
    return { hookScene: fallbackHook, slideScenes: fallbackSlides };
  }

  try {
    console.log("  Generating image scenes via Haiku (hook + slides)...");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        system: `You create visual scene descriptions for AI image generation. Images are PORTRAIT (9:16).

You will receive a hook and slide texts. Return ${slides.length + 1} scenes: the FIRST is for the hook/thumbnail, the rest are for content slides.

CRITICAL RULES:
- The FIRST scene (hook) must be the most intimate, emotionally compelling close-up. This is the thumbnail people see first.
- ABSOLUTELY NO FACES. Never describe faces, expressions, tears, mouths, eyes.
- NEVER use: face, tears, crying, upset, fist, clenching, grabbing, holding tight, clinging
- ALWAYS include a HUMAN ELEMENT: hands, arms in sleeves, backs of heads, small feet, a lap, shoulders from behind
- Focus on the INTERACTION or MOMENT, not just objects in a room
- Every scene should make a mom think "that's my life right now"

GOOD:
- "small hands holding two broken cracker pieces on highchair tray, crumbs scattered, warm morning light, shot from above"
- "woman's hand resting on a small back, both on living room carpet, toy blocks nearby, viewed from behind"
- "close-up of adult lap with picture book open, small fingers pointing at a page, soft blanket"
- "two pairs of hands sorting colorful crayons on kitchen table, shot from directly above"

BAD:
- "kitchen table with alphabet blocks" (no human element)
- "bedroom with stuffed animals" (no moment, empty room)
- Anything mentioning face, tears, crying, expression

One sentence max 30 words each. Always specify camera angle.
Respond with JSON array of ${slides.length + 1} strings. No markdown fences.`,
        messages: [{
          role: "user",
          content: `HOOK: ${hook}\n\nSLIDES:\n${slides.map((s, i) => `${i + 1}. ${[s.text, s.emphasis, s.subtext].filter(Boolean).join(" ")}`).join("\n")}`,
        }],
      }),
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || "";
    const scenes = JSON.parse(text.replace(/```json|```/g, "").trim());
    if (Array.isArray(scenes) && scenes.length >= slides.length + 1) {
      console.log(`  Generated ${scenes.length} scenes (1 hook + ${scenes.length - 1} slides)`);
      return { hookScene: scenes[0], slideScenes: scenes.slice(1, slides.length + 1) };
    }
  } catch (err) {
    console.warn(`  Scene generation failed: ${err}`);
  }

  return { hookScene: fallbackHook, slideScenes: fallbackSlides };
}

// ---- DALL-E Image Generation (Fix 1: orientation check) ----

function sanitizeScene(scene: string): string {
  return scene
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
}

function buildImagePrompt(scene: string): string {
  return [
    "PORTRAIT ORIENTATION vertical photograph (taller than wide, 9:16 aspect ratio).",
    "Intimate close-up lifestyle photograph of a real domestic moment.",
    "Human hands or body parts MUST be visible but NO faces shown.",
    "Shot from behind, above, or over-shoulder angle.",
    "NO TEXT, NO WORDS, NO LETTERS, NO WATERMARKS.",
    "Warm natural indoor lighting, soft golden hour shadows.",
    "35mm film aesthetic, slightly desaturated warm tones, deep purple and mauve pink color grading.",
    `Scene: ${sanitizeScene(scene)}`,
    "Real lived-in home, warm textures, soft fabrics. Shallow depth of field, editorial photography.",
  ].join(" ");
}

async function generateImage(
  scene: string,
  label: string,
  outputPath: string,
): Promise<void> {
  const openai = new OpenAI({ apiKey: OPENAI_KEY });
  const prompt = buildImagePrompt(scene);

  console.log(`  Generating ${label} (~$0.08)...`);
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
  fs.writeFileSync(outputPath, imgBuffer);

  // Fix 1: Check orientation, rotate if landscape
  const meta = await sharp(outputPath).metadata();
  if (meta.width && meta.height && meta.width > meta.height) {
    const rotated = await sharp(outputPath).rotate(90).toBuffer();
    fs.writeFileSync(outputPath, rotated);
    console.log(`    Rotated to portrait: ${meta.width}x${meta.height} → ${meta.height}x${meta.width}`);
  } else {
    console.log(`    Portrait OK: ${meta.width}x${meta.height}`);
  }
}

// ---- Upload to Supabase Storage ----

async function uploadToStorage(localPath: string, storagePath: string): Promise<string> {
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

async function renderVideo(props: Record<string, any>, outputPath: string): Promise<void> {
  console.log("  Bundling Remotion project...");
  const bundled = await bundle({
    entryPoint: path.resolve("src/index.ts"),
    webpackOverride: (config) => config,
  });

  const slideDurations: number[] = props.slideDurations;
  const totalSlideFrames = slideDurations.reduce((a: number, b: number) => a + b, 0);
  const numTransitions = slideDurations.length + 1; // hook→s1, between slides, lastSlide→CTA
  const crossfadeOverlap = numTransitions * CROSSFADE;
  const ctaDuration = props.ctaDuration || CTA_DURATION;
  const totalFrames = HOOK_DURATION + totalSlideFrames + ctaDuration - crossfadeOverlap;

  props.hookDuration = HOOK_DURATION;
  props.ctaDuration = ctaDuration;
  props.crossfade = CROSSFADE;

  console.log(`  Composition: ${totalFrames} frames (${(totalFrames / FPS).toFixed(1)}s), crossfade=${CROSSFADE}fr`);

  const composition = await selectComposition({
    serveUrl: bundled,
    id: "TextSlideshow",
    inputProps: props,
  });
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

async function logCost(contentId: string, service: string, model: string, tokens: number, costUsd: number) {
  await supabase.from("cost_log").insert({
    pipeline_stage: "video_generation",
    content_id: contentId,
    service, model,
    input_tokens: tokens,
    cost_usd: costUsd,
  });
}

// ---- Main Pipeline ----

async function main() {
  console.log(`\n🎬 SMT Video Generator V6`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Content: ${contentId}`);
  console.log(`TTS: ${skipTTS ? "SKIP" : "ON"}  |  Images: ${skipImages ? "SKIP" : "ON"}`);
  console.log(`Hook: ${HOOK_DURATION / FPS}s  |  CTA: ${CTA_DURATION / FPS}s  |  Crossfade: ${CROSSFADE}fr`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // 1. Fetch content
  console.log("1. Fetching content...");
  const content = await fetchContent(contentId!);
  console.log(`   Hook: "${content.hook.slice(0, 60)}..."`);
  console.log(`   Pillar: ${content.content_pillar}  |  Age: ${content.age_range}`);

  // 2. Parse into slides
  console.log("\n2. Parsing slides...");
  const { slides, voiceoverScript } = parseContentToSlides(content);
  console.log(`   ${slides.length} slides  |  ${voiceoverScript.length} chars`);

  // 3. Setup directories
  const outDir = path.resolve("out", contentId!);
  const publicDir = path.resolve("public");
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(publicDir, { recursive: true });

  // 4. Generate images (hook + slides) (Fix 3)
  let hookImageUrl: string | undefined;
  if (!skipImages) {
    console.log("\n3. Generating images...");
    const { hookScene, slideScenes } = await generateImageScenes(content.hook, slides);

    // Hook image (Fix 3)
    try {
      const hookPath = path.join(outDir, "hook.png");
      await generateImage(hookScene, "hook image", hookPath);
      const hookStatic = `hook-${contentId}.png`;
      fs.copyFileSync(hookPath, path.join(publicDir, hookStatic));
      hookImageUrl = hookStatic;
      await logCost(contentId!, "openai", DALLE_MODEL, 0, 0.08);
    } catch (err) {
      console.warn(`   ⚠ Hook image failed: ${err}`);
    }

    // Slide images
    for (let i = 0; i < slides.length; i++) {
      try {
        const imgPath = path.join(outDir, `slide-${i}.png`);
        await generateImage(slideScenes[i], `slide ${i + 1}`, imgPath);
        const staticName = `slide-${contentId}-${i}.png`;
        fs.copyFileSync(imgPath, path.join(publicDir, staticName));
        slides[i].imageUrl = staticName;
        await logCost(contentId!, "openai", DALLE_MODEL, 0, 0.08);
      } catch (err) {
        console.warn(`   ⚠ Slide ${i + 1} image failed: ${err}`);
      }
    }
  }

  // 5. Generate continuous voiceover (Fix 7)
  let audioUrl: string | undefined;
  let audioDurationSec = 0;
  const captionLines = content.caption.split("\n").filter(l => l.trim());
  const ctaText = stripEmDashes(
    captionLines.filter(l => !l.startsWith("#")).pop() || "Follow for more"
  );

  if (!skipTTS) {
    console.log("\n4. Generating continuous voiceover...");
    const tts = await generateContinuousVoiceover(slides, ctaText, outDir, publicDir, contentId!);
    audioUrl = tts.audioFile;
    audioDurationSec = tts.durationSec;
    console.log(`  Cost: ~$${tts.cost.toFixed(4)}`);
    await logCost(contentId!, "openai", TTS_MODEL, 0, tts.cost);
  }

  // 6. Calculate slide durations (Fix 8: audio-driven)
  const slideDurations = audioDurationSec > 0
    ? calculateAudioDrivenDurations(slides, audioDurationSec)
    : calculateFallbackDurations(slides);

  console.log(`\n5. Slide timing${audioDurationSec > 0 ? " (audio-driven)" : " (word-count fallback)"}:`);
  const totalWords = slides.reduce((sum, s) => sum + slideWordCount(s), 0);
  slides.forEach((s, i) => {
    const dur = slideDurations[i];
    const words = slideWordCount(s);
    console.log(`     Slide ${i + 1}: ${(dur / FPS).toFixed(1)}s (${words} words, ${((words / totalWords) * 100).toFixed(0)}% of audio)`);
  });
  const totalSlideSec = slideDurations.reduce((a, b) => a + b, 0) / FPS;
  console.log(`     Total content: ${totalSlideSec.toFixed(1)}s | Audio: ${audioDurationSec.toFixed(1)}s`);

  // 7. Render video
  console.log("\n6. Rendering video...");
  const videoPath = path.join(outDir, `${contentId}.mp4`);
  await renderVideo(
    {
      hook: stripEmDashes(content.hook),
      slides,
      slideDurations,
      cta: ctaText,
      pillar: content.content_pillar || "default",
      hookImageUrl,
      audioUrl,
      ctaDuration: CTA_DURATION,
    },
    videoPath,
  );

  // 8. Upload
  console.log("\n7. Uploading to Supabase Storage...");
  try {
    const publicUrl = await uploadToStorage(videoPath, `videos/${contentId}.mp4`);
    console.log(`   Public URL: ${publicUrl}`);
    await supabase.from("content_queue").update({
      metadata: {
        ...content.metadata,
        video_url: publicUrl,
        video_generated: true,
        video_generated_at: new Date().toISOString(),
      },
    }).eq("id", contentId);
    console.log("   content_queue updated");
  } catch (err) {
    console.warn(`   ⚠ Upload failed: ${videoPath}`);
  }

  // Summary
  const numTransitions = slides.length + 1;
  const totalFrames = HOOK_DURATION + slideDurations.reduce((a, b) => a + b, 0) + CTA_DURATION - numTransitions * CROSSFADE;
  const totalDuration = totalFrames / FPS;
  const imageCount = (hookImageUrl ? 1 : 0) + slides.filter(s => s.imageUrl).length;
  const ttsCost = skipTTS ? 0 : voiceoverScript.length * 0.000015;

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Done!`);
  console.log(`   Video: ${videoPath}`);
  console.log(`   Duration: ${totalDuration.toFixed(1)}s`);
  console.log(`   Slides: ${slides.length} | Images: ${imageCount} | Audio: ${audioDurationSec.toFixed(1)}s`);
  console.log(`   Est. cost: $${(ttsCost + imageCount * 0.08).toFixed(3)}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

main().catch((err) => {
  console.error("❌ Pipeline failed:", err);
  process.exit(1);
});
