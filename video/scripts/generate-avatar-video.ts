import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname, override: true });

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { generateAvatarTTS } from "./elevenlabs-tts";
import { runWhisper } from "./audio-pipeline";
import { computeSegmentBoundaries, splitAudio } from "./audio-segmenter";
import { renderAvatarClip } from "./heygen-studio";
import { type AvatarConfig, type ResolvedClip } from "../src/templates/avatar/types";
import { type PhraseGroup } from "../src/templates/v2/types";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const ROOT_DIR = path.resolve(new URL("..", import.meta.url).pathname);

interface PipelineFlags {
  noTts?: boolean;
  noHeygen?: boolean;
  noImages?: boolean;
  noWhisper?: boolean;
}

async function fetchContent(contentId: string) {
  const { data, error } = await supabase
    .from("content_queue")
    .select("id, hook, caption, content_pillar, avatar_config, metadata")
    .eq("id", contentId)
    .single();

  if (error || !data) throw new Error(`Content ${contentId} not found: ${error?.message}`);
  if (!data.avatar_config) throw new Error(`Content ${contentId} has no avatar_config`);

  return data as {
    id: string;
    hook: string;
    caption: string;
    content_pillar: string;
    avatar_config: AvatarConfig;
    metadata: Record<string, any>;
  };
}

function buildFullScript(avatarConfig: AvatarConfig): string {
  return avatarConfig.clips
    .filter((c) => c.type !== "broll" && c.script)
    .map((c) => c.script!)
    .join(" ");
}

async function uploadAudioSegment(
  filePath: string,
  contentId: string,
  clipIndex: number,
): Promise<string> {
  const fileName = `avatar-audio/${contentId}/segment-${clipIndex}.mp3`;
  const fileBuffer = fs.readFileSync(filePath);

  const { error } = await supabase.storage
    .from("post-images")
    .upload(fileName, fileBuffer, {
      contentType: "audio/mpeg",
      upsert: true,
    });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { data } = supabase.storage.from("post-images").getPublicUrl(fileName);
  return data.publicUrl;
}

