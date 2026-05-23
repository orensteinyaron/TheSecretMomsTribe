# Avatar Full v5 — Seedance Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Avatar Full v5 Seedance-based render pipeline as a permanent, swappable addition to the SMT repo, then use it to render the deepfakes piece (`content_queue.id = aabf7fd2-f66a-4885-9675-19ab74df4acd`) as the acceptance test. Output reaches a human-review gate; nothing flips `content_queue.status` until Yaron approves.

**Architecture:** A composable Avatar Full pipeline that orchestrates: per-clip ElevenLabs TTS → audio-driven Seedance via Higgsfield (Soul-canonical start_image + per-clip MP3 in `medias[]`) → Whisper WER gate with std→fast→surface retry → Python+mediapipe face metrics → Remotion composition (embedded-audio passthrough + crop-offset normalization + motion-blur on flagged cuts + 4-frame audio bridge + punch-in pass + hook overlay) → ffmpeg concat → Supabase upload → avatar-v1 QA agent (informational only) → human review queue. Built on the 5 findings from YAR-129 session learnings (no chain pattern, framing-lock motion prompts, bounded-motion not pose-lock, Remotion is video-only, Whisper-verify per clip with retry). Localized seam: `video/lib/seedance/SeedanceClient.ts` interface so the BytePlus-direct spike (YAR-129 hybrid-architecture comment) swaps in later without touching pipeline code.

**Tech Stack:** TypeScript (Node, `tsx` runner), `node --test` test runner, ElevenLabs HTTP (`video/lib/elevenlabs.ts` — existing), Higgsfield HTTP (new, behind `SeedanceClient` interface — transport choice in Task 1), OpenAI Whisper (existing in `video/lib/qa-helpers.ts`), Python 3 + mediapipe sidecar (new — for face landmarks), Remotion 4.0 (existing), `ffmpeg` (existing), Supabase Storage `post-images` bucket (existing), avatar-v1 QA agent at `video/qa/profiles/avatar-full.ts` (existing).

**Boundaries (what this plan explicitly does NOT do):**
- Does not touch the legacy HeyGen-based `video/scripts/generate-avatar-video.ts`. That code stays as-is for reference and gets retired in a separate cleanup PR after v5 has shipped one approved piece.
- Does not implement the BytePlus-direct Seedance Lite hybrid (YAR-129 cost comment) — that swap happens against the `SeedanceClient` interface in a separate plan.
- Does not implement the full register system (YAR-129 Gap 1 and Gap 2 — `avatar_config` schema extension, ContentGen register-selection rules). The deepfakes piece uses register language hardcoded into the motion-prompt builder; full schema extension is a follow-up plan after v5 ships approval-grade output.
- Does not flip `content_queue.status` from `pending`. Render outputs surface to a human-review queue. Approval is manual via Yaron.
- **Does not implement punch-in pass.** Deferred to v5.1 (after first approved piece ships). Cuts Task 13, removes punch-in branch from `AvatarV5Clip`. Reason: punch-in is a confounding variable for the first proof-loop render — if v5 has lip-sync or identity drift on a 115%-scaled emphasis line, we can't distinguish punch-in's contribution from Seedance's.

**Decisions locked in before execution (no further gate):**
- **Higgsfield transport: MCP.** Seedance generation calls go through the Higgsfield MCP `generate_video` tool from a Claude Code session. There is no HTTP-direct Node client in v5.0 — the `SeedanceClient` interface stands as the seam, with `FakeSeedanceClient` for tests; the real-render execution is a playbook (`docs/specs/AVATAR_FULL_V5.md`) followed by a Claude Code session with Higgsfield MCP loaded. The HTTP-direct or BytePlus-direct implementation is a future swap against the same `SeedanceClient` interface.
- **Face metrics: Python + mediapipe sidecar** at `bin/face-metrics/`. TS wrapper at `video/lib/face-metrics.ts` shells out via stdin/stdout.

**Orchestration shape (clarifying for execution):**
The v5 render is a hybrid Claude-Code-session + Node-helpers pipeline:
- **Node helpers** (`video/lib/*`, `video/scripts/render-avatar-full-v5.ts --phase=…`) own all the deterministic, testable, MCP-free steps: per-clip TTS, MP3 upload, Whisper verify, frame extraction, face metrics, transitions manifest, Remotion compose, ffmpeg concat, Supabase upload, avatar-v1 QA agent run.
- **The Claude Code session** owns the Seedance calls (via Higgsfield MCP) and the orchestration loop: read the next clip's prompt + audio URL from the phase output, call MCP, pipe the result MP4 URL back into the next helper phase. The session is the orchestrator until HTTP/BytePlus transport ships.
- **Playbook** at `docs/specs/AVATAR_FULL_V5.md` documents the exact sequence so future renders are reproducible.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `video/lib/avatar-constants.ts` | Centralized Soul-canonical Rachel reference (image URL + Soul still ID), default voice ID, default render params. |
| `video/lib/seedance/SeedanceClient.ts` | Transport-agnostic interface. One method: `generateClip({start_image, audio, prompt, params}) → ClipResult`. |
| `video/lib/seedance/higgsfield-client.ts` | First implementation: HTTP-direct against Higgsfield API. Per Task 1 transport decision. |
| `video/lib/seedance/types.ts` | `ClipParams`, `ClipResult`, `SeedanceError` types. |
| `video/lib/elevenlabs-per-clip.ts` | Per-clip MP3 generator. Takes `avatar_config.clips[]`, emits N MP3s. |
| `video/lib/motion-prompt-builder.ts` | Composes per-clip Seedance prompt with framing-lock + bounded-motion + register-aware visual markers. |
| `video/lib/whisper-verifier.ts` | Per-clip Whisper transcription + WER computation + std→fast→surface retry orchestration. |
| `video/lib/face-metrics.ts` | TS wrapper around Python sidecar. Inputs frame paths, returns `{eye_y, face_x}` per frame. |
| `bin/face-metrics/main.py` | Python sidecar — mediapipe face landmark detection. |
| `bin/face-metrics/requirements.txt` | Python deps: `mediapipe`, `opencv-python-headless`. |
| `video/lib/transitions-manifest.ts` | Builds `TransitionsManifest` from per-clip face metrics. Returns per-cut `eye_line_delta_px`, `face_center_delta_pct`, `needs_motion_blur`, `crop_offset_y`. |
| `video/src/templates/avatar-v5/AvatarV5Composition.tsx` | New Remotion composition: passthrough embedded audio, per-clip crop-offset, motion-blur on flagged cuts, 4-frame audio bridge, punch-in pass, hook overlay. |
| `video/src/templates/avatar-v5/AvatarV5Clip.tsx` | Per-clip subcomponent: `OffthreadVideo` with `crop_offset_y` and optional `transform: scale(1.15)` for punch-in. |
| `video/src/templates/avatar-v5/AvatarV5Transition.tsx` | Cut subcomponent: hard cut OR motion-blur cut based on manifest. |
| `video/src/templates/avatar-v5/AvatarV5HookOverlay.tsx` | Hook text overlay subcomponent. Inter font, deep purple. |
| `video/scripts/render-avatar-full-v5.ts` | Orchestrator CLI. `npx tsx render-avatar-full-v5.ts <content_id>` with hard gates per spec Phases 0-6. |
| `video/scripts/__tests__/render-avatar-full-v5.test.ts` | E2E gate-orchestration test (mocked Seedance). |
| `video/lib/__tests__/seedance-client.test.ts` | Contract tests for `SeedanceClient` interface using a fake transport. |
| `video/lib/__tests__/motion-prompt-builder.test.ts` | Verify framing-lock and bounded-motion language appear; pose-lock language does NOT appear. |
| `video/lib/__tests__/whisper-verifier.test.ts` | Verify retry escalation logic with fake WER inputs. |
| `video/lib/__tests__/transitions-manifest.test.ts` | Verify threshold gating (40px / 8%), crop_offset_y normalization to median. |
| `video/lib/__tests__/elevenlabs-per-clip.test.ts` | Verify per-clip MP3 segmentation logic with fake ElevenLabs HTTP. |
| `docs/specs/AVATAR_FULL_V5.md` | Operational doc: how to run, gate definitions, retry behavior, output paths. |

### Modified files

| Path | Change |
|---|---|
| `video/src/Root.tsx` | Register `AvatarV5Composition`. |
| `video/qa/profiles/avatar-full.ts` | No code changes. Confirmed compatible — pipeline emits `clips[]` + `asset_path` + `reference_image_path` per the existing `QAInput` shape. |
| `video/package.json` | Add `@remotion/google-fonts` Inter loading (already present), add `wer` (Word Error Rate) dependency or implement inline (decision in Task 10). |
| `.env.example` | Add `HIGGSFIELD_API_KEY` (per Task 1 transport decision). |
| `CLAUDE.md` | Append a short "Avatar Full v5" section under Video Pipeline; link to `docs/specs/AVATAR_FULL_V5.md`. |

---

## Phase 0 — Foundations (no Seedance credits spent)

### Task 1: Document the MCP-transport architecture

**Decision pre-locked:** Higgsfield MCP, not HTTP-direct. No further gate.

**Files:**
- Create: `docs/specs/AVATAR_FULL_V5.md` (header + "Transport & orchestration" section)

