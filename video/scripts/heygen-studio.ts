import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname, override: true });

import fs from "fs";
import path from "path";
import { logCost } from "../lib/cost-tracker";

const HEYGEN_BASE = "https://api.heygen.com";
const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_ATTEMPTS = 60;

const DEFAULT_AVATAR_ID = "bf01f4fa47a04df48adbf99780abb95b";

export interface HeyGenClipRequest {
  avatarId?: string;
  audioUrl: string;
  backgroundUrl?: string;
  width?: number;
  height?: number;
}

export interface HeyGenClipResult {
  videoId: string;
  videoFile: string;
  durationSec: number;
  credits: number;
}

function getApiKey(): string {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) throw new Error("HEYGEN_API_KEY not set");
  return key;
}

async function submitJob(req: HeyGenClipRequest): Promise<string> {
  const apiKey = getApiKey();

  const body: any = {
    video_inputs: [
      {
        character: {
          type: "avatar",
          avatar_id: req.avatarId ?? DEFAULT_AVATAR_ID,
          avatar_style: "normal",
        },
        voice: {
          type: "audio",
          audio_url: req.audioUrl,
        },
      },
    ],
    dimension: {
      width: req.width ?? 1080,
      height: req.height ?? 1920,
    },
    // Disable HeyGen's built-in captions — Remotion adds its own
    caption: false,
  };

  if (req.backgroundUrl) {
    body.video_inputs[0].background = {
      type: "image",
      url: req.backgroundUrl,
    };
  }

  const resp = await fetch(`${HEYGEN_BASE}/v2/video/generate`, {
    method: "POST",
    headers: {
      "X-Api-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`HeyGen submit failed (${resp.status}): ${errBody}`);
  }

  const data = await resp.json();
  const videoId = data?.data?.video_id;
  if (!videoId) throw new Error(`HeyGen response missing video_id: ${JSON.stringify(data)}`);

  console.log(`[heygen] Job submitted: ${videoId}`);
  return videoId;
}

async function pollForCompletion(
  videoId: string,
): Promise<{ status: string; videoUrl?: string; duration?: number }> {
  const apiKey = getApiKey();

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const resp = await fetch(
      `${HEYGEN_BASE}/v1/video_status.get?video_id=${videoId}`,
      { headers: { "X-Api-Key": apiKey } },
    );

    if (!resp.ok) {
      console.warn(`[heygen] Poll failed (${resp.status}), retrying...`);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const data = await resp.json();
    const status = data?.data?.status;

    if (status === "completed") {
      return {
        status: "completed",
        videoUrl: data.data.video_url,
        duration: data.data.duration,
      };
    }

    if (status === "failed") {
      throw new Error(`HeyGen render failed: ${JSON.stringify(data.data.error)}`);
    }

    console.log(`[heygen] Status: ${status} (attempt ${attempt + 1}/${MAX_POLL_ATTEMPTS})`);
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`HeyGen render timed out after ${MAX_POLL_ATTEMPTS} attempts`);
}

async function downloadVideo(url: string, outputPath: string): Promise<void> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(outputPath, buf);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function renderAvatarClip(
  req: HeyGenClipRequest,
  outputPath: string,
  contentId: string,
): Promise<HeyGenClipResult> {
  const videoId = await submitJob(req);
  const result = await pollForCompletion(videoId);

  if (!result.videoUrl) throw new Error("No video URL in completed result");

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await downloadVideo(result.videoUrl, outputPath);

  // Get EXACT duration from the downloaded file via ffprobe
  const { execSync } = await import("child_process");
  let durationSec = result.duration ?? 0;
  try {
    const probe = execSync(
      `ffprobe -v quiet -print_format json -show_format "${outputPath}"`,
      { encoding: "utf-8", env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` } },
    );
    const probed = JSON.parse(probe);
    const probedDur = parseFloat(probed?.format?.duration);
    if (probedDur > 0) {
      durationSec = probedDur;
      console.log(`[heygen] ffprobe duration: ${durationSec.toFixed(3)}s`);
    }
  } catch (e) {
    console.warn(`[heygen] ffprobe failed, using API duration: ${durationSec}s`);
  }

  const credits = Math.ceil(durationSec / 3);
  await logCost(contentId, "heygen", "avatar-studio", 0, 0, 0);

  console.log(`[heygen] Clip rendered: ${durationSec.toFixed(3)}s, ${credits} credits`);

  return { videoId, videoFile: outputPath, durationSec, credits };
}
