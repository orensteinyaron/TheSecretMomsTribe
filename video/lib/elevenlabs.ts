import fs from "fs";

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

export interface ElevenLabsConfig {
  apiKey: string;
  voiceId: string;
  model?: string;
  outputFormat?: string;
  speed?: number; // 0.25-4.0, default 1.0
  applyTextNormalization?: "auto" | "on" | "off";
}

const DEFAULT_MODEL = "eleven_turbo_v2_5";
const DEFAULT_FORMAT = "mp3_44100_128";

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
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.0,
      use_speaker_boost: true,
      speed: config.speed ?? 1.0,
    },
    apply_text_normalization: config.applyTextNormalization ?? "on",
  };

  console.log(`[elevenlabs] Request: model=${model} voice=${config.voiceId} speed=${requestBody.voice_settings.speed} normalization=${requestBody.apply_text_normalization}`);

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
