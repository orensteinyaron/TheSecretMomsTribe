import { test } from "node:test";
import assert from "node:assert/strict";

import type { SeedanceClient } from "../seedance/SeedanceClient.js";
import type { ClipParams } from "../seedance/types.js";
import { SeedanceError } from "../seedance/types.js";
import { FakeSeedanceClient } from "../seedance/fake-client.js";

const baseParams: ClipParams = {
  start_image_url: "https://example.com/rachel.png",
  audio_url: "https://example.com/clip-01.mp3",
  motion_prompt: "Medium close-up, camera locked",
  aspect_ratio: "9:16",
  resolution: "1080p",
  duration_s: 8,
  mode: "std",
};

test("FakeSeedanceClient returns a deterministic ClipResult shape", async () => {
  const client: SeedanceClient = new FakeSeedanceClient();
  const result = await client.generateClip(baseParams);
  assert.match(result.job_id, /^fake-/);
  assert.equal(result.mode_used, "std");
  assert.equal(result.duration_s, 8);
  assert.ok(result.cost_credits > 0);
  assert.ok(result.cost_usd > 0);
  assert.ok(result.video_url.startsWith("https://"));
});

test("FakeSeedanceClient honors the mode parameter", async () => {
  const client = new FakeSeedanceClient();
  const std = await client.generateClip(baseParams);
  const fast = await client.generateClip({ ...baseParams, mode: "fast" });
  assert.equal(std.mode_used, "std");
  assert.equal(fast.mode_used, "fast");
});

test("FakeSeedanceClient uses a configurable fixture video URL", async () => {
  const client = new FakeSeedanceClient({ fixtureVideoUrl: "https://example.com/custom-fixture.mp4" });
  const result = await client.generateClip(baseParams);
  assert.equal(result.video_url, "https://example.com/custom-fixture.mp4");
});

test("FakeSeedanceClient can be configured to simulate hallucinated_audio failure", async () => {
  const client = new FakeSeedanceClient({ simulate: "hallucinated_audio" });
  await assert.rejects(() => client.generateClip(baseParams), (err: unknown) => {
    assert.ok(err instanceof SeedanceError);
    assert.equal(err.kind, "hallucinated_audio");
    return true;
  });
});

test("SeedanceError carries its kind", () => {
  const err = new SeedanceError("transport", "boom");
  assert.equal(err.kind, "transport");
  assert.equal(err.name, "SeedanceError");
  assert.ok(err.message.includes("boom"));
});
