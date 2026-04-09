import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname, override: true });

import fs from "fs";
import path from "path";
import { parseFile } from "music-metadata";
import { generateSpeech, stripEmotionTags } from "../lib/elevenlabs";
import { logCost } from "../lib/cost-tracker";
import { enrichScriptWithEmotionTags } from "./enrich-emotion-tags";

const VOICE_ID = "tRhabdS7JjlQ0lVEImuM";
const COST_PER_CHAR = 0.000030; // v3 pricing estimate

export interface TTSResult {
  audioFile: string;
  durationSec: number;
  cost: number;
  /** Script with emotion tags stripped — use for Whisper and captions */
  cleanScript: string;
  /** Script with emotion tags — what was sent to ElevenLabs */
  enrichedScript: string;
}

export async function generateAvatarTTS(
  rawScript: string,
  contentId: string,
  outDir: string,
): Promise<TTSResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not set");

  fs.mkdirSync(outDir, { recursive: true });
  const audioFile = path.join(outDir, `avatar-tts-${contentId}.mp3`);

  // Step 1: Enrich raw script with emotion tags via Haiku
  const enrichedScript = await enrichScriptWithEmotionTags(rawScript, contentId);

  console.log(`[elevenlabs-tts] Generating speech (${enrichedScript.length} chars)...`);

  // Step 2: Send enriched script to ElevenLabs v3
  await generateSpeech(enrichedScript, audioFile, {
    apiKey,
    voiceId: VOICE_ID,
    // model: eleven_v3 (default)
    // stability: 0.5 (Natural mode, default)
    // NO speed override — v3 handles pacing naturally
  });

  const meta = await parseFile(audioFile);
  const durationSec = meta.format.duration ?? 0;

  const cost = enrichedScript.length * COST_PER_CHAR;
  await logCost(contentId, "elevenlabs", "eleven_v3", enrichedScript.length, 0, cost);

  console.log(`[elevenlabs-tts] Done: ${durationSec.toFixed(1)}s, $${cost.toFixed(4)}`);

  // Step 3: Strip emotion tags for Whisper and captions
  const cleanScript = stripEmotionTags(enrichedScript);

  return { audioFile, durationSec, cost, cleanScript, enrichedScript };
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const text = process.argv[2];
  if (!text) {
    console.error("Usage: npx tsx scripts/elevenlabs-tts.ts <text>");
    process.exit(1);
  }
  const outDir = path.join(new URL("..", import.meta.url).pathname, "out", "tts-test");
  generateAvatarTTS(text, "test", outDir)
    .then((r) => {
      console.log("Enriched script:", r.enrichedScript);
      console.log("Clean script:", r.cleanScript);
      console.log("Duration:", r.durationSec, "s");
    })
    .catch((e) => { console.error(e); process.exit(1); });
}
