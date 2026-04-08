import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { type AvatarClipDef } from "../src/templates/avatar/types";
import { type WhisperWord } from "./audio-pipeline";

export interface AudioSegment {
  clipIndex: number;
  file: string;
  startSec: number;
  endSec: number;
  durationSec: number;
}

export function computeSegmentBoundaries(
  clips: AvatarClipDef[],
  whisperWords: WhisperWord[],
  totalDurationSec: number,
): { startSec: number; endSec: number }[] {
  const boundaries: { startSec: number; endSec: number }[] = [];
  let wordIdx = 0;

  for (const clip of clips) {
    if (clip.type === "broll") {
      const prevEnd = boundaries.length > 0
        ? boundaries[boundaries.length - 1].endSec
        : 0;
      boundaries.push({
        startSec: prevEnd,
        endSec: prevEnd + (clip.duration_estimate || 3),
      });
      continue;
    }

    if (!clip.script) {
      boundaries.push({ startSec: 0, endSec: 0 });
      continue;
    }

    const scriptWords = clip.script
      .split(/\s+/)
      .map((w) => w.toLowerCase().replace(/[^a-z0-9']/g, ""))
      .filter((w) => w.length > 0);

    if (scriptWords.length === 0 || wordIdx >= whisperWords.length) {
      boundaries.push({ startSec: 0, endSec: 0 });
      continue;
    }

    const segStart = whisperWords[wordIdx].start;
    const segEndIdx = Math.min(wordIdx + scriptWords.length - 1, whisperWords.length - 1);
    const segEnd = whisperWords[segEndIdx].end;

    boundaries.push({ startSec: segStart, endSec: segEnd });
    wordIdx = segEndIdx + 1;
  }

  return boundaries;
}

export function splitAudio(
  audioPath: string,
  boundaries: { startSec: number; endSec: number }[],
  clipTypes: string[],
  contentId: string,
  outDir: string,
): AudioSegment[] {
  fs.mkdirSync(outDir, { recursive: true });
  const segments: AudioSegment[] = [];

  for (let i = 0; i < boundaries.length; i++) {
    if (clipTypes[i] === "broll") continue;

    const { startSec, endSec } = boundaries[i];
    if (endSec <= startSec) continue;

    const segFile = path.join(outDir, `segment-${contentId}-${i}.mp3`);
    const duration = endSec - startSec;

    execSync(
      `ffmpeg -y -i "${audioPath}" -ss ${startSec.toFixed(3)} -t ${duration.toFixed(3)} -acodec copy "${segFile}"`,
      { stdio: "pipe", env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` } },
    );

    segments.push({
      clipIndex: i,
      file: segFile,
      startSec,
      endSec,
      durationSec: duration,
    });
  }

  console.log(`[audio-segmenter] Split into ${segments.length} segments`);
  return segments;
}
