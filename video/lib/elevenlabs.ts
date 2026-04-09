import fs from "fs";

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

export interface ElevenLabsConfig {
  apiKey: string;
  voiceId: string;
  model?: string;
  outputFormat?: string;
  stability?: number; // 0-1. Creative=low, Natural=0.5, Robust=high
  applyTextNormalization?: "auto" | "on" | "off";
}

const DEFAULT_MODEL = "eleven_v3";
const DEFAULT_FORMAT = "mp3_44100_128";

/**
 * Strip emotion/expression tags like [thoughtful], [sighs], [softly] from text.
 * These tags are for ElevenLabs v3 only — must be removed before Whisper/captions.
 */
export function stripEmotionTags(text: string): string {
  return text.replace(/\[[\w\s]+\]\s*/g, "").trim();
}

export async function generateSpeech(
  text: string,
  outputPath: string,
  config: ElevenLabsConfig,
): Promise<{ characterCount: number }> {
  const model = config.model ?? DEFAULT_MODEL;
  const outputFormat = config.outputFormat ?? DEFAULT_FORMAT;

  const requestBody = {
    text,
    model_id: model,
    voice_settings: {
      stability: config.stability ?? 0.5, // Natural mode
      similarity_boost: 0.75,
      style: 0.0,
      use_speaker_boost: true,
    },
    apply_text_normalization: config.applyTextNormalization ?? "on",
  };

  console.log(`[elevenlabs] Request payload:`);
  console.log(JSON.stringify(requestBody, null, 2));

  const resp = await fetch(
    `${ELEVENLABS_BASE}/text-to-speech/${config.voiceId}?output_format=${outputFormat}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
  );

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`ElevenLabs TTS failed (${resp.status}): ${errBody}`);
  }

  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(outputPath, buf);

  return { characterCount: text.length };
}