- [ ] **Step 1: Write the doc**

Sections:
- **Transport.** Higgsfield MCP `generate_video` (model `seedance_2_0`) with `medias: [{role: start_image, value: <Soul URL>}, {role: audio, value: <ElevenLabs MP3 URL>}]`. Model card confirmed via `models_explore`. Resolution `1080p`, aspect `9:16`, mode `std` with `fast` retry, duration 4-15s.
- **Why MCP for v5.0.** No documented Higgsfield HTTP API in this codebase; MCP is the working surface. BytePlus-direct or HTTP-direct unblocks unattended automation in a future swap (separate plan against `SeedanceClient` interface).
- **Orchestration model.** Claude Code session is the orchestrator. Node helpers under `video/lib/*` + `video/scripts/render-avatar-full-v5.ts --phase=<name>` own deterministic steps. Session calls MCP `generate_video` for each clip; pipes the resulting video URL into the next helper invocation.
- **Why this isn't a Node CLI today.** MCP tools are Claude-session-scoped — a Node CLI can't invoke them. Building a brittle proxy (long-running Claude subprocess piped to Node) creates more risk than value for v5.0. When HTTP arrives, the session becomes optional and `render-avatar-full-v5.ts` can grow a `--phase=seedance` subcommand.
- **Forward path.** When BytePlus-direct ships (YAR-129 cost-architecture comment), write `HttpSeedanceClient` against the `SeedanceClient` interface; orchestrator gains a `--phase=seedance` step that uses it; playbook becomes optional.

- [ ] **Step 2: Commit**

```bash
git add docs/specs/AVATAR_FULL_V5.md
git commit -m "docs(avatar-v5): MCP transport + hybrid orchestration architecture"
```

### Task 2: Centralize Soul-canonical Rachel

**Files:**
- Create: `video/lib/avatar-constants.ts`
- Modify: `video/scripts/generate-hook-card.ts:27-28` (remove hardcoded URL, import constant)

- [ ] **Step 1: Write the constants file**

```typescript
// video/lib/avatar-constants.ts
//
// Single source of truth for Avatar Full pipeline reference assets.
// Per YAR-129 acceptance criteria + docs/specs/PIECE_3BCAFC78_BACKFILL_V1.md.

export const RACHEL_SOUL_STILL_ID = "f757b09c-d94d-4ade-a076-4a1a496c641e";
export const RACHEL_SOUL_STILL_URL =
  "https://d2ol7oe51mr4n9.cloudfront.net/user_3DGDY5uQO2VTYDyY6tkVHLr8qE8/f757b09c-d94d-4ade-a076-4a1a496c641e.png";
export const RACHEL_ELEVENLABS_VOICE_ID = "tRhabdS7JjlQ0lVEImuM";

export const AVATAR_V5_DEFAULTS = {
  aspect_ratio: "9:16" as const,
  resolution: "1080p" as const,
  mode: "std" as const,
  duration_per_clip_s: 8, // tunable per clip; within Seedance 4-15s range
};
```

- [ ] **Step 2: Update `generate-hook-card.ts` to import the constant**

Find the hardcoded `RACHEL_STILL_URL` at line 27 and replace with `import { RACHEL_SOUL_STILL_URL } from "../lib/avatar-constants.js"`.

- [ ] **Step 3: Run existing tests**

```bash
cd video && npx tsx --test qa/__tests__/*.test.ts
```

Expected: PASS (no regressions — the constant is identical to the old hardcoded URL).

- [ ] **Step 4: Commit**

```bash
git add video/lib/avatar-constants.ts video/scripts/generate-hook-card.ts
git commit -m "feat(video): centralize Soul-canonical Rachel constants"
```

### Task 3: SeedanceClient interface + fake

**Files:**
- Create: `video/lib/seedance/types.ts`, `video/lib/seedance/SeedanceClient.ts`, `video/lib/seedance/fake-client.ts`
- Create test: `video/lib/__tests__/seedance-client.test.ts`

- [ ] **Step 1: Write the types**

```typescript
// video/lib/seedance/types.ts
export type ClipParams = {
  start_image_url: string;       // Soul-canonical Rachel URL or other CDN/job URL
  audio_url: string;              // Per-clip ElevenLabs MP3 URL (CDN-hosted)
  motion_prompt: string;          // Framing-lock + bounded-motion text from motion-prompt-builder
  aspect_ratio: "9:16";
  resolution: "1080p";
  duration_s: number;             // Within 4-15s
  mode: "std" | "fast";
};

export type ClipResult = {
  job_id: string;
  video_url: string;              // CDN URL of generated MP4 with embedded audio
  duration_s: number;
  cost_credits: number;
  cost_usd: number;
  mode_used: "std" | "fast";
};

export class SeedanceError extends Error {
  constructor(public readonly kind: "hallucinated_audio" | "transport" | "timeout" | "other", message: string) {
    super(message);
    this.name = "SeedanceError";
  }
}
```

- [ ] **Step 2: Write the interface**

```typescript
// video/lib/seedance/SeedanceClient.ts
import type { ClipParams, ClipResult } from "./types.js";

export interface SeedanceClient {
  generateClip(params: ClipParams): Promise<ClipResult>;
}
```

- [ ] **Step 3: Write the failing test**

```typescript
// video/lib/__tests__/seedance-client.test.ts
import { test } from "node:test";
import assert from "node:assert";
import type { SeedanceClient } from "../seedance/SeedanceClient.js";
import { FakeSeedanceClient } from "../seedance/fake-client.js";

test("FakeSeedanceClient returns a deterministic ClipResult", async () => {
  const client: SeedanceClient = new FakeSeedanceClient();
  const result = await client.generateClip({
    start_image_url: "https://example.com/rachel.png",
    audio_url: "https://example.com/clip-01.mp3",
    motion_prompt: "Medium close-up, camera locked",
    aspect_ratio: "9:16",
    resolution: "1080p",
    duration_s: 8,
    mode: "std",
  });
  assert.match(result.job_id, /^fake-/);
  assert.equal(result.mode_used, "std");
  assert.ok(result.cost_credits > 0);
});
```

Run: `cd video && npx tsx --test lib/__tests__/seedance-client.test.ts` — expect FAIL.

- [ ] **Step 4: Implement FakeSeedanceClient**

```typescript
// video/lib/seedance/fake-client.ts
import type { SeedanceClient } from "./SeedanceClient.js";
import type { ClipParams, ClipResult } from "./types.js";
import { randomUUID } from "node:crypto";

export class FakeSeedanceClient implements SeedanceClient {
  constructor(private readonly fixtureVideoUrl: string = "https://example.com/fake-clip.mp4") {}
  async generateClip(params: ClipParams): Promise<ClipResult> {
    return {
      job_id: `fake-${randomUUID()}`,
      video_url: this.fixtureVideoUrl,
      duration_s: params.duration_s,
      cost_credits: 50,
      cost_usd: 0.65,
      mode_used: params.mode,
    };
  }
}
```

- [ ] **Step 5: Run test — expect PASS**

```bash
cd video && npx tsx --test lib/__tests__/seedance-client.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add video/lib/seedance/ video/lib/__tests__/seedance-client.test.ts
git commit -m "feat(video): SeedanceClient interface + fake transport"
```

### Task 4: ~~HiggsfieldSeedanceClient (HTTP)~~ — **DEFERRED**

Replaced by Task 1's documented MCP playbook. No HTTP Node client in v5.0. When BytePlus-direct or Higgsfield-HTTP ships, that becomes a new task in a separate plan and implements `SeedanceClient` (Task 3 interface). The `FakeSeedanceClient` from Task 3 covers the test path; the real-render path is the playbook from Task 1.

---

## Phase 1 — Per-clip TTS segmentation

### Task 5: Per-clip ElevenLabs MP3 generator

**Files:**
- Create: `video/lib/elevenlabs-per-clip.ts`
- Create test: `video/lib/__tests__/elevenlabs-per-clip.test.ts`

The existing `video/lib/elevenlabs.ts` (line 1-70) produces one MP3 per content. v5 needs per-clip MP3s — one HTTP call per clip's `expected_script`.

- [ ] **Step 1: Write the failing test (with fake HTTP)**

```typescript
// video/lib/__tests__/elevenlabs-per-clip.test.ts
import { test, mock } from "node:test";
import assert from "node:assert";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";

import { generatePerClipMp3s } from "../elevenlabs-per-clip.js";

const workdir = "/tmp/avatar-v5-test-elevenlabs";

test.beforeEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });
});

test("emits one MP3 per clip with deterministic filenames", async () => {
  const fakeFetch = mock.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
  const clips = [
    { id: "clip-01", expected_script: "Hook line" },
    { id: "clip-02", expected_script: "Body line" },
  ];
  const result = await generatePerClipMp3s({ clips, workdir, fetchImpl: fakeFetch });
  assert.equal(result.length, 2);
  assert.ok(existsSync(path.join(workdir, "clip-01.mp3")));
  assert.ok(existsSync(path.join(workdir, "clip-02.mp3")));
  assert.equal(fakeFetch.mock.callCount(), 2);
});

test("propagates ElevenLabs HTTP failure", async () => {
  const fakeFetch = mock.fn(async () => new Response("upstream error", { status: 500 }));
  await assert.rejects(
    () => generatePerClipMp3s({ clips: [{ id: "c", expected_script: "x" }], workdir, fetchImpl: fakeFetch }),
    /ElevenLabs/,
  );
});
```

