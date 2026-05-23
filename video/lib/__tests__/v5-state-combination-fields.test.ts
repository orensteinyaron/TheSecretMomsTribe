// Verifies that V5State carries the look × location × still combination
// chosen by phaseInit (via pickCombination + Soul-pass-through). These four
// fields are written into v5-state.json so downstream phases (compose, qa)
// can reference the same start_image_url the session passed to Seedance,
// without re-reading content_queue.avatar_config.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { initState, loadState, saveState } from "../v5-state.js";

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "v5-combo-"));

test("initState persists look_id / location_id / still_id / start_image_url onto V5State", () => {
  const workdir = tmpdir();
  const s = initState({
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
  assert.equal(s.look_id, "look_01");
  assert.equal(s.location_id, "location_02");
  assert.equal(s.still_id, "still_abc");
  assert.equal(s.start_image_url, "https://cdn.example/x.png");
});

test("combination fields survive save → load roundtrip", () => {
  const workdir = tmpdir();
  const s = initState({
    content_id: "c2",
    workdir,
    hook_text: "h.",
    register: "concerned_insider",
    clips: [{ id: "SCENE_01", expected_script: "hi", duration_target_s: 8 }],
    look_id: "look_03",
    location_id: "location_05",
    still_id: "still_xyz",
    start_image_url: "https://cdn.example/y.png",
  });
  saveState(s);
  const reloaded = loadState(workdir);
  assert.equal(reloaded.look_id, "look_03");
  assert.equal(reloaded.location_id, "location_05");
  assert.equal(reloaded.still_id, "still_xyz");
  assert.equal(reloaded.start_image_url, "https://cdn.example/y.png");
});
