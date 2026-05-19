import path from "node:path";

import { generateSpeech as defaultGenerateSpeech } from "./elevenlabs.js";
import type { ElevenLabsConfig } from "./elevenlabs.js";
import { RACHEL_ELEVENLABS_VOICE_ID } from "./avatar-constants.js";

// Per-clip ElevenLabs MP3 generator. Wraps the existing generateSpeech
// helper in a loop over avatar_config.clips[], emitting one MP3 per clip
// at workdir/<clip_id>.mp3. The Seedance audio role expects one MP3 per
// clip (YAR-129 v5 spec) — historically the legacy pipeline produced a
// single MP3 per content_id, which doesn't fit.
//
// Test injection: generateSpeechImpl can be overridden; defaults to the
// real ElevenLabs HTTP call.

export type ClipScriptInput = {
  /** Stable clip identifier from avatar_config.clips[*].id, e.g. "SCENE_01". */
  id: string;
  /** Verbatim script text to send to TTS. */
  expected_script: string;
};

export type PerClipMp3 = {
  clip_id: string;
  mp3_path: string;
  script: string;
};

type GenerateSpeechImpl = (
  text: string,
  outputPath: string,
  config: ElevenLabsConfig,
) => Promise<{ characterCount: number }>;

export type GeneratePerClipMp3sOpts = {
  clips: ClipScriptInput[];
  workdir: string;
  /** Override Rachel voice. */
  voice_id?: string;
  /** Override env var. */
  apiKey?: string;
  /** Injected for tests; production calls the real ElevenLabs HTTP. */
  generateSpeechImpl?: GenerateSpeechImpl;
};

export async function generatePerClipMp3s(opts: GeneratePerClipMp3sOpts): Promise<PerClipMp3[]> {
  const apiKey = opts.apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY env var required (or pass opts.apiKey)");

  const voiceId = opts.voice_id ?? RACHEL_ELEVENLABS_VOICE_ID;
  const impl = opts.generateSpeechImpl ?? defaultGenerateSpeech;
  const config: ElevenLabsConfig = { apiKey, voiceId };

  const out: PerClipMp3[] = [];
  for (const clip of opts.clips) {
    const mp3Path = path.join(opts.workdir, `${clip.id}.mp3`);
    try {
      await impl(clip.expected_script, mp3Path, config);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(`generatePerClipMp3s: clip ${clip.id} failed — ${cause}`);
    }
    out.push({ clip_id: clip.id, mp3_path: mp3Path, script: clip.expected_script });
  }
  return out;
}