Run: `cd video && npx tsx --test lib/__tests__/elevenlabs-per-clip.test.ts` — expect FAIL.

- [ ] **Step 2: Implement**

```typescript
// video/lib/elevenlabs-per-clip.ts
import { writeFileSync } from "node:fs";
import path from "node:path";
import { RACHEL_ELEVENLABS_VOICE_ID } from "./avatar-constants.js";

type ClipInput = { id: string; expected_script: string };

export type PerClipMp3 = { clip_id: string; mp3_path: string; script: string };

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

export async function generatePerClipMp3s(opts: {
  clips: ClipInput[];
  workdir: string;
  voice_id?: string;
  fetchImpl?: typeof fetch;
}): Promise<PerClipMp3[]> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const voice = opts.voice_id ?? RACHEL_ELEVENLABS_VOICE_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey && opts.fetchImpl === undefined) throw new Error("ELEVENLABS_API_KEY env var required");
  const out: PerClipMp3[] = [];
  for (const clip of opts.clips) {
    const res = await fetchFn(`${ELEVENLABS_BASE}/text-to-speech/${voice}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey ?? "",
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text: clip.expected_script,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.85, style: 0.3 },
      }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${clip.id}: ${res.status} ${await res.text()}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const mp3Path = path.join(opts.workdir, `${clip.id}.mp3`);
    writeFileSync(mp3Path, buf);
    out.push({ clip_id: clip.id, mp3_path: mp3Path, script: clip.expected_script });
  }
  return out;
}
```

- [ ] **Step 3: Run test — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add video/lib/elevenlabs-per-clip.ts video/lib/__tests__/elevenlabs-per-clip.test.ts
git commit -m "feat(video): per-clip ElevenLabs MP3 generator"
```

---

## Phase 2 — Motion-prompt builder

### Task 6: Motion-prompt builder

**Files:**
- Create: `video/lib/motion-prompt-builder.ts`
- Create test: `video/lib/__tests__/motion-prompt-builder.test.ts`

Bakes YAR-129 Findings 2 (framing-lock) and 3 (bounded-motion, NOT pose-lock) into every clip prompt. For the deepfakes piece, applies `concerned_insider` register language from YAR-129 Gap 1.

- [ ] **Step 1: Write the failing test**

```typescript
// video/lib/__tests__/motion-prompt-builder.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { buildMotionPrompt } from "../motion-prompt-builder.js";

test("contains framing-lock language", () => {
  const p = buildMotionPrompt({ register: "concerned_insider", script_excerpt: "AI deepfakes" });
  assert.match(p, /camera position is locked/i);
  assert.match(p, /no zoom/i);
  assert.match(p, /no pan/i);
});

test("contains bounded-motion language, NOT pose-lock", () => {
  const p = buildMotionPrompt({ register: "concerned_insider", script_excerpt: "AI deepfakes" });
  assert.match(p, /subtle natural motion within a small envelope/i);
  assert.doesNotMatch(p, /pose is locked/i);
  assert.doesNotMatch(p, /torso position is locked/i);
});

test("concerned_insider register includes lean-in markers", () => {
  const p = buildMotionPrompt({ register: "concerned_insider", script_excerpt: "warning" });
  assert.match(p, /lean[- ]in/i);
  assert.match(p, /lowered/i);
});

test("excited_discovery register has animated markers, not lean-in", () => {
  const p = buildMotionPrompt({ register: "excited_discovery", script_excerpt: "you NEED to try this" });
  assert.match(p, /animated/i);
  assert.doesNotMatch(p, /lean[- ]in/i);
});
```

Run: expect FAIL.

- [ ] **Step 2: Implement**

```typescript
// video/lib/motion-prompt-builder.ts
// Bakes YAR-129 findings 2 (framing-lock) and 3 (bounded-motion not pose-lock)
// into every Seedance clip prompt. Register markers come from YAR-129 Gap 1.

type Register = "neutral_warm" | "concerned_insider" | "excited_discovery" | "dry_reflective";

const FRAMING_LOCK = [
  "Medium close-up framing held throughout — the woman's head fills the upper two-thirds of the frame, her shoulders and the kitchen counter remain visible in the lower third.",
  "Camera position is locked, no zoom in or out, no pan.",
].join(" ");

const BOUNDED_MOTION = "Subtle natural motion within a small envelope, not large posture shifts. She breathes, leans slightly, gestures with her hands — but stays within a defined range so position drift between clip start and clip end is minimal.";

const REGISTER_MARKERS: Record<Register, string> = {
  neutral_warm:
    "Open posture, hands relaxed, soft eye contact. Half-smile at rest. Speaks at natural pace with occasional contractions.",
  concerned_insider:
    "Lean-in framing with slight forward upper-body tilt, eyes locked into camera. Hands visible and moving naturally but controlled and close to body — NOT declarative, NOT pointing. Brow slightly furrowed at the hook, softening by the CTA. Lowered voice register, slower pace. The friend in the group chat telling you something important specifically because she trusts you to act on it.",
  excited_discovery:
    "Animated hands, broader gestures, eyebrows up. Half-smile breaking into full at payoff. Faster pace.",
  dry_reflective:
    "Stiller body, hand near face or temple is fine, softer eye contact with occasional look-off, no smile. Slower, sparser, longer pauses.",
};

export function buildMotionPrompt(opts: { register: Register; script_excerpt: string }): string {
  return [
    FRAMING_LOCK,
    REGISTER_MARKERS[opts.register],
    BOUNDED_MOTION,
    `She is speaking the line: "${opts.script_excerpt}".`,
  ].join(" ");
}
```

- [ ] **Step 3: Run test — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add video/lib/motion-prompt-builder.ts video/lib/__tests__/motion-prompt-builder.test.ts
git commit -m "feat(video): motion-prompt builder w/ framing-lock + register markers"
```

---

## Phase 3 — Whisper verification with retry escalation

### Task 7: Per-clip Whisper verifier

**Files:**
- Create: `video/lib/whisper-verifier.ts`
- Create test: `video/lib/__tests__/whisper-verifier.test.ts`

YAR-129 Finding 5: production renderer cannot trust audio role reliability. Need per-clip Whisper WER + std→fast→surface retry.

- [ ] **Step 1: Write the failing test**

```typescript
// video/lib/__tests__/whisper-verifier.test.ts
import { test, mock } from "node:test";
import assert from "node:assert";
import { verifyAndRetry } from "../whisper-verifier.js";

test("PASS on first try when WER below threshold", async () => {
  const seedance = mock.fn(async (mode: "std" | "fast") => ({ job_id: "j1", video_url: "v1", mode_used: mode, cost_credits: 50 } as any));
  const whisper = mock.fn(async () => ({ transcript: "hello world", wer: 0.05 }));
  const r = await verifyAndRetry({
    clipId: "c", expectedScript: "hello world",
    submitFn: seedance, whisperFn: whisper, threshold: 0.15,
  });
  assert.equal(r.passed, true);
  assert.equal(r.attempts, 1);
  assert.equal(seedance.mock.callCount(), 1);
});

test("escalates std → fast on first failure, passes on retry", async () => {
  const seedance = mock.fn(async (mode: "std" | "fast") => ({ job_id: `j-${mode}`, video_url: "v", mode_used: mode, cost_credits: 50 } as any));
  let call = 0;
  const whisper = mock.fn(async () => (call++ === 0 ? { transcript: "garbage", wer: 0.8 } : { transcript: "hello world", wer: 0.05 }));
  const r = await verifyAndRetry({
    clipId: "c", expectedScript: "hello world",
    submitFn: seedance, whisperFn: whisper, threshold: 0.15,
  });
  assert.equal(r.passed, true);
  assert.equal(r.attempts, 2);
  assert.equal(seedance.mock.calls[0].arguments[0], "std");
  assert.equal(seedance.mock.calls[1].arguments[0], "fast");
});

test("surfaces to human after fast failure", async () => {
  const seedance = mock.fn(async (mode: "std" | "fast") => ({ job_id: `j-${mode}`, video_url: "v", mode_used: mode, cost_credits: 50 } as any));
  const whisper = mock.fn(async () => ({ transcript: "garbage", wer: 0.8 }));
  const r = await verifyAndRetry({
    clipId: "c", expectedScript: "hello world",
    submitFn: seedance, whisperFn: whisper, threshold: 0.15,
  });
  assert.equal(r.passed, false);
  assert.equal(r.attempts, 2);
  assert.equal(r.reason, "surface_to_human");
});
```

Run: expect FAIL.

- [ ] **Step 2: Implement**

```typescript
// video/lib/whisper-verifier.ts
import { logPromptExecution } from "../../agents/lib/prompt_logger.js";
import { execFileSync } from "node:child_process";

export type SubmitFn = (mode: "std" | "fast") => Promise<{ job_id: string; video_url: string; mode_used: "std" | "fast"; cost_credits: number }>;
export type WhisperFn = (video_url_or_path: string) => Promise<{ transcript: string; wer: number }>;

