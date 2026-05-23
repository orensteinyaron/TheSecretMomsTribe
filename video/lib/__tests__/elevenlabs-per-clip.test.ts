import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { generatePerClipMp3s } from "../elevenlabs-per-clip.js";

const workdir = "/tmp/avatar-v5-per-clip-test";

function resetWorkdir() {
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });
}

// Stub generateSpeech impl: writes a tiny placeholder file at the requested
// path and returns the same shape the real one returns.
function fakeGenerateSpeech(text: string, outPath: string) {
  writeFileSync(outPath, Buffer.from([0x49, 0x44, 0x33])); // ID3 magic bytes
  return Promise.resolve({ characterCount: text.length });
}

test("emits one MP3 per clip at workdir/<clip_id>.mp3", async () => {
  resetWorkdir();
  const stub = mock.fn(fakeGenerateSpeech);
  const result = await generatePerClipMp3s({
    clips: [
      { id: "clip-01", expected_script: "Hook line" },
      { id: "clip-02", expected_script: "Body line" },
    ],
    workdir,
    apiKey: "fake-key",
    generateSpeechImpl: stub as unknown as typeof fakeGenerateSpeech,
  });

  assert.equal(result.length, 2);
  assert.equal(result[0].clip_id, "clip-01");
  assert.equal(result[0].mp3_path, path.join(workdir, "clip-01.mp3"));
  assert.equal(result[1].clip_id, "clip-02");
  assert.ok(existsSync(path.join(workdir, "clip-01.mp3")));
  assert.ok(existsSync(path.join(workdir, "clip-02.mp3")));
  assert.equal(stub.mock.callCount(), 2);
});

test("passes expected_script as the TTS text input", async () => {
  resetWorkdir();
  const stub = mock.fn(fakeGenerateSpeech);
  await generatePerClipMp3s({
    clips: [{ id: "c", expected_script: "the exact script we want spoken" }],
    workdir,
    apiKey: "fake-key",
    generateSpeechImpl: stub as unknown as typeof fakeGenerateSpeech,
  });
  assert.equal(stub.mock.calls[0].arguments[0], "the exact script we want spoken");
});

test("returns the script alongside the path", async () => {
  resetWorkdir();
  const result = await generatePerClipMp3s({
    clips: [{ id: "c", expected_script: "the script" }],
    workdir,
    apiKey: "fake-key",
    generateSpeechImpl: fakeGenerateSpeech,
  });
  assert.equal(result[0].script, "the script");
});

test("uses the default Rachel voice id when none provided", async () => {
  resetWorkdir();
  const stub = mock.fn(fakeGenerateSpeech);
  await generatePerClipMp3s({
    clips: [{ id: "c", expected_script: "x" }],
    workdir,
    apiKey: "fake-key",
    generateSpeechImpl: stub as unknown as typeof fakeGenerateSpeech,
  });
  const cfg = stub.mock.calls[0].arguments[2] as { voiceId: string };
  assert.equal(cfg.voiceId, "tRhabdS7JjlQ0lVEImuM"); // RACHEL_ELEVENLABS_VOICE_ID
});

test("propagates ElevenLabs failures with clip context", async () => {
  resetWorkdir();
  const erroringImpl = () => Promise.reject(new Error("ElevenLabs TTS failed (429): rate limit"));
  await assert.rejects(
    () =>
      generatePerClipMp3s({
        clips: [{ id: "clip-99", expected_script: "x" }],
        workdir,
        apiKey: "fake-key",
        generateSpeechImpl: erroringImpl as unknown as typeof fakeGenerateSpeech,
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /clip-99/);
      assert.match(err.message, /429|rate limit/);
      return true;
    },
  );
});

test("throws when apiKey not provided and no env fallback", async () => {
  resetWorkdir();
  const prev = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    await assert.rejects(
      () =>
        generatePerClipMp3s({
          clips: [{ id: "c", expected_script: "x" }],
          workdir,
        }),
      /ELEVENLABS_API_KEY/,
    );
  } finally {
    if (prev !== undefined) process.env.ELEVENLABS_API_KEY = prev;
  }
});

test("falls back to ELEVENLABS_API_KEY env var", async () => {
  resetWorkdir();
  const prev = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = "env-key";
  const stub = mock.fn(fakeGenerateSpeech);
  try {
    await generatePerClipMp3s({
      clips: [{ id: "c", expected_script: "x" }],
      workdir,
      generateSpeechImpl: stub as unknown as typeof fakeGenerateSpeech,
    });
    const cfg = stub.mock.calls[0].arguments[2] as { apiKey: string };
    assert.equal(cfg.apiKey, "env-key");
  } finally {
    if (prev === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = prev;
  }
});
