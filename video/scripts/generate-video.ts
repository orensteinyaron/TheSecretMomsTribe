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

  // Build voiceover script: hook + all slide text
  const voiceoverScript = [
    content.hook,
    ...slides.map(s => [s.text, s.emphasis, s.subtext].filter(Boolean).join(" ")),
  ].join(". ");

  return { slides, voiceoverScript };
}

// ---- TTS Generation ----

async function generateVoiceover(
  script: string,
  outputPath: string,
): Promise<string> {
  console.log(`  Generating voiceover (${script.length} chars, ~$${(script.length * 0.000015).toFixed(4)})...`);

  const openai = new OpenAI({ apiKey: OPENAI_KEY });

  const response = await openai.audio.speech.create({
    model: TTS_MODEL,
    voice: TTS_VOICE,
    input: script,
    response_format: "mp3",
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);

  console.log(`  Voiceover saved: ${outputPath} (${(buffer.length / 1024).toFixed(0)} KB)`);
  return outputPath;
}

// ---- DALL-E Image Generation ----

async function generateSlideImage(
  slideText: string,
  pillar: string,
  index: number,
  outputDir: string,
): Promise<string> {
  const openai = new OpenAI({ apiKey: OPENAI_KEY });

  // Build prompt that produces warm, editorial, no-text images
  const prompt = [
    "Warm, soft-focus editorial photograph for a parenting content brand.",
    "NO TEXT, NO WORDS, NO LETTERS, NO WATERMARKS anywhere in the image.",
    "Color palette: deep purple (#63246a) and mauve pink (#b74780) tones.",
    "Mood: intimate, warm, emotionally resonant.",
    `Scene context: ${slideText.slice(0, 200)}`,
    "Style: dreamy bokeh, soft natural lighting, shallow depth of field.",
    "Abstract and atmospheric — no identifiable faces.",
    "Think editorial magazine, not stock photo.",
  ].join(" ");

  console.log(`  Generating image ${index + 1} (~$0.08)...`);

  const response = await openai.images.generate({
    model: DALLE_MODEL,
    prompt,
    n: 1,
    size: DALLE_SIZE,
    quality: "standard",
  });

  const imageUrl = response.data[0]?.url;
  if (!imageUrl) throw new Error("DALL-E returned no image URL");

  // Download image
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
  const SLIDE_DURATION = 270;
  const CTA_DURATION = 180;
  const totalFrames = HOOK_DURATION + props.slides.length * SLIDE_DURATION + CTA_DURATION;

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

  // 4. Generate voiceover
  let voiceoverPath: string | undefined;
  if (!skipTTS) {
    console.log("\n3. Generating voiceover...");
    voiceoverPath = path.join(outDir, "voiceover.mp3");
    await generateVoiceover(voiceoverScript, voiceoverPath);
    const cost = voiceoverScript.length * 0.000015;
    await logCost(contentId!, "openai", TTS_MODEL, voiceoverScript.length, cost);
  }

  // 5. Generate background images
  // Images go into public/ so Remotion can serve them via staticFile()
  const publicDir = path.resolve("public");
  fs.mkdirSync(publicDir, { recursive: true });

  if (!skipImages) {
    console.log("\n4. Generating background images...");
    for (let i = 0; i < slides.length; i++) {
      const slideText = [slides[i].text, slides[i].emphasis, slides[i].subtext]
        .filter(Boolean).join(" ");
      try {
        const imgPath = await generateSlideImage(
          slideText,
          content.content_pillar,
          i,
          outDir,
        );
        // Copy to public/ for Remotion's static file serving
        const staticName = `slide-${contentId}-${i}.png`;
        fs.copyFileSync(imgPath, path.join(publicDir, staticName));
        slides[i].imageUrl = staticName;
        await logCost(contentId!, "openai", DALLE_MODEL, 0, 0.08);
      } catch (err) {
        console.warn(`   ⚠ Image ${i + 1} failed, using gradient fallback: ${err}`);
      }
    }
  }

  // 6. Build CTA text
  const captionLines = content.caption.split("\n").filter(l => l.trim());
  const lastLine = captionLines
    .filter(l => !l.startsWith("#"))
    .pop() || "Follow for more 🤍";

  // 7. Render video
  console.log("\n5. Rendering video...");
  const videoPath = path.join(outDir, `${contentId}.mp4`);

  await renderVideo(
    {
      hook: content.hook,
      slides,
      cta: lastLine,
      pillar: content.content_pillar || "default",
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
  console.log(`   Duration: ${((210 + slides.length * 270 + 180) / 30).toFixed(1)}s`);
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