export type VerifyResult = {
  clipId: string;
  passed: boolean;
  attempts: number;
  reason?: "surface_to_human";
  final_job_id?: string;
  final_video_url?: string;
  final_wer?: number;
  total_credits: number;
  per_attempt: Array<{ mode: "std" | "fast"; job_id: string; wer: number; credits: number }>;
};

export async function verifyAndRetry(opts: {
  clipId: string;
  expectedScript: string;
  submitFn: SubmitFn;
  whisperFn: WhisperFn;
  threshold?: number; // default 0.15
  content_id?: string; // for prompt_executions logging
}): Promise<VerifyResult> {
  const threshold = opts.threshold ?? 0.15;
  const attempts: VerifyResult["per_attempt"] = [];
  for (const mode of ["std", "fast"] as const) {
    const sub = await opts.submitFn(mode);
    const w = await opts.whisperFn(sub.video_url);
    attempts.push({ mode, job_id: sub.job_id, wer: w.wer, credits: sub.cost_credits });
    if (w.wer < threshold) {
      return {
        clipId: opts.clipId,
        passed: true,
        attempts: attempts.length,
        final_job_id: sub.job_id,
        final_video_url: sub.video_url,
        final_wer: w.wer,
        total_credits: attempts.reduce((a, x) => a + x.credits, 0),
        per_attempt: attempts,
      };
    }
  }
  return {
    clipId: opts.clipId,
    passed: false,
    attempts: attempts.length,
    reason: "surface_to_human",
    total_credits: attempts.reduce((a, x) => a + x.credits, 0),
    per_attempt: attempts,
  };
}

// Convenience: wraps the existing Whisper helper from qa-helpers.
export function makeWhisperFn(): WhisperFn {
  return async (videoUrl: string) => {
    // Implementation calls the existing whisperTranscribe from video/lib/qa-helpers.ts;
    // the WER computation uses the wer fn from video/qa/__tests__/helpers.test.ts (which
    // imports a real impl — verify in step 3 below before claiming PASS).
    throw new Error("makeWhisperFn: wire to qa-helpers.whisperTranscribe + computeWer");
  };
}
```

- [ ] **Step 3: Wire `makeWhisperFn` to the real Whisper helper**

Read `video/lib/qa-helpers.ts:96-108` (the existing `whisperTranscribe`) and `video/qa/__tests__/helpers.test.ts:47` (the `computeWer` ref). Replace the throw in `makeWhisperFn` with the real call. Add a test that asserts the wire-up calls `whisperTranscribe` once per invocation.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add video/lib/whisper-verifier.ts video/lib/__tests__/whisper-verifier.test.ts
git commit -m "feat(video): per-clip Whisper verifier with std→fast→surface retry"
```

---

## Phase 4 — Face metrics (Python sidecar)

### Task 8: Decide face-detection implementation

**Files:**
- Modify: `docs/specs/AVATAR_FULL_V5.md` (add "Face metrics" section)

- [ ] **Step 1: Surface decision to Yaron**

Three options:

- **(A) Python + mediapipe (recommended).** Highest landmark precision (478 points), free, sidecar isolates the dep. Adds Python 3.9+ requirement and a `bin/face-metrics/` directory.
- **(B) Pure-JS `@vladmandic/face-api`.** No sidecar, no Python. Slower (CPU-only on Node), bigger npm install.
- **(C) Cloud (Google Vision / AWS Rekognition).** Trivial integration; per-call cost ($1.50/1000 frames), needs cloud creds. Defers to existing cloud infra.

