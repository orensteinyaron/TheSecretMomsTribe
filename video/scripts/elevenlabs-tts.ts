import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname, override: true });

import fs from "fs";
import path from "path";
import { parseFile } from "music-metadata";
import { generateSpeech } from "../lib/elevenlabs";
import { logCost } from "../lib/cost-tracker";

const VOICE_ID = "9JqF6OmJtGjHTDODKG2c";
const COST_PER_CHAR = 0.000018;

export interface TTSResult {
  audioFile: string;
  durationSec: number;
  cost: number;
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

  await generateSpeech(script, audioFile, {
    apiKey,
    voiceId: VOICE_ID,
  });

  const meta = await parseFile(audioFile);
  const durationSec = meta.format.duration ?? 0;

  const cost = script.length * COST_PER_CHAR;
  await logCost(contentId, "elevenlabs", "eleven_multilingual_v2", script.length, 0, cost);

  console.log(`[elevenlabs-tts] Done: ${durationSec.toFixed(1)}s, $${cost.toFixed(4)}`);

  return { audioFile, durationSec, cost };
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
