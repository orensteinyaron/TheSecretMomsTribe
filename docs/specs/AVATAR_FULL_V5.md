# Avatar Full v5 — Seedance pipeline

**Status:** v5.0 in build. Replaces the legacy HeyGen-based Avatar Full pipeline (`video/scripts/generate-avatar-video.ts`). First acceptance render: `content_queue.id = aabf7fd2-f66a-4885-9675-19ab74df4acd` ("AI deepfakes are already in your kid's school. Most parents have no idea.").

**Build plan:** [`docs/superpowers/plans/2026-05-19-avatar-full-v5-seedance-pipeline.md`](../superpowers/plans/2026-05-19-avatar-full-v5-seedance-pipeline.md)

**Authoritative inputs:**
- Linear `YAR-129` session-learnings comment (5 findings from 2026-05-18 proof loop)
- YAR-129 issue body (register system, `avatar_config` schema gaps — Gap 2 deferred from v5.0)

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
      { "role": "start_image", "value": "<Soul-canonical Rachel CDN URL>" },
      { "role": "audio", "value": "<per-clip ElevenLabs MP3 URL>" }
    ]
  }
}
```

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
- Transitions manifest builder (`video/lib/transitions-manifest.ts`)
- Motion-prompt builder (`video/lib/motion-prompt-builder.ts`)
- Remotion composition `AvatarV5Composition` (`video/src/templates/avatar-v5/`)
- ffmpeg concat → final MP4
- Supabase upload of final MP4 to `post-images/avatar-full-v5/<content_id>/<run-ts>/final.mp4`
- avatar-v1 QA agent invocation (`video/qa/profiles/avatar-full.ts`)
- `cost_log` and `prompt_executions` writes

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
| avatar-v1 QA report | `qa_reports` table |
| All costs | `cost_log` (per-vendor, per-step) |
| Human-review summary | stdout at end of render |

---

## Follow-ups (post-v5.0)

These are deliberately excluded from v5.0. After the first Avatar Full piece ships approval-grade:

- **v5.1 — punch-in pass.** Add `punch-in-selector.ts` (max 2 punch-ins, ≥4s spacing, weighted by shock-word presence + content-writer weight). Add `punch_in: boolean` field to `V5Clip`. Add `transform: scale(1.15)` branch in `AvatarV5Clip` gated on `punch_in`. Reason for deferring: punch-in is a confounding variable for the first proof-loop render — if v5.0 has lip-sync or identity drift on a 115%-scaled emphasis line, we can't isolate the contributing cause.
- **v5.2 — register system schema** (YAR-129 Gap 2). Extend `avatar_config` with `register`, `hands_visible`, `framing`, `wardrobe_look_id`, `setting`. Move register selection from hardcoded `concerned_insider` into ContentGen SKILL.md rules.
- **v5.3 — BytePlus-direct Seedance Lite.** Implement `HttpSeedanceClient` (or `BytePlusClient`) against the `SeedanceClient` interface. Per YAR-129 cost-architecture comment: validate cost reduction vs Higgsfield-routed Seedance.
- **v5.4 — GitHub Actions automation.** Depends on v5.3. Orchestrator becomes a full Node CLI; playbook becomes optional.
- **Retire legacy HeyGen.** Delete `video/scripts/generate-avatar-video.ts` and HeyGen-specific helpers. Update tests.
- **Approval UI integration.** Surface the v5 render in the existing piece-page approval UI with a "promote to published" action that flips `content_queue.status` and `metadata.video_url`.