async function main() {
  const contentId = process.argv[2];
  if (!contentId) {
    console.error("Usage: npx tsx scripts/generate-avatar-video.ts <content-id> [--no-tts] [--no-heygen] [--no-images] [--no-whisper]");
    process.exit(1);
  }

  const flags: PipelineFlags = {
    noTts: process.argv.includes("--no-tts"),
    noHeygen: process.argv.includes("--no-heygen"),
    noImages: process.argv.includes("--no-images"),
    noWhisper: process.argv.includes("--no-whisper"),
  };

  const outDir = path.join(ROOT_DIR, "out", contentId);
  const publicDir = path.join(ROOT_DIR, "public");
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(publicDir, { recursive: true });

  console.log(`\n=== Avatar Video Pipeline: ${contentId} ===\n`);

  // 1. Fetch content
  const content = await fetchContent(contentId);
  const avatarConfig = content.avatar_config;
  console.log(`[1/7] Content loaded: ${avatarConfig.format}, ${avatarConfig.clips.length} clips`);

  // 2. Generate TTS
  const fullScript = buildFullScript(avatarConfig);
  console.log(`[2/7] TTS script: ${fullScript.length} chars, ${fullScript.split(/\s+/).length} words`);

  let audioFile: string;
  let audioDurationSec: number;

  if (flags.noTts) {
    audioFile = path.join(outDir, `avatar-tts-${contentId}.mp3`);
    if (!fs.existsSync(audioFile)) {
      console.error("--no-tts but no existing audio file found");
      process.exit(1);
    }
    const { parseFile } = await import("music-metadata");
    const meta = await parseFile(audioFile);
    audioDurationSec = meta.format.duration ?? 30;
    console.log(`   Using cached audio: ${audioDurationSec.toFixed(1)}s`);
  } else {
    const ttsResult = await generateAvatarTTS(fullScript, contentId, outDir);
    audioFile = ttsResult.audioFile;
    audioDurationSec = ttsResult.durationSec;
  }

  // 3. Whisper timestamps
  let whisperWords: { word: string; start: number; end: number }[] = [];
  let phraseTimings: PhraseGroup[] = [];

  if (!flags.noWhisper) {
    const whisperResult = await runWhisper(audioFile, contentId, outDir);
    whisperWords = whisperResult.words;
    console.log(`[3/7] Whisper: ${whisperWords.length} words`);
  } else {
    console.log(`[3/7] Whisper: skipped (--no-whisper)`);
  }

  // 4. Segment audio
  const boundaries = computeSegmentBoundaries(
    avatarConfig.clips,
    whisperWords,
    audioDurationSec,
  );

  const segments = (whisperWords.length === 0 || !fs.existsSync(audioFile))
    ? []
    : splitAudio(
        audioFile,
        boundaries,
        avatarConfig.clips.map((c) => c.type),
        contentId,
        outDir,
      );
  console.log(`[4/7] Audio split into ${segments.length} segments`);

  // Build phrase timings from Whisper words
  if (whisperWords.length > 0) {
    // TODO: Use Haiku phrase parser for natural groupings (see parse-slides-v2.ts)
    // Current: simple 4-word chunks. Future: AI-driven phrase boundaries with emphasis markers.
    const MAX_WORDS = 4;
    let i = 0;
    while (i < whisperWords.length) {
      const end = Math.min(i + MAX_WORDS, whisperWords.length);
      const chunk = whisperWords.slice(i, end);
      phraseTimings.push({
        words: chunk.map((w) => w.word).join(" "),
        emphasis: false,
        startTime: chunk[0].start,
        endTime: chunk[chunk.length - 1].end,
      });
      i = end;
    }
  }

  // 5. Render HeyGen clips
  console.log(`[5/7] Rendering ${segments.length} HeyGen clips...`);
  const resolvedClips: ResolvedClip[] = [];

  for (let i = 0; i < avatarConfig.clips.length; i++) {
    const clipDef = avatarConfig.clips[i];
    const boundary = boundaries[i];

    const resolved: ResolvedClip = {
      type: clipDef.type,
      purpose: clipDef.purpose,
      durationSec: boundary.endSec - boundary.startSec,
      startSec: boundary.startSec,
      script: clipDef.script,
    };

    if (clipDef.type === "broll") {
      if (!flags.noImages && clipDef.visual_query) {
        console.log(`   Broll ${i}: Pexels query "${clipDef.visual_query}" (TODO)`);
      }
      resolved.visualType = clipDef.visual_type;
      resolvedClips.push(resolved);
      continue;
    }

    const segment = segments.find((s) => s.clipIndex === i);

    if (segment && !flags.noHeygen) {
      const audioUrl = await uploadAudioSegment(segment.file, contentId, i);

      const clipFile = path.join(outDir, `heygen-clip-${i}.mp4`);
      const result = await renderAvatarClip(
        { audioUrl },
        clipFile,
        contentId,
      );

      const publicClipName = `avatar-clip-${contentId}-${i}.mp4`;
      fs.copyFileSync(clipFile, path.join(publicDir, publicClipName));
      resolved.videoFile = publicClipName;
      resolved.durationSec = result.durationSec || resolved.durationSec;
    } else {
      console.log(`   Clip ${i}: skipped (--no-heygen or no audio segment)`);
    }

    if (clipDef.type === "split" && clipDef.visual_query && !flags.noImages) {
      console.log(`   Split ${i}: Pexels query "${clipDef.visual_query}" (TODO)`);
      resolved.visualType = clipDef.visual_type;
    }

    resolvedClips.push(resolved);
  }

  // 5b. Recalculate timeline from ACTUAL HeyGen durations
  // Stack clips sequentially — each starts where the previous ends.
  // This eliminates gaps (freezes) and ensures sync with master audio.
  let cursor = 0;
  for (const clip of resolvedClips) {
    clip.startSec = cursor;
    cursor += clip.durationSec;
  }
  console.log(`   Timeline recalculated: ${resolvedClips.length} clips, ${cursor.toFixed(1)}s total`);

  // 6. Remotion render
  console.log(`[6/7] Rendering with Remotion...`);

  // Use whichever is longer: clip total or master audio duration
  // HeyGen may trim silence, making clips shorter than the audio
  const totalDurationSec = Math.max(cursor, audioDurationSec);

  // Copy audio to public/ for Remotion
  const publicAudioName = `avatar-tts-${contentId}.mp3`;
  fs.copyFileSync(audioFile, path.join(publicDir, publicAudioName));

  const compositionProps = {
    clips: resolvedClips,
    phraseTimings,
    hookText: content.hook || avatarConfig.clips[0]?.script?.slice(0, 60) || "",
    ctaText: avatarConfig.clips.find((c) => c.purpose === "cta")?.script?.slice(0, 80) || "Follow for more",
    totalDurationSec,
    pillar: content.content_pillar || "parenting_insights",
    audioFile: publicAudioName,
  };

  const bundled = await bundle({
    entryPoint: path.join(ROOT_DIR, "src", "index.ts"),
    webpackOverride: (c) => c,
  });

  const composition = await selectComposition({
    serveUrl: bundled,
    id: "AvatarComposition",
    inputProps: compositionProps,
  });

  const outputFile = path.join(outDir, `${contentId}-avatar.mp4`);
  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: "h264",
    outputLocation: outputFile,
    inputProps: compositionProps,
    crf: 18, // High quality (lower = better, 18 is visually lossless)
  });

  console.log(`[6/7] Rendered: ${outputFile}`);

  // 7. Upload to Supabase
  const videoBuffer = fs.readFileSync(outputFile);
  const storagePath = `videos/${contentId}-avatar.mp4`;

  const { error: uploadError } = await supabase.storage
    .from("post-images")
    .upload(storagePath, videoBuffer, {
      contentType: "video/mp4",
      upsert: true,
    });

  if (uploadError) {
    console.error(`Upload failed: ${uploadError.message}`);
  } else {
    const { data: urlData } = supabase.storage
      .from("post-images")
      .getPublicUrl(storagePath);

    await supabase
      .from("content_queue")
      .update({
        metadata: {
          ...(content.metadata || {}),
          avatar_video_url: urlData.publicUrl,
        },
        render_status: "complete",
      })
      .eq("id", contentId);

    console.log(`[7/7] Uploaded: ${urlData.publicUrl}`);
  }

  console.log(`\n=== Avatar Pipeline Complete ===\n`);
}

main().catch((e) => {
  console.error("Pipeline failed:", e);
  process.exit(1);
});
