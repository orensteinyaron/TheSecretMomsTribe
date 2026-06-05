# Avatar Full v5 — Seedance pipeline

**Status: v5.0 SHIPPED 2026-05-19.** First approved Avatar Full render: `content_queue.aabf7fd2-f66a-4885-9675-19ab74df4acd` ("AI deepfakes are already in your kid's school. Most parents have no idea.") at [post-images/avatar-full-v5/aabf7fd2-…/2026-05-19T16-01-59-299Z/final.mp4](https://fvxaykkmzsbrggjgdfjj.supabase.co/storage/v1/object/public/post-images/avatar-full-v5/aabf7fd2-f66a-4885-9675-19ab74df4acd/2026-05-19T16-01-59-299Z/final.mp4). Replaces the legacy HeyGen-based Avatar Full pipeline (`video/scripts/generate-avatar-video.ts`, slated for retirement in a separate cleanup PR).

This document is the **canonical technical spec** for the Avatar Full v5 pipeline. Every Avatar Full render from this point forward must conform to the rules below. If the rendered output ever diverges from what this doc describes, the bug is in the renderer, not the doc.

**Build plan:** [`docs/superpowers/plans/2026-05-19-avatar-full-v5-seedance-pipeline.md`](../superpowers/plans/2026-05-19-avatar-full-v5-seedance-pipeline.md) (acceptance criteria marked DONE).

**Authoritative inputs:**
- Linear [YAR-129](https://linear.app/yarono/issue/YAR-129) session-learnings comment (5 findings from 2026-05-18 proof loop)
- Linear [YAR-137](https://linear.app/yarono/issue/YAR-137) (Seedance fidelity drift + post-process normalization mitigation, 2026-05-19)
- Phase 9 acceptance-render session, 2026-05-19 (six iterations + final ship; ~$6.91 total Higgsfield + Whisper spend)

---

## Lessons learned (May 18 + May 19 2026 sessions)

The pipeline below is the consolidation of two working sessions that surfaced and resolved 12+ defects against Seedance, Remotion, and the v3-era Avatar Full implementation. Read this section first — it's the "why" behind every rule downstream.

### From 2026-05-18 (manual proof loop on the deepfakes piece — see YAR-129 session-learnings)

1. **Chain pattern is architecturally incompatible with Seedance audio role.** Using a prior clip's last frame as the next clip's `start_image` (with audio supplied) caused Seedance to hallucinate audio at a ~0/3 honor rate (vs ~5/7 for Soul-canonical reference). Position continuity is now solved at composition time (normalization + hard cuts), NOT at generation time. **Never re-attempt the chain pattern.**
2. **Framing-lock language is required in every motion prompt.** Without it, Seedance drifts camera framing across clips. `motion-prompt-builder.ts` always emits: "Medium close-up framing held throughout … Camera position is locked, no zoom in or out, no pan." Mandatory, not optional.
3. **Use bounded-motion language, NOT pose-lock.** "Subtle natural motion within a small envelope, not large posture shifts" reads as natural. "Pose is locked" or "torso position is locked" reads as frozen/AI. Tests in `motion-prompt-builder.test.ts` assert the forbidden language never appears.
4. **Remotion is video-only — embedded-audio passthrough, no `<Audio>` re-overlay.** v1/v2/v3 muted `OffthreadVideo` (`volume={0}`) and overlaid the original ElevenLabs MP3 via `<Audio>`. Result: lips tracked Seedance's internal audio, ears heard the offset MP3, drift on every clip. Composition layer keeps Seedance's embedded audio canonical.
5. **Seedance audio role reliability is non-deterministic.** Same input can hallucinate. Mandatory: **post-render Whisper verify + std→fast→surface retry escalation per clip.** Threshold `WER < 0.15` AND `speech_coverage ≥ 0.5`. The verifier lives at `video/lib/whisper-verifier.ts`.

### From 2026-05-19 (Phase 9 acceptance render — see YAR-137 + commit log)

6. **Post-process normalization is mandatory.** Seedance produces ±150 px variation in opening face position/size from the same Soul still + same prompt (YAR-137). `normalize-clips.ts` runs AFTER `--phase=face-metrics` and BEFORE `--phase=manifest`. It scales+crops each clip to a uniform face_h + eye_y target; audio passthrough preserved via `-c:a copy`. Reduces face_h range ~127 px → ~16 px, eye_y range ~115 px → ~2 px. This is the architectural fix to fidelity drift — prompt language alone is a partial mitigation, not a substitute.
7. **Hook overlay = locked SMTHookOverlay design with rotation + edge bleed.** The canonical visual is the **hook-card SVG** in `generate-hook-card.ts` (rotated purple band with off-frame bleed), NOT the flat edge-to-edge SMTHookOverlay variant from v3. Required: `transform: rotate(-2deg)`, `left/right: -100px` for edge bleed (so rotation corners don't expose canvas), `top: 68%` for lower-third positioning, **1.0 s hard cut in/out** on clip 1 only. Helvetica Neue bold 124 px UPPERCASE for primary, 44 px for secondary. Lives at `video/src/templates/shared/SMTHookOverlay.tsx`.
8. **Phrase captions are part of every render.** Whisper word-level timestamps from the **Seedance MP4 embedded audio** (NOT the original ElevenLabs MP3 — Finding 4 makes that the only correct source). Grouped via `video/lib/phrase-grouper.ts` (MAX_WORDS=4, GAP_THRESHOLD=0.3s — pure port of v3's `buildPhrasesForClip`). Rendered via `video/src/templates/avatar-v5/AvatarV5Captions.tsx`: white Inter Bold 52 px UPPERCASE, `paddingBottom: 140`, **minimal drop shadow `0 2px 2px rgba(0,0,0,0.6)`** for legibility (Yaron's "no shadow" instruction meant no decorative shadow, NOT zero shadow on white-text-over-Rachel's-hair).
9. **Tail trim — check last 0.5s of every clip for drift artifacts before compose.** Seedance occasionally drifts the subject toward `end_image` in the final ~0.2–0.4 s. Use ffmpeg `-c:v libx264 -c:a copy` (re-encodes video, preserves audio bit-for-bit) to trim to `last_whisper_word.end + 0.1 s`. Stream copy WILL drop the video stream if no keyframe is near the trim boundary — always re-encode the video on a trim.
10. **Motion blur defaults to disabled when normalization is applied.** The 40 px eye-line threshold was tuned for raw Seedance variance; post-process normalization makes per-cut deltas ≤ 2 px, so blur fires on cuts that visually don't need it. v5 defaults `needs_motion_blur: false` on every cut. Per-cut override remains available via `transitions_manifest.transitions[i].needs_motion_blur=true`.
11. **Audio bridge = 4-frame Sequence overlap.** Clip N+1's `<Sequence from=…>` starts 4 frames before clip N's nominal end (`AUDIO_BRIDGE_FRAMES = 4`). Both `OffthreadVideo` elements play for those 4 frames; audio mixes briefly (~133 ms) at the cut. This is the bridge — NOT a separate `<Audio>` track (which would violate Finding 4). Per-cut `bridge_enabled: false` flag exists for boundaries that sound rough.
12. **Cost reality.** 9 s std clip at 1080p ≈ **81 Higgsfield credits** (~$1.05), not the 50 cr we projected. 7-clip Avatar Full ≈ **531 cr ($6.90)** at std baseline with zero retries. Ceiling sized at **700 cr (~$9.10)** allowing one fast-retry margin per piece. Re-encode + Whisper passes add ~$0.013. Total per-piece envelope ≈ $7.

### Process learnings — propagate into every future Avatar Full design

13. **Grep for prior art before building any new component.** Two defects in the Phase 9 session (SMTHookOverlay rotation+bleed and the missing phrase captions) were the same shape: components designed from partial spec readings rather than auditing what v3 actually rendered. Future Avatar component design must include a "grep v3 for existing component" step.
14. **Cost projections need single-clip empirical data before sizing budgets.** The 50→81 cr/clip surprise made the 400 cr ceiling untenable mid-render. Future renders: probe one clip cost before sizing the full budget.
15. **Architecture beats prompt engineering for fidelity.** YAR-137 distance-lock prompt language partially worked but didn't fully constrain. The scale+crop post-process closed the gap entirely. When in doubt between "tune the prompt" and "fix it in composition," prefer composition.

---

## Transport

**v5.0 transport: Higgsfield MCP `generate_video` tool (model `seedance_2_0`).**

Per [Seedance 2.0 model card](https://higgsfield.ai/models/seedance_2_0) (probed via Higgsfield MCP `models_explore`):

```
model       seedance_2_0
output      video
medias      roles: [image, start_image, end_image, video, audio]
parameters  resolution (1080p), mode (std|fast), genre, aspect_ratio (9:16)
duration    4-15 s
notes       no generate_audio param — audio supplied via medias only
```

Avatar Full v5 always submits:

```json
{
  "model": "seedance_2_0",
  "params": {
    "prompt": "<motion prompt from motion-prompt-builder>",
    "aspect_ratio": "9:16",
    "resolution": "1080p",
    "duration": 8,
    "mode": "std",
    "medias": [
      { "role": "start_image", "value": "<state.start_image_url from v5-state.json>" },
      { "role": "audio", "value": "<per-clip ElevenLabs MP3 URL>" }
    ]
  }
}
```

**PR-B (YAR-136):** `start_image` is no longer the single canonical Rachel still. `phaseInit` resolves a wardrobe × location combination via `pickCombination` (wardrobe-rotation skill) and writes the chosen `look_id` / `location_id` / `still_id` back to `content_queue.avatar_config`. `state.start_image_url` is the resulting `rachel_stills.soul_still_url`, which is a Soul-2.0 identity-locked Rachel image (nano_banana_pro composition anchor + Soul-pass-through — see [video/lib/location/flows/generate-anchored-still.ts](video/lib/location/flows/generate-anchored-still.ts)). Every render now uses a different wardrobe + location combination; identity is locked to canonical Rachel via Soul. Audio flow unchanged.

`mode` escalates `std → fast → surface-to-human` per Whisper WER gate (Finding 5).

---

## Why MCP for v5.0

No documented Higgsfield HTTP API in this codebase, and no `HIGGSFIELD_API_KEY` precedent in env. The MCP `generate_video` tool is the working surface. Building a brittle Node→Claude→MCP proxy creates more risk than value for a pipeline that has not yet rendered approval-grade output.

The cost-architecture comment on YAR-129 documents a planned spike to validate hybrid Soul (Higgsfield) + Seedance Lite (BytePlus direct) routing. That spike unblocks unattended automation. v5.0 ships locally-triggered renders driven from a Claude Code session; v5.x adopts the future transport against the same `SeedanceClient` interface.

---

## Orchestration model

The v5 render is **hybrid** — Claude Code session + Node helpers.

### Claude Code session owns
- Reading `content_queue.avatar_config.clips[]`
- Per-clip Seedance submission via Higgsfield MCP `generate_video`
- Per-clip retry escalation (std → fast → surface)
- Pausing for human-review gate after clip 1
- Final hand-off to human-review queue

### Node helpers own (under `video/lib/*` + `video/scripts/render-avatar-full-v5.ts --phase=<name>`)
- Per-clip ElevenLabs TTS (`video/lib/elevenlabs-per-clip.ts`)
- MP3 upload to Supabase `post-images/avatar-full-v5/audio/`
- Whisper WER verification (`video/lib/whisper-verifier.ts`)
- Frame extraction via ffmpeg
- Face metrics via Python+mediapipe sidecar (`video/lib/face-metrics.ts` → `bin/face-metrics/main.py`)
- **Post-process normalization** (`video/scripts/normalize-clips.ts`) — REQUIRED between `--phase=face-metrics` and `--phase=manifest`. See "Post-process normalization" section below.
- Transitions manifest builder (`video/lib/transitions-manifest.ts`)
- Motion-prompt builder (`video/lib/motion-prompt-builder.ts`)
- Remotion composition `AvatarV5Composition` (`video/src/templates/avatar-v5/`)
- ffmpeg concat → final MP4
- Supabase upload of final MP4 to `post-images/avatar-full-v5/<content_id>/<run-ts>/final.mp4`
- avatar-v1 QA agent invocation (`video/qa/profiles/avatar-full.ts`)
- `cost_log` and `prompt_executions` writes

---

## Post-process normalization (REQUIRED, between face-metrics and manifest)

**Architectural mitigation for [YAR-137](https://linear.app/yarono/issue/YAR-137)** — Seedance start_image fidelity drift. The same Soul still produces meaningfully different opening pose/distance across renders (subject size + eye position varies up to ~150 px from identical input). Prompt language (YAR-137 spike) nudges Seedance but does not fully constrain it. The structural fix is **per-clip scale+crop in the composition pipeline**, not in the generation pipeline.

### When to run

After `--phase=face-metrics`, before `--phase=manifest`:

```
… → MCP generate_video → --phase=record → --phase=verify (per clip)
… → --phase=face-metrics          (measures raw Seedance output)
… → npx tsx scripts/normalize-clips.ts <workdir>   ← REQUIRED
… → --phase=face-metrics          (re-measure on normalized clips)
… → --phase=manifest → --phase=compose → … 
```

### What it does

`video/scripts/normalize-clips.ts`:
1. Picks `target_face_h = max(face_h across clips) × 1.08` — ensures every clip scales UP (no letterbox).
2. For each PASS clip, computes:
   - `scale = target_face_h / clip.face_h`
   - `crop_x = clip.face_x × scale − 540` (face center at x=540)
   - `crop_y = clip.eye_y × scale − 600` (eyeline at y=600 ≈ ⅓ from top)
3. Runs ffmpeg `scale=W:H,crop=1080:1920:cropX:cropY` per clip.
4. Audio passthrough via `-c:a copy` — bit-for-bit copy, Whisper-verified bytes unchanged.
5. Originals backed up to `clips/orig/<id>.mp4` before overwriting.
6. Wipes `state.face_metrics` and `state.transitions_manifest` so the next `--phase=face-metrics` re-measures the normalized clips.

### Why this works

Verified on the deepfakes acceptance render:

| | Before normalization | After |
|---|---:|---:|
| `face_h` range across 7 clips | 127 px | 16 px |
| `start_eye_y` range | 115 px | 2 px |
| Cuts flagged for motion blur | 5 of 6 | 0 of 6 |

Motion blur effectively becomes opt-in (per-cut override in `transitions_manifest.transitions[i].needs_motion_blur=true`) rather than the default-on safety net.

### Trade-offs

- **Content loss at edges**: 9–25 % of horizontal/vertical content cropped depending on per-clip scale. Acceptable for medium close-up framing where the subject already fills the upper two-thirds.
- **Re-encode generational loss**: video re-encodes at h264 CRF 18 (small; should be invisible). Audio is bit-for-bit copy.
- **Static crop based on START frame**: intra-clip face drift WITHIN a single clip is NOT corrected. Acceptable since the motion-prompt builder's bounded-motion language keeps intra-clip drift small.

### Out of scope for v5.0

- Time-varying crop (face tracking per frame). Would correct intra-clip drift too. Filed for v5.x evaluation.
- Replacing Seedance with a model that has explicit subject-distance control. Tracked on YAR-137.

---

## Hook overlay (SMTHookOverlay — locked design)

**Component:** `video/src/templates/shared/SMTHookOverlay.tsx`

Aligned with the canonical `generate-hook-card.ts` SVG (Option A — rotated purple band with off-frame bleed). The v3-era React component dropped the rotation and bleed; v5 restores them so the video overlay matches the static thumbnail.

**Locked properties (do not drift — change the spec, the component, AND `generate-hook-card.ts` together or none):**

| Property | Value |
|---|---|
| Position | `top: 68%` (block center ≈ 78 % from top, lower-third) |
| Width | Edge bleed: `left: -100 px, right: -100 px` (block is 1280 px wide on 1080 px frame, so rotation corners never expose canvas) |
| Rotation | `transform: rotate(-2deg)` (matches hook-card SVG `rotate(-2 540 1500)`) |
| Background | `#63246a` (`BRAND_PURPLE`) |
| Primary text | Helvetica Neue, 900 weight, **auto-sized** via `hookPrimaryFontSize()` (124 / 108 / 92 px by length tier), letter-spacing 4, UPPERCASE, `#fcfcfa` |
| Secondary text (optional) | Helvetica Neue, 600 weight, 44 px, letter-spacing 1, UPPERCASE, `#fcfcfa`, opacity 0.95 |
| Text safe-width | both lines `maxWidth = 90 % × frame width` (`HOOK_SAFE_WIDTH_FRAC`) + `overflowWrap` — **text never bleeds off-frame** (only the purple block does) |

**Text never clips (added after the dcd87826 e2e):** the dominant line's font size is a pure, tested function of the headline's length — `hookPrimaryFontSize()` in `video/lib/hook-overlay-fit.ts` (tiers: ≤12 chars → 124 px, ≤18 → 108, else 92). Both text lines are clamped to 90 % of the frame width. This is the **single source of sizing** shared by the React component AND the `generate-hook-card.ts` SVG (which sources the same fn + caps its `textLength` at the safe width). The earlier fixed `124 px` with no width bound let a wide line ("BEST PARENTING") render into the −100 px bleed and clip at both edges.
| Duration | 1.0 s (`durationSec` default) — hard cut in, hard cut out, NO fade |
| Mount point | Clip 1 only, wrapped in a 30-frame (`AVATAR_V5_FPS × 1.0`) `<Sequence from={0}>` in `AvatarV5Composition` |

**Text split for the deepfakes piece (canonical example):** `primary="DEEPFAKES"`, `secondary="ARE ALREADY IN YOUR KID'S SCHOOL"`. Driven by `avatar_config.hook_primary` + `avatar_config.hook_secondary`; falls back to `defaultHookSplit(hook_text)` in `v5-state.ts:initState` which splits on the first ". " of the full hook sentence.

**ContentGen contract (future):** when ContentGen learns to emit Avatar Full pieces directly, it must emit `avatar_config.hook_primary` and `avatar_config.hook_secondary` explicitly (don't rely on the heuristic split — write the headline+qualifier intent).

---

## Clip duration budget (audio-matched, never crammed)

**Module:** `video/lib/clip-duration.ts` (pure, tested) + `video/lib/audio-trim.ts`. Added after the dcd87826 e2e, where clips authored with 5–9 s `duration_target_s` estimates had 8–15.5 s of real TTS audio. Seedance renders **exactly** the requested `duration` and crams the audio in (speed-up, garbled voice); audio > 15 s **hard-fails** the job.

**Rule: the measured TTS audio length is the source of truth for clip duration. The LLM `duration_target_s` is advisory only.** Constants: `SEEDANCE_MAX_CLIP_S=15`, `CHARS_PER_SECOND=14` (eleven_v3 calibration), `CLIP_TAIL_S=1`, `MAX_AUDIO_S=13.5`, `TRIM_TOLERANCE_S=1.0`, `PLAN_TARGET_S=12.0` (conservative split target).

Cascade (matches the human policy: *plan to fit → trim a small miss → split otherwise*):
1. **`phaseInit` plans to fit** — `planClips()` splits any clip whose `estimateAudioSeconds(script) > 12 s` into sentence-boundary sub-clips with stable suffixed ids (`clip_03` → `clip_03a`, `clip_03b`). Downstream phases reference `clip.id` generically, so suffixes need no other change.
2. **`phaseTts` measures + salvages** — after each MP3, `probeDurationSeconds` → `needsSilenceTrim`: *fits* keep; *trimmable* (≤ `MAX_AUDIO_S + TRIM_TOLERANCE_S`) → `trimSilenceToFit` (ffmpeg `silenceremove`, leading/trailing) then re-measure; *mustSplit* (gross miss past the plan margin) → throw a clear calibration error. Persists `clip.tts_audio_s` + `clip.submit_duration_s = seedanceDurationForAudio()` = `min(15, ceil(audio)+1)` (the `+1` tail also keeps the inter-clip audio bridge from cutting the last word).
3. **Submission reads `submit_duration_s`** — the per-clip Seedance `duration` MUST come from `clip.submit_duration_s`, never `duration_target_s`.
4. **`phaseVerify` anti-cram backstop** — if a rendered clip's audio is < 90 % of `tts_audio_s`, it's marked `FAIL_CRAMMED` and routed through the standard retry/surface escalation — never silently shipped.

---

## Phrase captions (AvatarV5Captions + phrase-grouper)

**Component:** `video/src/templates/avatar-v5/AvatarV5Captions.tsx`
**Grouper:** `video/lib/phrase-grouper.ts` (pure function, 10 hermetic tests in `__tests__/`)
**Source of timestamps:** Whisper word-level output from the SEEDANCE MP4 audio. **Never use the original ElevenLabs MP3** — caption timing must track what the viewer hears, and Seedance's audio role re-encoding can introduce small offsets relative to the source MP3 (Finding 4).

**Phrase grouping rules (ported verbatim from v3 `buildPhrasesForClip`):**
- `MAX_WORDS_PER_PHRASE = 4` — hard cap; split earlier never longer
- `PAUSE_SPLIT_THRESHOLD_S = 0.3` — strict greater-than; if the gap between two consecutive Whisper words exceeds 0.3 s, end the current phrase before the next word
- Output: array of `{ text, start_s, end_s }` with clip-local times

**Caption rendering rules (locked):**

| Property | Value |
|---|---|
| Color | `#FFFFFF` |
| Font | `"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif` (CSS fallback chain — do NOT use `@remotion/google-fonts/Inter` loadFont, it drags a nested Remotion into the CLI graph and triggers a version-mismatch fatal at script startup) |
| Weight | 700 |
| Size | 52 px |
| Case | UPPERCASE |
| Letter-spacing | 2 px |
| Max-width | 950 px (forces wrap before edges; lineHeight 1.25) |
| Position | `paddingBottom: 140` from bottom edge — above the brand-watermark area |
| Shadow | `0 2px 2px rgba(0,0,0,0.6)` — **minimal** drop shadow for legibility on Rachel's hair or light kitchen backgrounds. Yaron's "no shadow" instruction meant "no decorative chunky shadow", NOT zero shadow. Calibrated 2026-05-19. |
| Per-phrase fade | 3 frames in + 3 frames out |
| Mount point | Inside each clip's `<Sequence>` (siblings to `AvatarV5Clip`), so Remotion's Sequence offset handles the global-time math automatically |

**State persistence:** `--phase=verify` writes `clip.whisper_words: WhisperWord[]` and `clip.phrases: Phrase[]` to `v5-state.json`. Compose reads from `clip.phrases` and passes through to the Remotion `inputProps`.

---

## Audio bridge between clips (no `<Audio>` re-overlay)

**Implementation:** `video/src/templates/avatar-v5/AvatarV5Composition.tsx:layoutClips`

`AUDIO_BRIDGE_FRAMES = 4`. For each clip `i ≥ 1`, the clip's `<Sequence from=…>` starts 4 frames before clip `i-1`'s nominal end (unless `transitions_manifest.transitions[i-1].bridge_enabled === false`). Both `OffthreadVideo` elements play simultaneously for the 4-frame overlap; audio mixes briefly (~133 ms at 30 fps).

This is the bridge — NOT a separate `<Audio>` track. Per Finding 4, any second audio source would violate the embedded-audio-passthrough invariant. The Sequence-overlap mechanism keeps both audio tracks coming from `OffthreadVideo`.

**Per-cut override:** set `transitions_manifest.transitions[i].bridge_enabled = false` to make that specific cut a strict hard boundary (no overlap, no mix). Useful when a bridge sounds rough after eye-check.

**Default:** all cuts have `bridge_enabled = true` (default in manifest builder).

---

## Tail trim — check last 0.5 s of every clip pre-compose

Seedance occasionally drifts the subject toward an implicit `end_image` in the final ~0.2–0.4 s of a clip (the "settling-toward-end" artifact). For every PASS clip, eye-check the last frame against the start frame; if visible drift, trim.

**Trim command (canonical):**
```bash
ffmpeg -y -i input.mp4 \
  -t <target_end_seconds> \
  -c:v libx264 -preset slow -crf 18 \
  -c:a copy \
  -movflags +faststart \
  output.mp4
```

`-c:v libx264` re-encodes the video (necessary — stream-copy `-c:v copy` will drop the video stream if no keyframe is near the trim boundary, observed during clip_05b trim on 2026-05-19). `-c:a copy` preserves the Whisper-verified audio bit-for-bit.

**Trim ceiling:** `target_end = last_whisper_word.end + 0.1 s` (100 ms safety margin). Going further risks cutting into the spoken line — verify with a follow-up Whisper transcribe that the final word is intact before proceeding.

**Tooling:** the deepfakes clip_05b trim was done by hand in workdir during Phase 9. A reusable `--phase=tail-trim` could be added in v5.x — currently inline / manual.

---

## Motion blur policy

**v5.0 default: motion blur DISABLED on all cuts.**

Rationale: `normalize-clips.ts` makes per-cut eye-line deltas ≤ 2 px and face-center deltas ≤ 2 %. The original 40 px / 8 % thresholds in `transitions-manifest.ts` were tuned for raw Seedance variance; against normalized clips, the thresholds never fire AND the blur isn't visually needed (hard cuts read clean when face position is uniform).

The manifest still computes `needs_motion_blur` from the (now-small) deltas, but the orchestrator overrides ALL transitions to `needs_motion_blur: false` by default for the compose phase.

**Per-cut re-enable:** if eye-check surfaces a single rough cut, set `transitions_manifest.transitions[i].needs_motion_blur = true` in `v5-state.json` before re-composing. `AvatarV5Clip` applies a 3-frame CSS `blur(8px)` ramp on the flagged cut's outgoing/incoming frames.

### What the SeedanceClient interface buys us
`video/lib/seedance/SeedanceClient.ts` defines the boundary:

```ts
interface SeedanceClient {
  generateClip(params: ClipParams): Promise<ClipResult>;
}
```

- `FakeSeedanceClient` covers the test path (no network, no MCP).
- For v5.0 real renders, this interface has no production HTTP implementation — the Claude Code session is the implementation.
- For v5.x, a `HttpSeedanceClient` (or `BytePlusClient`) lands as a drop-in replacement.

When the HTTP implementation exists, `render-avatar-full-v5.ts` gains a `--phase=seedance` subcommand and the playbook becomes optional.

---

## Why not Node CLI orchestrator today

A Node CLI cannot invoke MCP tools — MCP is Claude-session-scoped. Three workarounds exist; all are worse than the hybrid approach above:

| Approach | Problem |
|---|---|
| Long-running Claude subprocess piped to Node via stdin/stdout | Fragile (auth refresh, process supervision, hung-process recovery) for a pipeline that still has a per-clip human-review gate today |
| Print-and-paste (Node prints "submit this", human pastes result back) | Slows the inner loop without buying anything — the human is already supervising via the Claude Code session |
| Headless `claude` CLI invocation per Seedance call | Same fragility as the subprocess approach, slower (boots a session per call) |

The hybrid pattern keeps Node helpers cleanly testable, isolates MCP to the orchestration layer, and gives us a clear forward path.

---

## Pre-flight (manual, before any render)

1. `HIGGSFIELD` MCP server is loaded in the Claude Code session (verify via `mcp__78d93fcf-…__models_explore`).
2. `ELEVENLABS_API_KEY` set in environment.
3. Supabase service-role key (`SUPABASE_SERVICE_ROLE_KEY`) set.
4. Python sidecar venv ready: `cd bin/face-metrics && source .venv/bin/activate && python3 -c "import mediapipe"`.
5. Soul-canonical Rachel CDN URL fetches 200: `curl -sI https://d2ol7oe51mr4n9.cloudfront.net/user_3DGDY5uQO2VTYDyY6tkVHLr8qE8/f757b09c-d94d-4ade-a076-4a1a496c641e.png`.
6. `ffmpeg` and `ffprobe` on PATH.

---

## Cost ceilings

| Bucket | Target | Hard ceiling |
|---|---|---|
| Phase 1 (clip 1 only) | ~$0.65 (one std attempt) | $1.50 (allows one std + one fast retry) |
| Phase 1b (clips 2..N) | ~$4.55 (six std attempts at 50cr each) | $9 |
| Phase 2-7 (Whisper, face metrics, Remotion, ffmpeg, Supabase, QA) | ~$0.65 (mostly QA Sonnet) | $1.50 |
| **Total — target** | **under $6** | — |
| **Total — soft ceiling** | — | **~$10 (orchestrator warns)** |
| **Total — HARD ceiling** | — | **~600 Higgsfield credits — orchestrator auto-stops, surfaces to Yaron before continuing** |

Whisper, ffmpeg, Supabase, mediapipe are effectively free. The cost is Higgsfield credits + Sonnet QA + ElevenLabs character spend. Hard ceiling sized against the ACTUAL clip_01 cost observed in the deepfakes acceptance run (81 cr at 1080p std, not the original 50cr/clip estimate): 7 × 81 = 567cr, ceiling 600cr leaves ~33cr (one fast-retry's worth) of margin. If any clip needs more than one retry the ceiling trips and we re-decide. Revisable per-piece if/when a different clip-count case ships.

---

## What v5.0 does NOT touch

- `content_queue.status` — the row stays at `pending` (or whatever pre-existing state). Approval flips happen manually after human review.
- `content_queue.metadata.video_url` — until human approval.
- The legacy HeyGen `generate-avatar-video.ts` — still importable, retired in a separate cleanup PR after v5 ships an approved piece.

---

## Outputs

| Artifact | Location |
|---|---|
| Per-clip ElevenLabs MP3 | Supabase `post-images/avatar-full-v5/audio/<clip_id>-<ts>.mp3` |
| Per-clip Seedance MP4 (intermediate) | Higgsfield CDN (job result URL) |
| Per-clip Whisper transcript + WER | `prompt_executions` (per-clip row, `agent_run_id` linked) |
| Transitions manifest | `<workdir>/transitions-manifest.json` (kept locally for debugging) |
| Final composited MP4 | Supabase `post-images/avatar-full-v5/<content_id>/<run-ts>/final.mp4` |
| **Caption + Whisper telemetry** | **`content_queue.<id>.metadata.phrases` + `metadata.whisper_words`** — written automatically by `--phase=upload`. See "Upload contract" below. |
| avatar-v1 QA report | `qa_reports` table |
| All costs | `cost_log` (per-vendor, per-step) |
| Human-review summary | stdout at end of render |

---

## Upload contract (`--phase=upload` DB writes)

`--phase=upload` is the boundary where workdir state crosses into permanent DB storage. After this phase the row IS the source of truth for downstream consumers (approval UI, caption editor, analytics) — `workdir/v5-state.json` is just scratch and may be deleted.

### What `--phase=upload` writes

| Column | Field | Value | Behavior |
|---|---|---|---|
| Storage | `post-images/avatar-full-v5/<content_id>/<run-ts>/final.mp4` | Final MP4 (compressed by the orchestrator before upload) | Always written; new run-ts each invocation so prior renders aren't overwritten |
| `content_queue.metadata` | `phrases` | Flat array — one entry per phrase across all PASS clips: `{ clip_id, phrase_text, start_s, end_s }` | Merged into existing metadata jsonb; clip-local timestamps |
| `content_queue.metadata` | `whisper_words` | Per-clip array: `{ clip_id, duration_s, transcript, words: [{word, start, end}] }` | Merged into existing metadata jsonb; clip-local timestamps |

### What `--phase=upload` does NOT touch (DB-flip-on-approval invariant)

- `content_queue.status` — flips only on human approval
- `content_queue.render_profile_id` — flips only on human approval (the row was tagged with the ORIGINAL profile by ContentGen; the upload doesn't claim the render is canonical until a human says so)
- `content_queue.metadata.video_url` — set on human approval, NOT here. The orchestrator's final URL stays in `v5-state.json` until the reviewer copies it forward via the approval flow.
- Existing `metadata.*` fields (`image_axes`, `format_flags`, `density_classification`, etc.) — preserved via spread merge

### Why phrases + whisper_words live on the row, not in workdir

The workdir is scratch — created in `/tmp` per render, often cleaned up by the OS. Persisting these to the row enables:

- **Approval UI rendering** without re-running Whisper on every preview
- **Caption editing tools** (future) that can read existing phrases, allow per-phrase edits, write back, and the renderer re-composes from the modified `metadata.phrases`
- **Re-render with caption-only changes** (no Seedance credits) — read `metadata.phrases` instead of re-Whispering
- **Downstream analytics** — phrase-level engagement, caption A/B testing, etc.

Storage cost is negligible: ~16 KB JSON per piece for a 7-clip Avatar Full at 60 s duration. 1000 pieces ≈ 16 MB total — well under any jsonb sanity limit.

### Schema notes for downstream consumers

- **Timestamps are clip-local**, not composition-global. `start_s = 0` means "the start of clip X" not "the start of the final video". To compute composition-global time, the consumer must walk the clips in order and account for the 4-frame audio-bridge overlap per cut (see "Audio bridge between clips" section).
- **Phrase text is mixed-case** as Whisper produced it (e.g. `"Okay wait"`, not `"OKAY WAIT"`). The `AvatarV5Captions` component applies `textTransform: uppercase` at render time. Downstream consumers that want the as-rendered string should uppercase themselves; tools that want to edit captions get the natural case to work with.
- **Phrase boundaries follow the `phrase-grouper.ts` rules** (MAX_WORDS=4 hard cap, GAP_THRESHOLD=0.3s pause split). A caption editor that wants to merge or split phrases should regenerate the array rather than expecting these rules to be re-applied.

---

## Follow-ups (post-v5.0)

These are deliberately excluded from v5.0. After the first Avatar Full piece ships approval-grade:

- **v5.1 — punch-in pass.** Add `punch-in-selector.ts` (max 2 punch-ins, ≥4s spacing, weighted by shock-word presence + content-writer weight). Add `punch_in: boolean` field to `V5Clip`. Add `transform: scale(1.15)` branch in `AvatarV5Clip` gated on `punch_in`. Reason for deferring: punch-in is a confounding variable for the first proof-loop render — if v5.0 has lip-sync or identity drift on a 115%-scaled emphasis line, we can't isolate the contributing cause.
- **v5.2 — register system schema** (YAR-129 Gap 2). Extend `avatar_config` with `register`, `hands_visible`, `framing`, `wardrobe_look_id`, `setting`. Move register selection from hardcoded `concerned_insider` into ContentGen SKILL.md rules.
- **v5.3 — BytePlus-direct Seedance Lite.** Implement `HttpSeedanceClient` (or `BytePlusClient`) against the `SeedanceClient` interface. Per YAR-129 cost-architecture comment: validate cost reduction vs Higgsfield-routed Seedance.
- **v5.4 — GitHub Actions automation.** Depends on v5.3. Orchestrator becomes a full Node CLI; playbook becomes optional.
- **Retire legacy HeyGen.** Delete `video/scripts/generate-avatar-video.ts` and HeyGen-specific helpers. Update tests.
- **Approval UI integration.** Surface the v5 render in the existing piece-page approval UI with a "promote to published" action that flips `content_queue.status` and `metadata.video_url`.
