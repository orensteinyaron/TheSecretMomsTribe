// YAR-145 L1: the v5 renderer's upload phase closes the render lifecycle by
// writing EXACTLY three columns (render_status / final_asset_url /
// render_completed_at). These tests guard both the shape of that patch and the
// DB-flip-on-approval invariant: the patch must NEVER carry render_profile_id,
// metadata.video_url, or status (those flip only on human approval).

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRenderLifecyclePatch } from "../render-lifecycle-patch.js";

test("buildRenderLifecyclePatch returns exactly the three render-lifecycle columns", () => {
  const patch = buildRenderLifecyclePatch(
    "https://x/final.mp4",
    "2026-06-05T00:00:00.000Z",
  );
  assert.deepEqual(patch, {
    render_status: "complete",
    final_asset_url: "https://x/final.mp4",
    render_completed_at: "2026-06-05T00:00:00.000Z",
  });
});

test("buildRenderLifecyclePatch contains exactly 3 keys and none of the approval-gated keys", () => {
  const patch = buildRenderLifecyclePatch(
    "https://x/final.mp4",
    "2026-06-05T00:00:00.000Z",
  );
  const keys = Object.keys(patch);
  assert.equal(keys.length, 3, `expected exactly 3 keys, got ${keys.join(", ")}`);
  for (const forbidden of ["render_profile_id", "metadata", "video_url", "status"]) {
    assert.ok(
      !keys.includes(forbidden),
      `lifecycle patch must not include approval-gated key "${forbidden}"`,
    );
  }
});
