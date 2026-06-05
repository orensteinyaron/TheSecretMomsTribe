// YAR-144 — avatar_config.voice_id is load-bearing in the v5 renderer.
//
// Before this fix, content gen wrote avatar_config.voice_id but the renderer
// ignored it and always used RACHEL_ELEVENLABS_VOICE_ID — a dead field. This
// test pins the field onto V5State so phaseInit can thread it and phaseTts can
// forward it into generatePerClipMp3s (which falls back to the constant when
// voice_id is undefined).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { initState, loadState, saveState } from "../v5-state.js";

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "v5-voice-"));

const baseOpts = (workdir: string) => ({
  content_id: "c1",
  workdir,
  hook_text: "h.",
  register: "concerned_insider",
  clips: [{ id: "SCENE_01", expected_script: "hi", duration_target_s: 8 }],
  look_id: "look_01",
  location_id: "location_02",
  still_id: "still_abc",
  start_image_url: "https://cdn.example/x.png",
});

test("initState carries voice_id onto V5State when provided", () => {
  const workdir = tmpdir();
  const s = initState({ ...baseOpts(workdir), voice_id: "tRhabdS7JjlQ0lVEImuM" });
  assert.equal(s.voice_id, "tRhabdS7JjlQ0lVEImuM");
});

test("voice_id survives save → load roundtrip", () => {
  const workdir = tmpdir();
  const s = initState({ ...baseOpts(workdir), voice_id: "tRhabdS7JjlQ0lVEImuM" });
  saveState(s);
  assert.equal(loadState(workdir).voice_id, "tRhabdS7JjlQ0lVEImuM");
});

test("voice_id is undefined when not provided (renderer falls back to constant)", () => {
  const workdir = tmpdir();
  const s = initState(baseOpts(workdir));
  assert.equal(s.voice_id, undefined);
});
