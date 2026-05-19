# Per-profile QA agents

Replaces the monolithic `video/scripts/qa-agent-avatar.ts` and `video/scripts/qa-agent.ts` with per-render-profile QA agents driven by a shared base contract and per-profile dimension declarations stored in `render_profiles`.

Spec parent: [YAR-129](https://linear.app/yarono/issue/YAR-129).

## What ships in PR 1 + PR 2

PR 1 (merged):
- Base QA contract (`base/qa-contract.ts`, `schemas/`).
- 7 base dimensions implementing the cross-profile checks (`dimensions/base/*`).
- Avatar Full profile agent + 5 net-new avatar-specific dimensions + 3 UNMEASURED stubs (`profiles/avatar-full.ts`, `dimensions/avatar-full/*`).
- Composite-dispatch entry point (`run.ts`).
- Markdown report renderer + `cost_log` persistence.
- `agents/render-orchestrator.js` rewired to call the new entry point for Avatar Full.
- Integration tests against the v1 broken and v3 known-good fixtures.

PR 2 (this PR):
- Moving Images profile agent (`profiles/moving-images.ts`) + 4 dims (3 measured: `b_roll_relevance`, `image_coherence`, `ken_burns_smoothness`; 1 UNMEASURED stub: `phrase_caption_timing`).
- Slide-segmentation helper (`base/helpers/slide-segmentation.ts`) that reconstructs per-slide windows from the composited mp4 + Whisper transcript — no upstream pipeline change required.
- `agents/render-orchestrator.js` qaVideo rewired to call new entry point with `--profile moving-images`.
- `video/scripts/qa-agent.ts` replaced with a deprecation shim.
- Calibration harness against production fixture `d93e2bcd-5665-469f-9b53-e839a1f06b13`.
- Migrations: `phrase_caption_timing` + `color_filter_consistency` + `transition_style_verification` declared UNMEASURED on `moving-images` (the latter two require Moving Images-specific implementations — base implementations work on raw-clip metadata which doesn't exist for slideshows).

Not in PR 2: Ask Rachel / Avatar+Visual / Static Image / Carousel (PR 3), real lip-sync analysis ([YAR-130](https://linear.app/yarono/issue/YAR-130)), OCR helper for `phrase_caption_timing` graduation, Moving Images-specific color + transition impls.

## Architecture

```
qa/
├── base/
│   ├── qa-contract.ts        # types: QAInput, RenderProfileConfig, ClipMeta
│   └── helpers/
│       ├── frame-sampling.ts # extractFrameTo, startMiddleEnd, framesAroundTimestamp
│       ├── wer.ts            # word error rate (audio integrity)
│       ├── color-lab.ts      # LAB color stats (filter consistency)
│       ├── transition-signature.ts  # frame-diff pattern (cut vs crossfade)
│       ├── pixel-region-check.ts    # watermark presence
│       └── profile-config.ts # load render_profiles row from Supabase
├── dimensions/
│   ├── base/                 # 7 cross-profile dimensions
│   └── avatar-full/          # 5 measured + 3 UNMEASURED for avatar-v1
├── profiles/
│   └── avatar-full.ts        # orchestrates dimensions, returns QAReport
├── schemas/
│   ├── qa-dimension.ts       # DimensionResult, DimensionCall, status enum
│   └── qa-report.ts          # QAReport, CostSummary, verdict derivation
├── report/
│   ├── render-markdown.ts    # human-readable report
│   └── persist-cost-log.ts   # cost_log persistence
├── run.ts                    # CLI entry point + composite dispatch
└── __tests__/
    ├── helpers.test.ts
    ├── avatar-full.v1-broken.test.ts
    └── avatar-full.v3.test.ts
```

## Running locally

```bash
cd video

npx tsx qa/run.ts \
  --asset /tmp/avatar.mp4 \
  --profile avatar-v1 \
  --metadata /tmp/metadata.json \
  [--content-id <uuid>] \
  [--keep-workdir]
```

`metadata.json`:

```json
{
  "asset_id": "uuid|null",
  "reference_image_url": "https://...",
  "clips": [
    {
      "id": "SCENE_01",
      "url": "https://...",
      "expected_script": "verbatim ElevenLabs script",
      "duration_s": 9,
      "start_offset_in_final_s": 0
    }
  ],
  "hook_overlay_text": { "line1": "DEEPFAKES", "line2": "OF YOUR KID" }
}
```

Outputs:
- Markdown report → `<cwd>/qa-reports/<asset_id>_<timestamp>.md` and stdout.
- JSON report → `<cwd>/qa-reports/<asset_id>_<timestamp>.json`.
- Cost rows in `cost_log` (pipeline_stage='qa_v3').

## How dimensions work

Each dimension is a self-contained module exporting `runXxx(input): Promise<DimensionResult>`. Dimensions don't know about each other. The profile agent orchestrates which dimensions to run based on `render_profiles.qa_rules`:

- `in_scope_dimensions[]` — measure and score every run.
- `unmeasured_dimensions[]` — return `{ status: 'UNMEASURED' }` with a structured reason. Per memory rule 30: never fabricate a score on a dimension the agent cannot measure.
- `out_of_scope_dimensions[]` — silently skip (not applicable to this profile).

A dimension graduates from UNMEASURED to in-scope via a **single SQL UPDATE** on `render_profiles.qa_rules` once its implementation is ready — no agent rewrite required.

## Adding a new dimension

1. Implement the dimension in `dimensions/<profile-or-base>/<name>.ts` exporting `runXxx(input): Promise<DimensionResult>`.
2. Add the canonical name to `schemas/qa-dimension.ts` `DIMENSION_NAMES`.
3. Wire into the relevant profile agent (`profiles/<slug>.ts`).
4. Update the relevant `render_profiles` rows' `qa_rules.in_scope_dimensions` array via SQL.
5. Document the dimension's check + threshold in this README under "Dimensions" below.

## Dimensions implemented in PR 1

### Base (cross-profile)

| Dimension | Model | Method | PASS threshold |
|---|---|---|---|
| `watermark_compliance` | none | pixel variance in bottom-right (87%-99% x, 88%-98% y) | variance ≥ 200 |
| `audio_integrity_raw_clips` | Whisper | per raw clip: WER vs expected script; speech coverage ≥ 50% of clip duration | WER ≤ 15% AND coverage ≥ 50% per clip |
| `audio_integrity_final` | Whisper | ffprobe audio stream count + Whisper WER vs concatenated script | exactly 1 stream AND WER ≤ 15% |
| `caption_legibility` | Haiku vision | 5 evenly-spaced frames; check captions in profile's `caption_region` are present, readable, not obscuring face | ≥ 80% sampled frames PASS |
| `color_filter_consistency` | none | LAB stats on matched raw + composited frames; judge against declared `filter_setting` | depends on filter (see `color-lab.ts` `judgeFilter`) |
| `transition_style_verification` | none | 5-frame signature around each transition; pattern-match cut vs crossfade | all transitions match declared `transition_style.type` |
| `hook_overlay_style` | UNMEASURED | OCR + color check (to be implemented post-v3 merge) | n/a |

### Avatar Full (`avatar-v1` profile, `full_avatar` variant)

| Dimension | Model | Method | PASS threshold |
|---|---|---|---|
| `identity_consistency` | Sonnet vision | ref + 3 frames/clip, score 0-5 on face only | every clip ≥ 4.0 |
| `identity_markers` | Haiku vision | ref + 1 frame/clip, enumerate markers, score symmetric agreement | min-frame score per clip ≥ 3 |
| `hand_naturalism` | Haiku vision | middle frame/clip; count fingers, check accessories | zero ARTIFACT verdicts |
| `wardrobe_setting_continuity` | Sonnet vision | first frame of each clip vs clip 1; same wardrobe + setting + lighting | all clips match clip 1 |
| `cross_clip_drift` | Sonnet vision | one call, ref + middle frame of each clip; identify identity / hair / bg / framing drift across the set | verdict not FAIL |
| `lip_sync` | UNMEASURED | MFCC + mouth ROI cross-correlation (YAR-130 spike) | n/a |
| `register_adherence` | UNMEASURED | per-register marker enumeration; gated on `avatar_config.register` shipping | n/a |

### Moving Images (`moving-images` profile)

Base dims applying: `watermark_compliance`, `audio_integrity_final`, `caption_legibility`. Base dims declared UNMEASURED for this profile: `color_filter_consistency`, `transition_style_verification` (need Moving Images-specific impls; base impls require raw-clip metadata which slideshow renders don't produce). Plus `hook_overlay_style` UNMEASURED (graduates with v3 merge).

| Dimension | Model | Method | PASS threshold |
|---|---|---|---|
| `b_roll_relevance` | Haiku vision | per slide segment, judge image vs spoken line | every segment ≥ 3/5 |
| `image_coherence` | Sonnet vision | one call, gestalt across all segment images | overall ≥ 3/5 |
| `ken_burns_smoothness` | none (det) | frame-diff timeline across content window | zero freeze runs ≥ 0.8s; no excess spikes |
| `phrase_caption_timing` | UNMEASURED | Whisper word-timestamp vs caption render-timestamp (needs OCR helper) | n/a |

**Slide segmentation:** the agent reconstructs slide windows from frame-diff peaks on the composited mp4 (no upstream pipeline change required). Threshold: diff > 3× median AND > 8 absolute. Segments with < 2 spoken words are skipped from `b_roll_relevance` (silent gaps don't carry script context).

## Sampling rules

QA does not run on 100% of every profile. Sampling rates per profile:

| Profile | Sampling rate | Why |
|---|---|---|
| `avatar-v1` | **100%** | Highest defect-cost profile; v1/v2 produced unflagged audio defects; full coverage required during stabilization. |
| `moving-images` | **25%** | Baseline for stabilized production pipeline. Sampling reviewed monthly. |
| `static-image` | 100% | Low call cost (~$0.01/run); always run. |
| `carousel` | 100% | Low call cost (~$0.22/run); always run. |
| Ask Rachel / Avatar+Visual | 100% | Variants of Avatar Full; share its sampling rate while in stabilization. |

**Sampling escalation rule.** Any production-published asset of a profile that exhibits a defect the QA agent should have caught → bump that profile's sampling rate to **100% for 30 days**, then re-evaluate. Document the escalation in the QA monitoring section of the weekly Linear review.

## Promotion: informational → decisional

Every profile starts at `qa_stability.state='informational'`. In this state:

- `human_review_required: true` on every report.
- `overall_verdict='PASS'` is informational only — orchestrator does not auto-publish.
- Yaron's eyes are the gate. Per memory rule 29: automated QA pass without human review is worthless during profile stabilization.

A profile graduates to `qa_stability.state='decisional'` after **5 consecutive human-approved outputs over a 2-week observation window** with zero false-pass dimensions. Promotion is a manual SQL UPDATE on the profile's `qa_stability` jsonb. The 5-and-2-week threshold is per YAR-129.

## Monitoring requirements

Three metrics are tracked per profile per day in the Linear weekly review until promotion to decisional:

1. **`vision_call_retry_count`** — count of JSON-parse retries across all dimensions. Surfaced in the report's `cost_summary.retries`. Sustained increase indicates model drift on structured-JSON output.
2. **Per-profile actual vs projected cost.** Daily roll-up from `cost_log` filtered by `pipeline_stage='qa_v3'`. Compare to the projection in [PR 1 cost report](#cost-budget--alert-threshold). Drift > 30% = surface before next merge.
3. **Per-dimension PASS/FAIL rate.** If a dimension PASSes 100% of runs over 2 weeks AND humans never override, the threshold may be too lenient. If a dimension FAILs > 30% of human-approved runs, the threshold is too strict. Both directions feed dimension re-calibration.

## Cost budget & alert threshold

PR 1 cost projection (per the report posted in PR 1):

| Profile | Per-run cost | Sampling | Daily contribution (2 pieces/day per profile) |
|---|---|---|---|
| Avatar Full | ~$0.47 | 100% | ~$0.94 |
| Moving Images | ~$0.09 | 25% | ~$0.05 |
| Static Image | ~$0.01 | 100% | ~$0.02 |
| Carousel | ~$0.22 | 100% | ~$0.44 |
| **Projected daily total at full cadence** | | | **~$1.45** (worst-case mix) |

**Alert threshold: $1.50/day.** If `cost_log` rolling-7-day average for `pipeline_stage='qa_v3'` crosses $1.50/day, surface before merging the next QA change so we can re-prioritize which dimensions to defer.

Known future expansion (~$0.30/day by Q3): lip_sync graduates from UNMEASURED via [YAR-130](https://linear.app/yarono/issue/YAR-130), register_adherence graduates once `avatar_config.register` ships. Tracked as expected expansion, not surprise overrun.

## Calibration methodology

A dimension is "calibration-ready" when:

1. It produces a deterministic verdict on a known-good fixture (e.g. v3 deepfakes after human approval).
2. It produces a deterministic verdict on a known-broken fixture (e.g. v1 deepfakes raw clips 02 and 05a fail `audio_integrity_raw_clips`).
3. Its threshold is documented in this README with the calibration rationale.
4. Its per-run cost is within the projection table above.

If a dimension fails 1 or 2, the implementation is broken — not the threshold. Fix the implementation; the threshold is calibrated against PASS+FAIL fixtures, not pulled out of the air.

## Migration path from the legacy QA scripts

- `video/scripts/qa-agent-avatar.ts` is preserved as a thin shim that translates its CLI args into a call to `video/qa/run.ts --profile avatar-v1`. Removed at the end of PR 3 after all callers migrate.
- `video/scripts/qa-agent.ts` is replaced by per-profile dispatch via `agents/render-orchestrator.js`. PR 1 rewires the Avatar Full path; PR 2 rewires the non-avatar path; the legacy script is removed at the end of PR 2.
