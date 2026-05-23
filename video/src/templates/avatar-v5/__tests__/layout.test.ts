import { test } from "node:test";
import assert from "node:assert/strict";

import { layoutClips } from "../AvatarV5Composition";
import { AUDIO_BRIDGE_FRAMES, MOTION_BLUR_FRAMES, type AvatarV5Props } from "../types";

const FPS = 30;

function fakeClip(id: string, durationS: number) {
  return { id, video_url: `https://example.com/${id}.mp4`, duration_s: durationS, crop_offset_y: 0 };
}

test("single-clip layout starts at frame 0 with no bridge", () => {
  const props: AvatarV5Props = {
    clips: [fakeClip("c0", 8)],
    transitions: [],
    hook_primary: "x",
  };
  const { entries, total_duration_in_frames } = layoutClips(props, FPS);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].from_frame, 0);
  assert.equal(entries[0].duration_in_frames, 240);
  assert.equal(total_duration_in_frames, 240);
});

test("two clips overlap by AUDIO_BRIDGE_FRAMES at the cut", () => {
  const props: AvatarV5Props = {
    clips: [fakeClip("c0", 8), fakeClip("c1", 8)],
    transitions: [{ cut_index: 0, needs_motion_blur: false }],
    hook_primary: "x",
  };
  const { entries, total_duration_in_frames } = layoutClips(props, FPS);
  assert.equal(entries[0].from_frame, 0);
  assert.equal(entries[0].duration_in_frames, 240);
  // clip[1] starts 4 frames before clip[0]'s end (240 - 4 = 236)
  assert.equal(entries[1].from_frame, 236);
  assert.equal(entries[1].duration_in_frames, 240);
  // Total: 236 + 240 = 476 = 8s + 8s - 4 frames (one bridge)
  assert.equal(total_duration_in_frames, 476);
  assert.equal(total_duration_in_frames, 8 * FPS * 2 - AUDIO_BRIDGE_FRAMES);
});

test("six clips shorten total by 5 * AUDIO_BRIDGE_FRAMES", () => {
  const props: AvatarV5Props = {
    clips: Array.from({ length: 6 }, (_, i) => fakeClip(`c${i}`, 8)),
    transitions: Array.from({ length: 5 }, (_, i) => ({ cut_index: i, needs_motion_blur: false })),
    hook_primary: "",
  };
  const { total_duration_in_frames } = layoutClips(props, FPS);
  assert.equal(total_duration_in_frames, 6 * 8 * FPS - 5 * AUDIO_BRIDGE_FRAMES);
});

test("motion_blur flag propagates to both adjacent clips' blur_in/out", () => {
  const props: AvatarV5Props = {
    clips: [fakeClip("c0", 8), fakeClip("c1", 8), fakeClip("c2", 8)],
    transitions: [
      { cut_index: 0, needs_motion_blur: true },
      { cut_index: 1, needs_motion_blur: false },
    ],
    hook_primary: "",
  };
  const { entries } = layoutClips(props, FPS);
  // Cut 0 needs blur → c0.blur_out + c1.blur_in are set.
  assert.equal(entries[0].blur_out_frames, MOTION_BLUR_FRAMES);
  assert.equal(entries[1].blur_in_frames, MOTION_BLUR_FRAMES);
  // Cut 1 does NOT need blur → c1.blur_out + c2.blur_in stay 0.
  assert.equal(entries[1].blur_out_frames, 0);
  assert.equal(entries[2].blur_in_frames, 0);
});

test("first clip has no incoming blur even if asked (no cut before it)", () => {
  const props: AvatarV5Props = {
    clips: [fakeClip("c0", 8), fakeClip("c1", 8)],
    transitions: [{ cut_index: 0, needs_motion_blur: true }],
    hook_primary: "",
  };
  const { entries } = layoutClips(props, FPS);
  assert.equal(entries[0].blur_in_frames, 0);
});

test("last clip has no outgoing blur even if final transition asks (defensive)", () => {
  // transitions[i] applies between clip[i] and clip[i+1]; a transition
  // with index = clips.length - 1 has no clip after it.
  const props: AvatarV5Props = {
    clips: [fakeClip("c0", 8), fakeClip("c1", 8)],
    transitions: [
      { cut_index: 0, needs_motion_blur: false },
      { cut_index: 1, needs_motion_blur: true }, // invalid — no clip after c1
    ],
    hook_primary: "",
  };
  const { entries } = layoutClips(props, FPS);
  // c1.blur_out is set (transitions[1] flagged), but there's no c2 to receive
  // blur_in. We don't crash; we just no-op on the missing clip.
  assert.equal(entries[1].blur_out_frames, MOTION_BLUR_FRAMES);
  assert.equal(entries.length, 2);
});

test("durations rounded to whole frames, minimum 1 frame", () => {
  const props: AvatarV5Props = {
    clips: [fakeClip("micro", 0.01)], // 0.3 frame → clamp to 1
    transitions: [],
    hook_primary: "",
  };
  const { entries } = layoutClips(props, FPS);
  assert.equal(entries[0].duration_in_frames, 1);
});

test("layout is empty for empty clips", () => {
  const props: AvatarV5Props = { clips: [], transitions: [], hook_primary: "" };
  const { entries, total_duration_in_frames } = layoutClips(props, FPS);
  assert.equal(entries.length, 0);
  assert.equal(total_duration_in_frames, 0);
});

// ─── Per-cut bridge_enabled flag (Phase 9 fallback lever) ───────────────

test("bridge_enabled=false on a single cut produces a strict hard cut", () => {
  const props: AvatarV5Props = {
    clips: [fakeClip("c0", 8), fakeClip("c1", 8), fakeClip("c2", 8)],
    transitions: [
      { cut_index: 0, needs_motion_blur: false, bridge_enabled: false }, // hard cut
      { cut_index: 1, needs_motion_blur: false },                        // default bridge enabled
    ],
    hook_primary: "",
  };
  const { entries, total_duration_in_frames } = layoutClips(props, FPS);
  // c0: 0..240, c1: 240..480 (NO bridge), c2: 480-4=476..716 (bridge enabled)
  assert.equal(entries[0].from_frame, 0);
  assert.equal(entries[1].from_frame, 240); // strict boundary
  assert.equal(entries[2].from_frame, 476); // bridged
  // Total = c0 + c1 + c2 - one bridge (cut 1 only)
  assert.equal(total_duration_in_frames, 8 * FPS * 3 - AUDIO_BRIDGE_FRAMES);
});

test("bridge_enabled omitted defaults to true (backward-compatible)", () => {
  const props: AvatarV5Props = {
    clips: [fakeClip("c0", 8), fakeClip("c1", 8)],
    transitions: [{ cut_index: 0, needs_motion_blur: false }], // no bridge_enabled field
    hook_primary: "",
  };
  const { total_duration_in_frames } = layoutClips(props, FPS);
  assert.equal(total_duration_in_frames, 8 * FPS * 2 - AUDIO_BRIDGE_FRAMES);
});

test("all bridges disabled yields the strict-hard-cut total duration", () => {
  const props: AvatarV5Props = {
    clips: Array.from({ length: 6 }, (_, i) => fakeClip(`c${i}`, 8)),
    transitions: Array.from({ length: 5 }, (_, i) => ({
      cut_index: i, needs_motion_blur: false, bridge_enabled: false,
    })),
    hook_primary: "",
  };
  const { total_duration_in_frames } = layoutClips(props, FPS);
  assert.equal(total_duration_in_frames, 6 * 8 * FPS); // no bridge subtractions
});
