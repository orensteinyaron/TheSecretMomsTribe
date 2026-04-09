import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname, override: true });

import fs from "fs";
import path from "path";
import { parseFile } from "music-metadata";
import { generateSpeech, stripEmotionTags } from "../lib/elevenlabs";
import { logCost } from "../lib/cost-tracker";

const VOICE_ID = "tRhabdS7JjlQ0lVEImuM";
const COST_PER_CHAR = 0.000030; // v3 is slightly more expensive than turbo

export interface TTSResult {
  audioFile: string;
  durationSec: number;
  cost: number;
  /** Script with emotion tags stripped — use for Whisper and captions */
  cleanScript: string;
}

export async function generateAvatarTTS(
  script: string,
  contentId: string,
  outDir: string,
): Promise<TTSResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not set");

  fs.mkdirSync(outDir, { recursive: true });
  const audioFile = path.join(outDir, `avatar-tts-${contentId}.mp3`);

  console.log(`[elevenlabs-tts] Generating speech (${script.length} chars)...`);

  // Send script WITH emotion tags to ElevenLabs v3 (it uses them for expression)
  await generateSpeech(script, audioFile, {
    apiKey,
    voiceId: VOICE_ID,
    // model defaults to eleven_v3
    // stability defaults to 0.5 (Natural mode)
    // NO speed override — let v3 handle pacing naturally
  });

  const meta = await parseFile(audioFile);
  const durationSec = meta.format.duration ?? 0;

  const cost = script.length * COST_PER_CHAR;
  await logCost(contentId, "elevenlabs", "eleven_v3", script.length, 0, cost);

  console.log(`[elevenlabs-tts] Done: ${durationSec.toFixed(1)}s, $${cost.toFixed(4)}`);

  // Strip emotion tags for downstream use (Whisper, captions)
  const cleanScript = stripEmotionTags(script);

  return { audioFile, durationSec, cost, cleanScript };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = process.argv[2];
  if (!text) {
    console.error("Usage: npx tsx scripts/elevenlabs-tts.ts <text>");
    process.exit(1);
  }
  const outDir = path.join(new URL("..", import.meta.url).pathname, "out", "tts-test");
  generateAvatarTTS(text, "test", outDir)
    .then((r) => console.log("Result:", r))
    .catch((e) => { console.error(e); process.exit(1); });
}