Recommendation: **(A)**. Confirms localization (Yaron's "swap later" constraint applies cleanly to a sidecar boundary too — `FaceMetrics` interface plus alternate sidecar later).

- [ ] **Step 2: Document the choice**

```bash
git commit -am "docs(avatar-v5): document face-metrics implementation choice"
```

### Task 9: Python face-metrics sidecar

**Files:**
- Create: `bin/face-metrics/main.py`, `bin/face-metrics/requirements.txt`, `bin/face-metrics/README.md`

**Skip steps in this task if Yaron picked (B) or (C) in Task 8.** Adjust to the picked alternative.

- [ ] **Step 1: Write requirements + sidecar entrypoint**

```
# bin/face-metrics/requirements.txt
mediapipe==0.10.18
opencv-python-headless==4.10.0.84
```

```python
#!/usr/bin/env python3
# bin/face-metrics/main.py
#
# Reads JSON lines on stdin, each: {"id": "<frame-id>", "path": "<absolute-path>"}.
# Writes JSON lines on stdout, each: {"id": "<frame-id>", "eye_y": <int>, "face_x": <int>, "face_w": <int>, "face_h": <int>}.
# On detection failure: emits {"id": "<frame-id>", "error": "no_face_detected"} and continues.

import json, sys
import cv2
import mediapipe as mp

mp_face = mp.solutions.face_mesh

# MediaPipe face mesh landmark indices for the irises:
LEFT_EYE_IRIS = 468   # iris center
RIGHT_EYE_IRIS = 473

def measure(path):
    img = cv2.imread(path)
    if img is None: return {"error": "image_unreadable"}
    h, w = img.shape[:2]
    with mp_face.FaceMesh(static_image_mode=True, max_num_faces=1, refine_landmarks=True) as fm:
        res = fm.process(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        if not res.multi_face_landmarks: return {"error": "no_face_detected"}
        lm = res.multi_face_landmarks[0].landmark
        left_y  = int(lm[LEFT_EYE_IRIS].y * h)
        right_y = int(lm[RIGHT_EYE_IRIS].y * h)
        eye_y   = (left_y + right_y) // 2
        # Bounding box from all landmarks
        xs = [int(p.x * w) for p in lm]
        ys = [int(p.y * h) for p in lm]
        x0, x1 = min(xs), max(xs)
        y0, y1 = min(ys), max(ys)
        face_x = (x0 + x1) // 2
        face_w = x1 - x0
        face_h = y1 - y0
        return {"eye_y": eye_y, "face_x": face_x, "face_w": face_w, "face_h": face_h, "img_w": w, "img_h": h}

for line in sys.stdin:
    line = line.strip()
    if not line: continue
    req = json.loads(line)
    out = measure(req["path"])
    out["id"] = req["id"]
    print(json.dumps(out), flush=True)
```

- [ ] **Step 2: Write README**

```markdown
# face-metrics

Python sidecar for Avatar Full v5 transitions manifest. Reads frame paths on stdin, emits eye-line and face-center measurements on stdout. mediapipe under the hood.

## Setup

    cd bin/face-metrics
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt

## Run

    echo '{"id": "f1", "path": "/abs/path/frame.png"}' | ./main.py

Returns one JSON line per input.
```

- [ ] **Step 3: Smoke-run the sidecar against a sample frame**

```bash
cd bin/face-metrics && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
# Pick any existing test image with a face from the repo, e.g. a hook-card output
echo "{\"id\": \"smoke\", \"path\": \"$(pwd)/../../docs/assets/rachel-sample.png\"}" | python3 main.py
```

Expected: JSON line with `eye_y`, `face_x`, `face_w`, `face_h`. If no sample image exists, generate one via `generate-hook-card.ts` first.

- [ ] **Step 4: Commit**

```bash
git add bin/face-metrics/
git commit -m "feat(face-metrics): Python+mediapipe sidecar for v5 transitions manifest"
```

### Task 10: TypeScript wrapper for face-metrics

**Files:**
- Create: `video/lib/face-metrics.ts`
- Create test: `video/lib/__tests__/face-metrics.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// video/lib/__tests__/face-metrics.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { measureFrames } from "../face-metrics.js";
import path from "node:path";

test("measureFrames returns one result per input frame", async () => {
  // Uses real sample image. Skipped if sample missing.
  const sample = path.resolve(process.cwd(), "../docs/assets/rachel-sample.png");
  const results = await measureFrames([{ id: "f1", path: sample }, { id: "f2", path: sample }]);
  assert.equal(results.length, 2);
  for (const r of results) {
    assert.equal(r.id !== undefined, true);
    if (!r.error) {
      assert.ok(typeof r.eye_y === "number");
      assert.ok(typeof r.face_x === "number");
    }
  }
});
```

- [ ] **Step 2: Implement**

```typescript
// video/lib/face-metrics.ts
import { spawn } from "node:child_process";
import path from "node:path";

export type FrameRequest = { id: string; path: string };
export type FrameMeasurement = {
  id: string;
  eye_y?: number;
  face_x?: number;
  face_w?: number;
  face_h?: number;
  img_w?: number;
  img_h?: number;
  error?: "no_face_detected" | "image_unreadable" | string;
};

const SIDECAR = path.resolve(process.cwd(), "../bin/face-metrics/main.py");
const VENV_PY = path.resolve(process.cwd(), "../bin/face-metrics/.venv/bin/python3");

export async function measureFrames(frames: FrameRequest[]): Promise<FrameMeasurement[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(VENV_PY, [SIDECAR], { stdio: ["pipe", "pipe", "inherit"] });
    let buf = "";
    const out: FrameMeasurement[] = [];
    proc.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      let nl = buf.indexOf("\n");
      while (nl !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) out.push(JSON.parse(line));
        nl = buf.indexOf("\n");
      }
    });
    proc.on("error", reject);
    proc.on("close", () => resolve(out));
    for (const f of frames) proc.stdin.write(JSON.stringify(f) + "\n");
    proc.stdin.end();
  });
}
```

- [ ] **Step 3: Run test — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add video/lib/face-metrics.ts video/lib/__tests__/face-metrics.test.ts
git commit -m "feat(video): TS wrapper for face-metrics Python sidecar"
```

---

## Phase 5 — Transitions manifest

### Task 11: Transitions manifest builder

**Files:**
- Create: `video/lib/transitions-manifest.ts`
- Create test: `video/lib/__tests__/transitions-manifest.test.ts`

Per spec Phase 3: for each cut boundary, compute `eye_line_delta_px`, `face_center_delta_pct`, `needs_motion_blur`, `crop_offset_y` (normalizes to median eye-line across all clips). Thresholds: `eye_line_delta_px > 40` OR `face_center_delta_pct > 0.08`.

- [ ] **Step 1: Write the failing test**

```typescript
// video/lib/__tests__/transitions-manifest.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { buildTransitionsManifest } from "../transitions-manifest.js";

const FRAME_W = 1080;

test("needs_motion_blur=true when eye_line_delta_px > 40", () => {
  const clips = [
    { clip_id: "c1", start: { eye_y: 500, face_x: 540 }, end: { eye_y: 510, face_x: 540 } },
    { clip_id: "c2", start: { eye_y: 560, face_x: 540 }, end: { eye_y: 555, face_x: 540 } }, // 560-510 = 50 > 40
  ];
  const m = buildTransitionsManifest({ clips, frame_width: FRAME_W });
  assert.equal(m.transitions.length, 1);
  assert.equal(m.transitions[0].needs_motion_blur, true);
  assert.equal(m.transitions[0].eye_line_delta_px, 50);
});

test("needs_motion_blur=true when face_center_delta_pct > 0.08", () => {
  const clips = [
    { clip_id: "c1", start: { eye_y: 500, face_x: 540 }, end: { eye_y: 505, face_x: 540 } },
    { clip_id: "c2", start: { eye_y: 510, face_x: 650 }, end: { eye_y: 510, face_x: 650 } }, // 650-540=110, 110/1080=0.10 > 0.08
  ];
  const m = buildTransitionsManifest({ clips, frame_width: FRAME_W });
  assert.equal(m.transitions[0].needs_motion_blur, true);
});

test("needs_motion_blur=false below both thresholds", () => {
  const clips = [
    { clip_id: "c1", start: { eye_y: 500, face_x: 540 }, end: { eye_y: 505, face_x: 540 } },
    { clip_id: "c2", start: { eye_y: 515, face_x: 555 }, end: { eye_y: 510, face_x: 555 } },
  ];
  const m = buildTransitionsManifest({ clips, frame_width: FRAME_W });
  assert.equal(m.transitions[0].needs_motion_blur, false);
});

test("crop_offset_y normalizes each clip's start_eye to median", () => {
  const clips = [
    { clip_id: "c1", start: { eye_y: 500, face_x: 540 }, end: { eye_y: 500, face_x: 540 } },
    { clip_id: "c2", start: { eye_y: 510, face_x: 540 }, end: { eye_y: 510, face_x: 540 } },
    { clip_id: "c3", start: { eye_y: 520, face_x: 540 }, end: { eye_y: 520, face_x: 540 } },
  ];
  const m = buildTransitionsManifest({ clips, frame_width: FRAME_W });
  // median start_eye_y = 510. c1 needs to shift down (+10), c2 stays (0), c3 shifts up (-10).
  assert.equal(m.crops.find(c => c.clip_id === "c1")!.crop_offset_y, 10);
  assert.equal(m.crops.find(c => c.clip_id === "c2")!.crop_offset_y, 0);
  assert.equal(m.crops.find(c => c.clip_id === "c3")!.crop_offset_y, -10);
});
```

Run: expect FAIL.

- [ ] **Step 2: Implement**

```typescript
// video/lib/transitions-manifest.ts
//
// Builds the v5 transitions manifest from per-clip face metrics.
// Thresholds (40 px eye-line, 8% face-center) are first-pass defaults per
// the YAR-129 v5 spec; tunable after the first real render.

type Endpoint = { eye_y: number; face_x: number };
export type ClipMetrics = { clip_id: string; start: Endpoint; end: Endpoint };

export type TransitionEntry = {
  cut_index: number;
  from_clip_id: string;
  to_clip_id: string;
  eye_line_delta_px: number;
  face_center_delta_pct: number;
  needs_motion_blur: boolean;
};

export type CropEntry = { clip_id: string; crop_offset_y: number };

export type TransitionsManifest = {
  transitions: TransitionEntry[];
  crops: CropEntry[];
  median_start_eye_y: number;
};

export const DEFAULTS = { eye_line_delta_threshold_px: 40, face_center_delta_threshold_pct: 0.08 };

export function buildTransitionsManifest(opts: {
  clips: ClipMetrics[];
  frame_width: number;
  thresholds?: typeof DEFAULTS;
}): TransitionsManifest {
  const t = opts.thresholds ?? DEFAULTS;
  const transitions: TransitionEntry[] = [];
  for (let i = 0; i < opts.clips.length - 1; i++) {
    const a = opts.clips[i];
    const b = opts.clips[i + 1];
    const eye_delta = Math.abs(a.end.eye_y - b.start.eye_y);
    const face_delta_pct = Math.abs(a.end.face_x - b.start.face_x) / opts.frame_width;
    transitions.push({
      cut_index: i,
      from_clip_id: a.clip_id,
      to_clip_id: b.clip_id,
      eye_line_delta_px: eye_delta,
      face_center_delta_pct: face_delta_pct,
      needs_motion_blur: eye_delta > t.eye_line_delta_threshold_px || face_delta_pct > t.face_center_delta_threshold_pct,
    });
  }
  const start_eyes = opts.clips.map(c => c.start.eye_y).sort((x, y) => x - y);
  const median = start_eyes[Math.floor(start_eyes.length / 2)];
  const crops: CropEntry[] = opts.clips.map(c => ({ clip_id: c.clip_id, crop_offset_y: median - c.start.eye_y }));
  return { transitions, crops, median_start_eye_y: median };
}
```

- [ ] **Step 3: Run test — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add video/lib/transitions-manifest.ts video/lib/__tests__/transitions-manifest.test.ts
git commit -m "feat(video): transitions manifest builder with eye-line + face-center deltas"
```

---

## Phase 6 — Remotion composition v2

### Task 12: AvatarV5 composition components

**Files:**
- Create: `video/src/templates/avatar-v5/types.ts`
- Create: `video/src/templates/avatar-v5/AvatarV5Clip.tsx`
- Create: `video/src/templates/avatar-v5/AvatarV5HookOverlay.tsx`
- Create: `video/src/templates/avatar-v5/AvatarV5Composition.tsx`
- Modify: `video/src/Root.tsx` (register the new composition)

- [ ] **Step 1: Write types**

```typescript
// video/src/templates/avatar-v5/types.ts
export type V5Clip = {
  id: string;
  video_url: string;          // Seedance MP4 with embedded audio
  duration_s: number;
  crop_offset_y: number;      // From transitions manifest
};
// Punch-in (115% scale on emphasis lines) is deferred to v5.1. See
// docs/specs/AVATAR_FULL_V5.md "Follow-ups" section.

export type V5Transition = {
  cut_index: number;
  needs_motion_blur: boolean; // 2-3 frame horizontal blur on last/first frame
};

export type AvatarV5Props = {
  clips: V5Clip[];
  transitions: V5Transition[];
  hook_text: string;          // Overlay on clip 1
  fps: number;                // 30
  width: number;              // 1080
  height: number;             // 1920
};
```

- [ ] **Step 2: Per-clip subcomponent (crop-offset + punch-in)**

```tsx
// video/src/templates/avatar-v5/AvatarV5Clip.tsx
import { OffthreadVideo } from "remotion";
import type { V5Clip } from "./types";

export const AvatarV5Clip: React.FC<{ clip: V5Clip }> = ({ clip }) => {
  // crop_offset_y: positive = shift content downward (face was too high → bring down).
  // Implemented as a CSS translate on the OffthreadVideo. Per YAR-129 Finding 4:
  // pass audio through (no `volume={0}`, no separate <Audio>).
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <OffthreadVideo
        src={clip.video_url}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `translateY(${clip.crop_offset_y}px)`,
        }}
      />
    </div>
  );
};
```

- [ ] **Step 3: Hook overlay subcomponent**

```tsx
// video/src/templates/avatar-v5/AvatarV5HookOverlay.tsx
import { AbsoluteFill } from "remotion";

export const AvatarV5HookOverlay: React.FC<{ text: string }> = ({ text }) => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <div
      style={{
        position: "absolute",
        top: "12%",
        left: "8%",
        right: "8%",
        textAlign: "center",
        color: "#FFFFFF",
        fontFamily: "Inter, sans-serif",
        fontWeight: 800,
        fontSize: 64,
        lineHeight: 1.15,
        textShadow: "0 4px 24px rgba(0,0,0,0.55)",
      }}
    >
      {text}
    </div>
  </AbsoluteFill>
);
```

- [ ] **Step 4: Main composition with sequenced clips + audio bridge + motion blur**

```tsx
// video/src/templates/avatar-v5/AvatarV5Composition.tsx
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { AvatarV5Clip } from "./AvatarV5Clip";
import { AvatarV5HookOverlay } from "./AvatarV5HookOverlay";
import type { AvatarV5Props } from "./types";

const AUDIO_BRIDGE_FRAMES = 4;

export const AvatarV5Composition: React.FC<AvatarV5Props> = ({ clips, transitions, hook_text, fps }) => {
  const { width, height } = useVideoConfig();
  let cumulative = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {clips.map((clip, idx) => {
        const clipDurFrames = Math.round(clip.duration_s * fps);
        const startFrame = cumulative;
        // Audio bridge: shift this clip's START 4 frames earlier so its audio leads its visual cut.
        // First clip has no bridge.
        const visualFrom = idx === 0 ? startFrame : startFrame;
        const audioStartFrame = idx === 0 ? startFrame : startFrame - AUDIO_BRIDGE_FRAMES;
        cumulative += clipDurFrames;
        const motionBlur = idx > 0 && transitions[idx - 1]?.needs_motion_blur;
        return (
          <Sequence
            key={clip.id}
            from={Math.max(0, audioStartFrame)}
            durationInFrames={clipDurFrames + (idx === 0 ? 0 : AUDIO_BRIDGE_FRAMES)}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                filter: motionBlur ? "blur(8px) saturate(1)" : "none",
                // Apply blur only for the first 2-3 frames of the cut; switch off via CSS animation.
                animation: motionBlur ? "v5-blur-out 0.1s linear forwards" : undefined,
              }}
            >
              <AvatarV5Clip clip={clip} />
            </div>
          </Sequence>
        );
      })}
      <Sequence from={0} durationInFrames={Math.round(clips[0].duration_s * fps)}>
        <AvatarV5HookOverlay text={hook_text} />
      </Sequence>
      <style>{`
        @keyframes v5-blur-out {
          0% { filter: blur(8px) saturate(1); }
          100% { filter: blur(0); }
        }
      `}</style>
    </AbsoluteFill>
  );
};
```

Notes for execution:
- Remotion treats embedded audio in `OffthreadVideo` as passthrough by default (YAR-129 Finding 4 honored).
- Motion-blur as a CSS keyframe is a placeholder. If visual results are unsatisfactory, swap to frame-level blur via `@remotion/transitions` or per-frame canvas filter. Track in spec doc.
- Punch-in spacing constraint (max 2 per video, ≥4 s spacing) is enforced upstream in the orchestrator before the props are built — NOT in this component.

- [ ] **Step 5: Register composition in Root.tsx**

Open `video/src/Root.tsx` and add:

```tsx
import { AvatarV5Composition } from "./templates/avatar-v5/AvatarV5Composition";

// inside the Root component:
<Composition
  id="AvatarV5"
  component={AvatarV5Composition}
  width={1080}
  height={1920}
  fps={30}
  durationInFrames={30 * 60} // overridden per-render via calculateMetadata
  defaultProps={{ clips: [], transitions: [], hook_text: "", fps: 30 }}
/>
```

- [ ] **Step 6: Studio smoke test with fake data**

Generate a small test fixture (two 4-s sample MP4s with audio) and load in Remotion Studio. Verify: clips play with their own audio (no doubling), hook overlay readable in <1 s, motion-blur fires only on flagged cuts. Manual visual check.

```bash
cd video && npx remotion studio src/index.ts
```

- [ ] **Step 7: Commit**

```bash
git add video/src/templates/avatar-v5/ video/src/Root.tsx
git commit -m "feat(video): AvatarV5 Remotion composition w/ embedded-audio passthrough"
```

### Task 13: ~~Punch-in selector~~ — **DEFERRED to v5.1**

Cut from v5.0 scope per design call: punch-in is a confounding variable for the first proof-loop render. After v5.0 ships an approved Avatar Full piece, layer punch-in back in as v5.1 (selector module + `punch_in` field on `V5Clip` + scale branch in `AvatarV5Clip`). Tracked in `docs/specs/AVATAR_FULL_V5.md` "Follow-ups".

---

## Phase 7 — Orchestrator script

### Task 14: `render-avatar-full-v5.ts` orchestrator with hard gates

**Files:**
- Create: `video/scripts/render-avatar-full-v5.ts`

This is the entry point. Maps directly to spec Phases 0-6. Each phase is a function; the orchestrator runs them in order with explicit gates.

- [ ] **Step 1: Skeleton**

```typescript
// video/scripts/render-avatar-full-v5.ts
//
// Single CLI: npx tsx render-avatar-full-v5.ts <content_id>
//
// Hard gates between phases per YAR-129 v5 spec. Surfaces to Yaron on failure
// rather than auto-retrying beyond std → fast. No content_queue.status flip
// without human approval.

import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";

import { RACHEL_SOUL_STILL_URL, AVATAR_V5_DEFAULTS } from "../lib/avatar-constants.js";
import { generatePerClipMp3s } from "../lib/elevenlabs-per-clip.js";
import { buildMotionPrompt } from "../lib/motion-prompt-builder.js";
import { HiggsfieldSeedanceClient } from "../lib/seedance/higgsfield-client.js";
import { verifyAndRetry, makeWhisperFn } from "../lib/whisper-verifier.js";
import { measureFrames } from "../lib/face-metrics.js";
import { buildTransitionsManifest } from "../lib/transitions-manifest.js";
import { logCost } from "../lib/cost-tracker.js";
import { logPromptExecution } from "../../agents/lib/prompt_logger.js";
// Remotion render + ffmpeg concat helpers are below.

const CONTENT_ID = process.argv[2];
if (!CONTENT_ID) { console.error("usage: render-avatar-full-v5.ts <content_id>"); process.exit(2); }

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // === Phase 0: load row, verify pipeline can run ===
  const { data: row, error } = await supabase.from("content_queue")
    .select("id, hook, caption, content_pillar, avatar_config, metadata").eq("id", CONTENT_ID).single();
  if (error || !row) throw new Error(`content_queue ${CONTENT_ID} not found`);
  const clipsSpec = row.avatar_config?.clips;
  if (!Array.isArray(clipsSpec) || clipsSpec.length < 2) throw new Error("avatar_config.clips missing or < 2");
  const hook = row.avatar_config?.hook ?? row.hook;
  const register = row.avatar_config?.register ?? "concerned_insider"; // deepfakes default

  const workdir = path.join("/tmp", `avatar-v5-${CONTENT_ID}`);
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });

  const seedance = new HiggsfieldSeedanceClient();
  const whisper = makeWhisperFn();

  // === Phase 1: render clip 1 only ===
  const tts = await generatePerClipMp3s({ clips: clipsSpec, workdir });
  // Upload each MP3 to Supabase so Higgsfield can fetch by URL
  const mp3Urls = await uploadAll(supabase, tts);

  const clip1Result = await verifyAndRetry({
    clipId: clipsSpec[0].id,
    expectedScript: clipsSpec[0].expected_script,
    submitFn: async (mode) => {
      const res = await seedance.generateClip({
        start_image_url: RACHEL_SOUL_STILL_URL,
        audio_url: mp3Urls[0],
        motion_prompt: buildMotionPrompt({ register, script_excerpt: clipsSpec[0].expected_script }),
        aspect_ratio: AVATAR_V5_DEFAULTS.aspect_ratio,
        resolution: AVATAR_V5_DEFAULTS.resolution,
        duration_s: AVATAR_V5_DEFAULTS.duration_per_clip_s,
        mode,
      });
      await logCost(CONTENT_ID, "higgsfield", "seedance_2_0", 0, 0, res.cost_usd);
      return { job_id: res.job_id, video_url: res.video_url, mode_used: res.mode_used, cost_credits: res.cost_credits };
    },
    whisperFn: whisper,
    threshold: 0.15,
    content_id: CONTENT_ID,
  });

  if (!clip1Result.passed) {
    console.error(`CLIP 1 GATE FAILED — wer=${clip1Result.per_attempt.at(-1)?.wer}. Surfacing to human.`);
    process.exit(3);
  }
  console.log(`CLIP 1 GATE PASSED — wer=${clip1Result.final_wer}, mode=${clip1Result.per_attempt.at(-1)?.mode}, attempts=${clip1Result.attempts}`);

  // === Gate: surface clip 1 to Yaron before proceeding to 2-6 ===
  if (process.env.AVATAR_V5_AUTO_CONTINUE !== "1") {
    console.log(`\nClip 1 ready: ${clip1Result.final_video_url}`);
    console.log(`Set AVATAR_V5_AUTO_CONTINUE=1 and re-run with --resume-from=2 to continue.`);
    process.exit(0);
  }

  // === Phase 1b: clips 2..N ===
  const renderedClips = [{ id: clipsSpec[0].id, ...clip1Result }];
  for (let i = 1; i < clipsSpec.length; i++) {
    const spec = clipsSpec[i];
    const r = await verifyAndRetry({
      clipId: spec.id,
      expectedScript: spec.expected_script,
      submitFn: async (mode) => {
        const res = await seedance.generateClip({
          start_image_url: RACHEL_SOUL_STILL_URL,
          audio_url: mp3Urls[i],
          motion_prompt: buildMotionPrompt({ register, script_excerpt: spec.expected_script }),
          aspect_ratio: AVATAR_V5_DEFAULTS.aspect_ratio,
          resolution: AVATAR_V5_DEFAULTS.resolution,
          duration_s: spec.duration_target_s ?? AVATAR_V5_DEFAULTS.duration_per_clip_s,
          mode,
        });
        await logCost(CONTENT_ID, "higgsfield", "seedance_2_0", 0, 0, res.cost_usd);
        return { job_id: res.job_id, video_url: res.video_url, mode_used: res.mode_used, cost_credits: res.cost_credits };
      },
      whisperFn: whisper,
      threshold: 0.15,
      content_id: CONTENT_ID,
    });
    if (!r.passed) {
      console.error(`CLIP ${spec.id} GATE FAILED — surfacing to human.`);
      process.exit(3);
    }
    renderedClips.push({ id: spec.id, ...r });
  }

  // === Phase 3: OpenCV pass over first + last frame of each clip ===
  // ... extract frames via ffmpeg, call measureFrames, build manifest, etc.
  // (Full implementation in next steps.)

  // === Phase 4: Remotion composition ===
  // ... bundle + render via @remotion/renderer

  // === Phase 5: ffmpeg concat (handled inside Remotion render — single MP4 out) ===

  // === Phase 6: upload + surface to human review ===
  // ... upload final to Supabase post-images/avatar-full-v5/<content_id>/<run-ts>/final.mp4

  // === Phase 7: avatar-v1 QA agent (informational) ===
  // ... pipe into runAvatarFullQA with QAInput { clips, asset_path, reference_image_path: RACHEL_SOUL_STILL_URL → local }

  // === Phase 8: print summary ===
  console.log("READY FOR HUMAN REVIEW.");
}

main().catch((e) => { console.error(e); process.exit(1); });

async function uploadAll(supabase: any, tts: any[]) { /* see step 2 */ return []; }
```

- [ ] **Step 2: Fill in `uploadAll` (upload MP3s to Supabase post-images bucket)**

```typescript
import { readFileSync } from "node:fs";

async function uploadAll(supabase: any, tts: { clip_id: string; mp3_path: string }[]): Promise<string[]> {
  const urls: string[] = [];
  for (const t of tts) {
    const key = `avatar-full-v5/audio/${t.clip_id}-${Date.now()}.mp3`;
    const { error } = await supabase.storage.from("post-images").upload(key, readFileSync(t.mp3_path), {
      contentType: "audio/mpeg", upsert: true,
    });
    if (error) throw error;
    const { data } = supabase.storage.from("post-images").getPublicUrl(key);
    urls.push(data.publicUrl);
  }
  return urls;
}
```

- [ ] **Step 3: Frame extraction + face metrics (after Phase 1b)**

```typescript
import { execFileSync } from "node:child_process";

async function extractEndpointFrames(renderedClips: any[], workdir: string) {
  // For each rendered clip: download MP4 locally, extract first frame at 0.0s and last frame at (duration - 0.1s).
  const out: any[] = [];
  for (const r of renderedClips) {
    const localPath = path.join(workdir, `${r.id}.mp4`);
    // Download:
    const buf = new Uint8Array(await (await fetch(r.final_video_url)).arrayBuffer());
    require("node:fs").writeFileSync(localPath, buf);
    // Probe duration:
    const dur = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", localPath]).toString().trim());
    const startFrame = path.join(workdir, `${r.id}-start.png`);
    const endFrame = path.join(workdir, `${r.id}-end.png`);
    execFileSync("ffmpeg", ["-y", "-i", localPath, "-ss", "0.0", "-vframes", "1", startFrame]);
    execFileSync("ffmpeg", ["-y", "-i", localPath, "-ss", String(Math.max(0, dur - 0.1)), "-vframes", "1", endFrame]);
    out.push({ clip_id: r.id, start_frame_path: startFrame, end_frame_path: endFrame, duration_s: dur, local_mp4: localPath });
  }
  return out;
}
```

Then call `measureFrames` on the (2N) frame paths, group by clip_id, and call `buildTransitionsManifest`.

- [ ] **Step 4: Remotion bundle + render call**

```typescript
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

async function renderFinal(opts: { clips: any[]; transitions: any[]; hook: string; outPath: string }) {
  const bundleLocation = await bundle({ entryPoint: path.resolve("./src/index.ts") });
  const inputProps = { clips: opts.clips, transitions: opts.transitions, hook_text: opts.hook, fps: 30 };
  const composition = await selectComposition({ serveUrl: bundleLocation, id: "AvatarV5", inputProps });
  const totalFrames = opts.clips.reduce((a, c) => a + Math.round(c.duration_s * 30), 0);
  await renderMedia({
    composition: { ...composition, durationInFrames: totalFrames },
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: opts.outPath,
    inputProps,
  });
}
```

- [ ] **Step 5: Upload final + run avatar-v1 QA**

Upload final MP4 to `post-images/avatar-full-v5/<content_id>/<run-ts>/final.mp4`. Then construct a `QAInput` and call `runAvatarFullQA` from `video/qa/profiles/avatar-full.ts`. Persist the report to `qa_reports` table via the existing persistence helpers (already covered in PR #32).

- [ ] **Step 6: Print human-review summary**

End with a stdout block:

```
=== AVATAR FULL V5 — READY FOR HUMAN REVIEW ===
content_id        : <id>
final video       : <public URL>
clips             : N (std=A, fast=B)
WER scores        : [c1=0.04, c2=0.07, ...]
motion blur cuts  : [cut-1: yes (eye_delta=52px), cut-3: yes (face_delta=11%)]
hard cuts         : [cut-2, cut-4, cut-5]
punch-ins         : [c2 @ 8.0s (weight 9: shock beat "most parents have no idea")]
total cost        : $X.XX (Higgsfield Y credits)
qa report         : <id>  verdict=<v>  human_review_required=true
================================================
```

- [ ] **Step 7: Commit**

```bash
git add video/scripts/render-avatar-full-v5.ts
git commit -m "feat(video): render-avatar-full-v5 orchestrator with phase gates"
```

### Task 15: Mocked end-to-end orchestrator test

**Files:**
- Create: `video/scripts/__tests__/render-avatar-full-v5.test.ts`

Tests the gate logic end-to-end with `FakeSeedanceClient` and a stub Whisper. No real money spent.

- [ ] **Step 1: Write the test**

Test that:
1. Phase 1 failure (clip 1 WER fail twice) exits with code 3 and does NOT call submit for clips 2+.
2. Phase 1 pass + `AVATAR_V5_AUTO_CONTINUE=0` exits 0 after clip 1 and prints resume instructions.
3. Full pass produces a final.mp4 (use a fixture).

This requires refactoring the orchestrator to be importable (e.g. extract `runV5({ deps })` so the CLI is a thin shim). Do that refactor as part of this step.

- [ ] **Step 2: Refactor + run test — expect PASS**

- [ ] **Step 3: Commit**

```bash
git add video/scripts/render-avatar-full-v5.ts video/scripts/__tests__/render-avatar-full-v5.test.ts
git commit -m "test(video): orchestrator phase-gate coverage with fakes"
```

---

## Phase 8 — Documentation + CLAUDE.md

### Task 16: Operational doc

**Files:**
- Modify: `docs/specs/AVATAR_FULL_V5.md` (expand with full operational guide)
- Modify: `CLAUDE.md` (append Avatar Full v5 section under Video Pipeline)

- [ ] **Step 1: Write `docs/specs/AVATAR_FULL_V5.md` operational section**

Sections to write:
- Overview + how this differs from legacy HeyGen pipeline
- Pre-flight: env vars required (`HIGGSFIELD_API_KEY`, `ELEVENLABS_API_KEY`, Supabase, Python sidecar venv)
- How to run for a single piece
- Gate definitions (Phase 1 single-clip, Phase 1b, retry escalation)
- Cost ceiling enforcement
- Where outputs go (Supabase paths, DB tables touched, what's NOT touched)
- Surface-to-human path: what the reviewer sees and what they do to approve

- [ ] **Step 2: Append to `CLAUDE.md` under Video Pipeline**

```markdown
### Avatar Full v5 (Seedance)

Location: `/video/scripts/render-avatar-full-v5.ts`

The Seedance-based Avatar Full pipeline. Replaces the legacy HeyGen-based
`generate-avatar-video.ts`. Full operational doc: `/docs/specs/AVATAR_FULL_V5.md`.

Run:

    cd video && npx tsx scripts/render-avatar-full-v5.ts <content_id>

Hard gates between phases — clip 1 must pass Whisper WER before clips 2+ are
submitted. content_queue.status is NEVER flipped automatically; final video
surfaces to a human review queue.
```

- [ ] **Step 3: Commit**

```bash
git add docs/specs/AVATAR_FULL_V5.md CLAUDE.md
git commit -m "docs(avatar-v5): operational guide + CLAUDE.md pointer"
```

---

## Phase 9 — Acceptance render of deepfakes piece

**This phase spends real Higgsfield credits. Hard cost ceiling: $8 total. Auto-stops at $8 and surfaces to Yaron.**

### Task 17: Phase 1 — render clip 1 only (budget ~$0.65)

- [ ] **Step 1: Pre-flight check**

Confirm:
- `HIGGSFIELD_API_KEY` set
- `ELEVENLABS_API_KEY` set
- Soul-canonical Rachel URL fetches successfully (200 OK)
- Python sidecar `.venv` exists and mediapipe imports

Run:

```bash
cd video
curl -sI https://d2ol7oe51mr4n9.cloudfront.net/user_3DGDY5uQO2VTYDyY6tkVHLr8qE8/f757b09c-d94d-4ade-a076-4a1a496c641e.png | head -1
source ../bin/face-metrics/.venv/bin/activate && python3 -c "import mediapipe; print('mediapipe', mediapipe.__version__)"
```

Both must succeed.

- [ ] **Step 2: Run clip 1 only**

```bash
cd video
AVATAR_V5_AUTO_CONTINUE=0 npx tsx scripts/render-avatar-full-v5.ts aabf7fd2-f66a-4885-9675-19ab74df4acd
```

Expected: `CLIP 1 GATE PASSED — wer=<0.15>, mode=std, attempts=1`. If FAIL, do NOT proceed to clips 2+.

- [ ] **Step 3: Surface clip 1 to Yaron**

Post the clip 1 video URL + WER + cost. Pause until Yaron confirms it looks identity-faithful, register-correct (concerned_insider), and lip-sync-clean.

- [ ] **Step 4: Composition smoke test on clip 1**

Render clip 1 alone through `AvatarV5Composition` (just one clip, no transitions). Verify:
- Audio plays without drift (no doubling)
- Hook overlay readable in <1 s
- Crop-offset is 0 (single clip, no normalization needed)
- Punch-in test: if clip 1 is selected by punch-in selector, verify 115% scale doesn't drift identity

If any check fails: log failure mode, surface to Yaron. Do NOT spend on clips 2+.

### Task 18: Phase 1b — clips 2..N (budget ~$4)

- [ ] **Step 1: Resume orchestrator**

```bash
cd video
AVATAR_V5_AUTO_CONTINUE=1 npx tsx scripts/render-avatar-full-v5.ts aabf7fd2-f66a-4885-9675-19ab74df4acd
```

- [ ] **Step 2: Monitor per-clip gates**

Each clip's WER must pass. Retries to `fast` are automatic; second failure surfaces. Watch console for per-clip status.

- [ ] **Step 3: Verify total cost stays under $5 in Higgsfield credits**

If cumulative cost exceeds $5, the orchestrator should NOT auto-stop unless > $8. But surface a warning at $5 — the spec target is "under $5" with hard ceiling $8.

### Task 19: Composition + upload

- [ ] **Step 1: Verify composition output**

The orchestrator continues automatically into Phase 3-5 (face metrics → transitions manifest → Remotion render). Verify:
- Manifest written to `<workdir>/transitions-manifest.json`
- Final MP4 written to `<workdir>/final.mp4`
- Final MP4 uploaded to `post-images/avatar-full-v5/aabf7fd2-.../final.mp4`

- [ ] **Step 2: avatar-v1 QA agent runs (informational)**

The orchestrator pipes the final + clips into `runAvatarFullQA`. Output: a `QAReport` JSON. Verify `human_review_required: true` (always, while profile is informational per memory rule 29).

### Task 20: Surface to human review

- [ ] **Step 1: Post the summary**

Post the stdout summary block from Task 14 Step 6, plus:
- Render link (Supabase public URL)
- Transitions manifest summary (which cuts got motion blur, which were clean)
- Per-clip WER scores
- Punch-in placements with reasoning
- Total cost in Higgsfield credits and $
- avatar-v1 QA verdict (informational)

- [ ] **Step 2: Wait for Yaron's decision**

Yaron reviews and either:
- **Approves** → flip `content_queue.status` (separate, manual SQL or via approval UI; not in this script's scope).
- **Rejects** → log rejection reason to `prompt_executions` and surface design issues. NO auto-retry. NO row flip.

- [ ] **Step 3: Document the run**

If approved: link the final video URL to the YAR-129 acceptance criteria as evidence. If rejected: capture the rejection reason in a new YAR-129 comment for the next design iteration.

---

## Acceptance criteria

**Status: ✅ DONE — Avatar Full v5.0 shipped 2026-05-19.**

- [x] All build tasks (Phases 0-8) committed and tests passing.
- [x] `npx tsx --test video/lib/__tests__/*.test.ts video/src/templates/avatar-v5/__tests__/*.test.ts` green (75+ tests, 1 skipped integration-gated).
- [x] No HeyGen code touched. Legacy `generate-avatar-video.ts` still importable for reference. Retirement deferred to a follow-up cleanup PR.
- [x] Final video for `aabf7fd2-…` rendered and approved by Yaron via human eye-check (six iterations: clip_01 gate → full 7-clip render → defects 1+2 fix → YAR-137 spike → post-process normalization → trim + motion-blur review → phrase captions).
- [ ] avatar-v1 QA agent run — DEFERRED (informational only per memory rule 29; Yaron's eye-check was the binding gate). Can be run post-hoc on the final URL if telemetry is desired.
- [x] `cost_log` shows Higgsfield costs (orchestrator wrote per-clip).
- [x] `prompt_executions` ready for per-clip WER and retry-count rows (orchestrator infrastructure exists; Phase 9 acceptance run didn't write these — all 7 clips passed first-try std mode, no retries to log).
- [x] **`content_queue.aabf7fd2-…` updated 2026-05-19T16:13:04Z:**
  - `render_profile_id`: `a2cb2da6` (moving-images) → `d75fe12f` (avatar-v1) ✓ flipped after Yaron's approval
  - `metadata.video_url`: set to `…/avatar-full-v5/aabf7fd2-…/2026-05-19T16-01-59-299Z/final.mp4` ✓
  - `status`: `approved` (unchanged)
- [x] Total Phase 9 spend: **$6.91** Higgsfield credits ($6.90) + ~$0.013 OpenAI Whisper (verify + caption re-Whisper sweeps). Under the $8 soft ceiling; well under the 700cr hard ceiling.
- [x] All five YAR-129 findings encoded in pipeline code, validated against real Seedance output.
- [x] Architectural mitigation for YAR-137 (post-process normalization) committed and documented as required step.

## Defects surfaced + resolved during Phase 9

| # | Defect | Resolution | Commit |
|---|---|---|---|
| 1 | Hook overlay built from scratch instead of using locked SMTHookOverlay (top-positioned, drop-shadow style, persisted 9s) | Ported v3 SMTHookOverlay verbatim, then upgraded with rotation + edge bleed to match the canonical hook-card SVG design | 299db4c, 5810acb |
| 2 | `crop_offset_y` translate exposed black bars top/bottom (variable per clip — up to 80px on clip_05a) | Removed the translate; manifest keeps `crop_offset_y` as informational telemetry only | 299db4c |
| 3 | YAR-137 Seedance fidelity drift — `face_h` and `eye_y` vary ±150px across same-input renders | Architectural fix: per-clip ffmpeg scale+crop normalization between face-metrics and manifest. Brings face_h range from 127px → 16px, eye_y range from 115px → 2px | 4456aeb |
| 4 | Phrase captions missing from composition (Phase 6 planning miss — never built, never mounted) | Ported v3 `buildPhrasesForClip` as pure function, wrote AvatarV5Captions component (white, minimal shadow, bottom-third), wired into composition, re-Whispered clips to recover word timestamps | 48ccf14 |
| 5 | clip_05b tail had subject-drift artifact in final ~0.2s post-speech | ffmpeg `-c:v re-encode, -c:a copy` trim to 7.94s (last_word_end + 100ms safety margin). "judgment" preserved | (workdir clip overwrite, no commit) |
| 6 | Motion-blur threshold (40px eye-line) fired on 5 of 6 cuts after normalization made deltas tiny | Disabled motion blur on all 6 cuts as v5.0 default (uniform face position makes hard cuts clean); per-cut override remains via `transitions_manifest.transitions[i].needs_motion_blur=true` | (state-only, no code) |

## Cost-ceiling adjustments during Phase 9

- Original projection: 50 cr / clip × 7 = 350 cr → ceiling 400 cr.
- Phase 9 clip_01 actual: 81 cr at 1080p std. Ceiling raised: **400 → 600 cr** (commit 94d8d0c).
- YAR-137 spike re-rendered clip_02 + clip_05b: +153 cr. Ceiling raised: **600 → 700 cr** (commit 5810acb).
- Final spend: 531 cr ($6.90) — under all ceilings. Zero retries.

## Out of scope (separate plans / issues)

- **Punch-in pass (v5.1).** Selector module + `punch_in` field on `V5Clip` + scale branch in `AvatarV5Clip`. Layer in after v5.0 ships an approved Avatar Full piece. Heuristic to reuse: max 2 per video, ≥4s spacing, weighted by shock-word presence + content-writer weight.
- Full register-system schema extension (YAR-129 Gap 2 — `avatar_config.register`, ContentGen register-selection rules, wardrobe rotation).
- BytePlus-direct Seedance Lite swap (YAR-129 cost-architecture comment).
- Retiring the legacy HeyGen `generate-avatar-video.ts` (do AFTER v5 ships one approved piece).
- Approval UI integration (button to flip `content_queue.status` from the review surface).
- GitHub Actions automation of v5 (depends on Higgsfield HTTP / BytePlus transport being viable).
