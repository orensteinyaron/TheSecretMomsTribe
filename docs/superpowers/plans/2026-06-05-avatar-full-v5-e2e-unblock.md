# Avatar Full v5 — E2E Unblock + Clean Re-Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. TDD throughout: write the failing test first, watch it fail, implement minimally, watch it pass, commit.

**Goal:** Fix the six bugs the 2026-05-23 v5 e2e surfaced (YAR-143, 144, 147, 146, 145-L1, 142), then run one clean end-to-end Avatar Full piece with deterministic framing and a correctly closed render lifecycle. One branch, one PR, no merge.

**Architecture:** Six independent fixes on a single integration branch (`yarono/avatar-full-v5-e2e-unblock`), each TDD'd in isolation, followed by a manually-orchestrated e2e render of the test row with hard DB-verified gates at each stage.

**Tech Stack:** Node ESM (`agents/`), TypeScript via tsx (`video/`), Supabase (project `fvxaykkmzsbrggjgdfjj`), ElevenLabs TTS, Higgsfield MCP (Seedance 2.0 + Soul 2.0 + nano_banana_pro), Remotion, Whisper. Tests: `node:test` / `tsx --test` via `npm test`.

---

## Decisions locked (from spec + Yaron, 2026-06-05)

1. **Supersession (YAR-142):** Use the **existing metadata convention** — original row gets `status='superseded'` + `metadata.superseded_by=<newId>`; new row gets `metadata.regenerated_from=<originalId>`. **No `supersedes_id` column, no migration.** (Matches `scripts/regenerate-stale-drafts.js` + the PR #21 "Lifecycle Data Conventions".)
2. **Lifecycle close (YAR-145 L1):** Write in the **upload phase** (post-Remotion), columns **`render_status='complete'`, `final_asset_url`, `render_completed_at`** only. **Never** touch `render_profile_id` or `metadata.video_url` (preserves the locked DB-flip-on-approval invariant).
3. **Schema truth (corrects spec):** column is **`render_completed_at`** (not `rendered_at`); enum value is **`'complete'`** (not `'completed'`). A CHECK constraint (`render_complete_minimum_contract`) already requires `final_asset_url`+`render_completed_at` when status=`'complete'`.
4. **Historical records are immutable:** do **NOT** rewrite `9JqF6` in `docs/specs/PIECE_3BCAFC78_BACKFILL_V1.md` or `supabase/migrations/20260509190000_backfill_3bcafc78_showcase.sql` — they record what a shipped piece actually used.

---

## Audit-corrected file map (verified against live tree 2026-06-05)

| Fix | File(s) | What changes |
|--|--|--|
| YAR-143 | `agents/content.js:243` | Delete inline "Marry" character line in `OUTPUT_SCHEMA_INSTRUCTIONS`; canon (`FACE_OF_SMT_V1.md`: Rachel, 5/11/15) is sole source |
| YAR-144 | `FACE_OF_SMT_V1.md:213,249`; `agents/content.js:263,436`; `agents/skills/smt_content_text_gen/SKILL.md:134,193,264,312`; `video/qa/dimensions/ask-rachel/turn-taking-alignment.ts:4,20`; `video/qa/dimensions/ask-rachel/two-voice-presence.ts:3`; `video/scripts/render-avatar-full-v5.ts:233` (phaseTts); `video/lib/v5-state.ts` | `9JqF6→tRhabd` (live code/docs only); wire `voice_id` through state→phaseTts; data-fix SQL |
| YAR-147 | `video/lib/motion-prompt-builder.ts:19-22` (`FRAMING_LOCK`) | Strip "the kitchen counter" environment phrase |
| YAR-146 | `video/lib/wardrobe-rotation/pickers/pick-combination.ts`; `video/lib/v5-init-combination.ts`; `video/scripts/render-avatar-full-v5.ts` (phaseInit) | Honor pinned `look_id`/`location_id` from `avatar_config` |
| YAR-145-L1 | `video/scripts/render-avatar-full-v5.ts` (phaseUpload); backfill SQL | Write render-lifecycle columns; backfill legacy rows |
| YAR-142 | `agents/content.js` (main + new regenerate path) | `--content-id` / `--briefing-json` / `--force-profile` / `--dry-run` single-row regenerate |

**Pre-existing & already-correct (no change needed):** `video/lib/elevenlabs-per-clip.ts:50` already honors `opts.voice_id ?? RACHEL_ELEVENLABS_VOICE_ID`; `video/lib/avatar-constants.ts:18` already `tRhabd`; `rachel_looks`/`rachel_locations` already filtered `status='active'` by `listActiveLooks/Locations`.

---

## Task 1 — YAR-143: Remove hard-coded "Marry" + CI guard

**Files:**
- Modify: `agents/content.js:243` (inside `OUTPUT_SCHEMA_INSTRUCTIONS`)
- Create: `agents/lib/__tests__/no-hardcoded-character.test.js`
- Create: `scripts/check-no-hardcoded-character.js` (CI guard)
- Modify: root `package.json` scripts (add `lint:character`)

- [ ] **Step 1: Write the failing guard test.** `agents/lib/__tests__/no-hardcoded-character.test.js`: read `agents/content.js` as text; assert it does NOT match `/marry/i`; assert `OUTPUT_SCHEMA_INSTRUCTIONS` (import or regex-extract) contains no kids-ages tuple `(14, 9, 4)`. Also assert the canon file `FACE_OF_SMT_V1.md` contains "Rachel" and "5, 11, and 15".
- [ ] **Step 2: Run it — expect FAIL** (`marry` still present). `node --test agents/lib/__tests__/no-hardcoded-character.test.js`
- [ ] **Step 3: Delete the inline character line** at `agents/content.js:243`. Replace the `CHARACTER: Marry, 36, mom of three (14, 9, 4)...` sentence with a pointer comment only (e.g. `// CHARACTER identity comes from FACE_OF_SMT_V1.md (loaded via skill companions) — never inline here.`). Confirm the surrounding `OUTPUT_SCHEMA_INSTRUCTIONS` string still reads coherently (the personality guidance "NOT a teacher / gets frustrated" is canon-derivable; keep behavioral guidance but drop the name+ages identity claim, or rephrase to "Rachel" with no ages). Decision: keep the *voice/personality* sentence but bind it to Rachel and drop the false ages — reword to `Rachel is the friend in your group chat who always finds things out first. NOT a teacher. She gets frustrated, emotional, excited. NOT happy all the time.`
- [ ] **Step 4: Run the test — expect PASS.**
- [ ] **Step 5: Write the CI guard script** `scripts/check-no-hardcoded-character.js`: grep `agents/` recursively for `/marry/i` and for hard-coded kids-age tuples adjacent to "mom of three"; exit 1 with the offending file:line if found. Wire `"lint:character": "node scripts/check-no-hardcoded-character.js"` into `package.json` and append it to the `test` script chain (or document running it in CI).
- [ ] **Step 6: Run `npm run lint:character` — expect exit 0.**
- [ ] **Step 7: Run full `npm test`** to confirm no regression in existing content tests.
- [ ] **Step 8: Commit** — `fix(content): YAR-143 remove hard-coded "Marry"; canon is sole identity source + CI guard`

---

## Task 2 — YAR-144: Collapse voice_id onto tRhabd + make field load-bearing

**Files:**
- Modify (live docs/code only): `FACE_OF_SMT_V1.md:213,249`; `agents/content.js:263,436`; `agents/skills/smt_content_text_gen/SKILL.md:134,193,264,312`; `video/qa/dimensions/ask-rachel/turn-taking-alignment.ts:4,20`; `video/qa/dimensions/ask-rachel/two-voice-presence.ts:3`
- Modify: `video/lib/v5-state.ts` (add `voice_id?: string`), `video/scripts/render-avatar-full-v5.ts` (phaseInit reads `avatar_config.voice_id` → state; phaseTts passes it through)
- Create: `agents/lib/__tests__/voice-id-canon.test.js`; `video/lib/__tests__/v5-tts-voice-id.test.ts`
- Data-fix: SQL migration `supabase/migrations/<ts>_voice_id_canon_collapse.sql`

- [ ] **Step 1: Write failing canon test** `agents/lib/__tests__/voice-id-canon.test.js`: scan the **live** source set (the files listed above, excluding the two historical records) for `9JqF6OmJtGjHTDODKG2c`; assert zero hits. Assert `tRhabdS7JjlQ0lVEImuM` is present in `agents/content.js` fallback and `FACE_OF_SMT_V1.md`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Replace `9JqF6OmJtGjHTDODKG2c → tRhabdS7JjlQ0lVEImuM`** at every live location (use targeted edits, not blanket `replace_all` across the repo — historical records must stay). For `FACE_OF_SMT_V1.md:249` also update the voice-lab link text to note it points at tRhabd's profile (keep the generic `elevenlabs.io/app/voice-lab` URL if the per-voice URL is unknown). Keep "LOCKED" on `:213`.
- [ ] **Step 4: Run canon test — expect PASS.**
- [ ] **Step 5: Write failing renderer-wiring test** `video/lib/__tests__/v5-tts-voice-id.test.ts`: assert `V5State` type accepts `voice_id`; and (unit) that a phaseTts-shaped call forwards `state.voice_id` into `generatePerClipMp3s` opts. Prefer testing a small extracted pure helper `resolveTtsVoiceId(state)` returning `state.voice_id ?? undefined` so `generatePerClipMp3s` falls back to the constant when null.
- [ ] **Step 6: Run — expect FAIL.**
- [ ] **Step 7: Implement.** Add `voice_id?: string` to `V5State` (`video/lib/v5-state.ts`). In `phaseInit`, read `avCfg.voice_id` and pass into `initState({... voice_id: avCfg.voice_id ? String(avCfg.voice_id) : undefined})`. In `phaseTts` (`render-avatar-full-v5.ts:233`), change `generatePerClipMp3s({ clips, workdir })` → `generatePerClipMp3s({ clips, workdir, voice_id: state.voice_id })`. (`elevenlabs-per-clip.ts:50` already falls back to the constant when undefined — verified.)
- [ ] **Step 8: Run renderer-wiring test + full `npm test` — expect PASS.**
- [ ] **Step 9: Write the data-fix migration** `supabase/migrations/<ts>_voice_id_canon_collapse.sql`: `UPDATE content_queue SET avatar_config = jsonb_set(avatar_config,'{voice_id}','"tRhabdS7JjlQ0lVEImuM"') WHERE avatar_config->>'voice_id' = '9JqF6OmJtGjHTDODKG2c';` Include a header comment explaining the canon collapse. **Do NOT apply yet** — apply during the e2e pre-flight (Task 7) via the Supabase MCP, then verify zero remaining `9JqF6` rows with a SELECT.
- [ ] **Step 10: Commit** — `fix(avatar): YAR-144 collapse voice_id onto tRhabd; wire field through v5 renderer + data-fix migration`

---

## Task 3 — YAR-147: Stop the motion-prompt builder leaking environment text

**Files:**
- Modify: `video/lib/motion-prompt-builder.ts:19-22` (`FRAMING_LOCK`)
- Modify/Create test: `video/lib/__tests__/motion-prompt-builder.test.ts`

- [ ] **Step 1: Audit artifact (no code).** Document verbatim in the commit body what is currently sent to Seedance per clip: prompt = `FRAMING_LOCK + REGISTER_MARKERS[register] + BOUNDED_MOTION + 'She is speaking the line: "<excerpt>".'`; medias = `[start_image, audio]` only (per `video/lib/seedance/types.ts` — no env-reference role exists). Conclusion: the ONLY environment text is "the kitchen counter" in `FRAMING_LOCK`.
- [ ] **Step 2: Add failing test** to `motion-prompt-builder.test.ts`: `assert` that `buildMotionPrompt({register:'concerned_insider', script_excerpt:'x'})` contains none of `/kitchen|counter|cabinet|backsplash|island|wall|floor|fridge|stove|window/i`. Also assert it still contains the framing intent (`/medium close-up/i`, `/upper two-thirds/i`, `/camera position is locked/i`).
- [ ] **Step 3: Run — expect FAIL** (matches "kitchen counter").
- [ ] **Step 4: Edit `FRAMING_LOCK`.** Replace `"...her shoulders and the kitchen counter remain visible in the lower third."` → `"...her head and shoulders fill the frame, with her upper body visible in the lower third."` (no environment nouns; scene is carried entirely by `start_image`).
- [ ] **Step 5: Run the test — expect PASS.**
- [ ] **Step 6: Run full `npm test`.**
- [ ] **Step 7: Commit** — `fix(seedance): YAR-147 remove environment text from FRAMING_LOCK (framing-drift root cause)`

> Determinism proof is deferred to the e2e (Task 7, Step 4): render the test row twice and diff per-clip position + camera distance.

---

## Task 4 — YAR-146: Renderer honors pre-pinned look_id / location_id

**Files:**
- Modify: `video/lib/wardrobe-rotation/pickers/pick-combination.ts` (`PickCombinationInput` + `pickCombination`)
- Modify: `video/lib/v5-init-combination.ts` (`pickAndPersistCombination` reads pins via `deps.readAvatarConfig`, validates against active sets, passes to picker)
- Modify: `video/scripts/render-avatar-full-v5.ts` (phaseInit — pins flow automatically through `pickAndPersistCombination`; no signature change expected)
- Modify tests: `video/lib/wardrobe-rotation/__tests__/*pick-combination*.test.ts`, `video/lib/__tests__/v5-init-combination.test.ts`

- [ ] **Step 1: Failing unit test (picker).** In the pick-combination test: pin `look_id` to an active look + leave `location_id` undefined → assert result `look_id` equals the pin and `location_id` came from LRU. Pin both → assert both honored and LRU not consulted. Pin a non-active/unknown look → assert it throws (validation).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Extend `PickCombinationInput`** with optional `pinnedLookId?: string` / `pinnedLocationId?: string`. In `pickCombination`: if `pinnedLookId` set, validate it's in `activeLooks` (throw `pinned look_id <id> not active` otherwise) and use it; else `pickLook(...)`. Same for location against `activeLocations`. Still-lookup logic unchanged (find active still matching the resolved pair).
- [ ] **Step 4: Run picker test — expect PASS.**
- [ ] **Step 5: Failing wrapper test** (`v5-init-combination.test.ts`): stub `readAvatarConfig` to return `{location_id:'location_01'}` (look null) → assert `pickCombination` was called with `pinnedLocationId:'location_01'`, result persisted, and the pinned location still counts as a recent pick (LRU history unaffected — i.e. we don't skip the recency write).
- [ ] **Step 6: Run — expect FAIL.**
- [ ] **Step 7: Implement in `pickAndPersistCombination`.** Before calling `pickCombination`, read existing pins via the already-present `deps.readAvatarConfig(content_id)`; pass `pinnedLookId`/`pinnedLocationId` through. Keep the post-write re-SELECT verify. (Recency history is derived from `content_queue.updated_at` + `avatar_config.look_id/location_id` in `db.ts` — a pinned value written back is automatically counted next time; no extra code.)
- [ ] **Step 8: Run wrapper test + full `npm test` — expect PASS.**
- [ ] **Step 9: Commit** — `feat(avatar): YAR-146 v5 renderer honors pre-pinned look_id/location_id (LRU only fills nulls)`

---

## Task 5 — YAR-145 Layer 1: Renderer closes the render lifecycle

**Files:**
- Modify: `video/scripts/render-avatar-full-v5.ts` (phaseUpload — after successful Supabase upload + state save)
- Create test: `video/lib/__tests__/v5-upload-lifecycle.test.ts` (test a pure helper)
- Backfill SQL: `supabase/migrations/<ts>_backfill_render_lifecycle.sql`

- [ ] **Step 1: Failing test.** Extract a pure helper `buildRenderLifecyclePatch(finalPublicUrl: string, completedAtIso: string)` → `{ render_status:'complete', final_asset_url: finalPublicUrl, render_completed_at: completedAtIso }`. Test asserts exact shape + that it never includes `render_profile_id` or any `metadata` key (guards the DB-flip-on-approval invariant).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement helper + call it in phaseUpload.** After `state.final_public_url` is set and the existing metadata write succeeds, add a second `content_queue` update applying `buildRenderLifecyclePatch(state.final_public_url, new Date().toISOString())`. Keep it a **separate** update (so a metadata-write warning path still reaches the lifecycle write). Log the patch. Do NOT write `render_profile_id`/`metadata.video_url`.
- [ ] **Step 4: Run test + `npm test` — expect PASS.**
- [ ] **Step 5: Backfill migration.** `supabase/migrations/<ts>_backfill_render_lifecycle.sql`: for rows where a known final video URL exists in `metadata->>'video_url'` AND `final_asset_url IS NULL`, set `final_asset_url = metadata->>'video_url'`, `render_completed_at = COALESCE(render_completed_at, updated_at)`, `render_status='complete'`. **Guard with the CHECK constraint** (only flip status where both cols become non-null). **Do NOT apply blind** — in Task 7 pre-flight, first run a SELECT to count affected rows and eyeball them before applying.
- [ ] **Step 6: Commit** — `feat(avatar): YAR-145 L1 v5 renderer closes render lifecycle (render_status/final_asset_url/render_completed_at) + backfill`

---

## Task 6 — YAR-142: Single-row regenerate mode in content.js

**Files:**
- Modify: `agents/content.js` (add `parseArgs`, branch `main()` into `runBatch()` (existing) vs `runRegenerate(opts)`)
- Create: `agents/lib/regenerate-row.js` (pure-ish helper: build synthetic single-opportunity briefing from an existing row; supersession metadata builders)
- Create tests: `agents/lib/__tests__/regenerate-row.test.js`, `agents/lib/__tests__/content-args.test.js`

**Design:** No-flag path = byte-identical to today (greedy batch). With `--content-id`, bypass `getLatestBriefing()`: load the existing row, reconstruct a single-opportunity briefing from it (or from `--briefing-json`), run the **same** generate→validate→gates→write pipeline for exactly one piece, write a NEW row, mark the original `status='superseded'` + `metadata.superseded_by`, and set new row `metadata.regenerated_from`. Inherit `briefing_id`, `signal_id`, `source_urls`, `age_range`, `content_pillar` unless overridden. `--force-profile` overrides `render_profile_slug`. `--dry-run` prints proposed `avatar_config` + slides, no DB write.

- [ ] **Step 1: Failing arg-parse test** `content-args.test.js`: a `parseArgs(argv)` exported from content.js (or a small `agents/lib/cli-args.js`) returns `{contentId, briefingJson, forceProfile, dryRun}`; empty argv → all null/false (batch mode).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement `parseArgs`** (minimal flag parser; supports `--k=v` and `--flag`). Wire `main()`: `const args = parseArgs(process.argv.slice(2)); if (args.contentId) return runRegenerate(args); return runBatch();` Rename the current `main` body to `runBatch()` unchanged.
- [ ] **Step 4: Run arg test — expect PASS; run `npm test` to confirm batch path untouched.**
- [ ] **Step 5: Failing regenerate-helper tests** `regenerate-row.test.js`: `buildSyntheticBriefing(row, override?)` produces a one-opportunity briefing carrying the row's pillar/age/source_urls/hook context; `supersedeOriginalPatch(newId)` → `{status:'superseded', metadata:{...superseded_by:newId}}` (merges existing metadata, doesn't clobber); `regeneratedFromMetadata(originalId)` merges `regenerated_from`.
- [ ] **Step 6: Run — expect FAIL.**
- [ ] **Step 7: Implement `agents/lib/regenerate-row.js`** with those pure functions (metadata builders take prior metadata and return merged objects — never overwrite). **Crib the proven supersession/metadata-merge logic from `scripts/regenerate-stale-drafts.js` (~lines 449/490/505)** so semantics stay byte-identical to the existing convention — do not re-derive.
- [ ] **Step 8: Run helper tests — expect PASS.**
- [ ] **Step 9: Implement `runRegenerate(args)` in content.js.** Load row by id; build synthetic briefing (or parse `--briefing-json`); load skill; run the single-piece generation (reuse the existing batch-shaped entry points — `generateBatch`/`validateBatch`/`enforceBatchDiversity`/`enforceFormatGates`/`writeContentQueue` — on a 1-element array). **Guard `enforceBatchDiversity` for n=1** (it may be a no-op or could wrongly flag the lone piece — verify it doesn't reject a single-element batch). Apply `--force-profile` to the piece's `render_profile_slug` before validation if set; if `--dry-run`, print `{avatar_config, slides, render_profile_slug}` and return. Else: write the new row (reuse `buildContentQueueRow` + insert), then `update` the original with `supersedeOriginalPatch`, and patch the new row's metadata with `regeneratedFromMetadata`. Re-SELECT the new row and assert `metadata.regenerated_from` + inherited fields landed (symmetric post-check, operating rule #3).
- [ ] **Step 10: Run full `npm test`.**
- [ ] **Step 11: Manual `--dry-run` smoke** against the test row id (read-only) to confirm output shape.
- [ ] **Step 12: Commit** — `feat(content): YAR-142 single-row regenerate mode (--content-id/--briefing-json/--force-profile/--dry-run), metadata-versioned`

---

## Task 7 — The clean E2E run (from the feature branch, pre-merge)

> Manually orchestrated per `docs/specs/AVATAR_FULL_V5.md` phase sequence. Verify every write against the DB (operating rule #2), never logs. Apply the deferred migrations here, with a SELECT preview first.

- [ ] **Step 1 — Pre-flight (DB truth).**
  - Apply the Task 2 voice-id data-fix migration via Supabase MCP; SELECT-confirm zero `content_queue` rows with `avatar_config->>'voice_id'='9JqF6OmJtGjHTDODKG2c'`.
  - Preview + apply the Task 5 backfill; SELECT-confirm no `complete` row violates the CHECK constraint.
  - Confirm `location_01` in `rachel_locations`: `status='active'` + non-null `reference_image_url`.
  - `grep -rn '9JqF6\|[Mm]arry' agents/` → zero hits (excluding tests that assert their absence).
- [ ] **Step 2 — Regenerate content (dry-run → real).**
  - `node agents/content.js --content-id=a9be7ee0-6d38-46c8-9ca8-b6a728be4752 --force-profile=avatar-v1 --dry-run` → review avatar_config + slides. *(Note: confirm the canonical avatar render-profile slug — audit shows valid slugs are `avatar-v1`/`moving-images`/`static-image`/`carousel`; the spec wrote `avatar_full`. Use the real slug.)*
  - Pin location: `UPDATE content_queue SET avatar_config = jsonb_set(avatar_config,'{location_id}','"location_01"') WHERE id=<new row>` — but pinning must happen on the row the renderer reads. Sequence: real regenerate first (writes new row), then pin `location_id='location_01'` (leave `look_id` null) on the new row.
  - Real run (drop `--dry-run`) → new row with `metadata.regenerated_from = a9be7ee0…`; original marked `superseded`.
  - **Gate (DB query on new row):** `avatar_config.voice_id='tRhabdS7JjlQ0lVEImuM'`; character reads Rachel (never Marry); `render_profile_id` resolves to avatar profile; `metadata.regenerated_from` set; `location_id='location_01'`.
- [ ] **Step 3 — Render (audio-driven), per AVATAR_FULL_V5.md phases.**
  - `--phase=init` (pins honored: location_01 fixed, look LRU) → `--phase=tts` (voice tRhabd, per-clip MP3) → upload MP3s → per clip: MCP `generate_video` (Seedance, `medias=[start_image, audio]`) + `--phase=record` + `--phase=verify` → `--phase=face-metrics` → `--phase=normalize-clips` (MANDATORY) → `--phase=face-metrics` (re-measure) → `--phase=manifest` → `--phase=compose` → `--phase=upload` → `--phase=qa` → `--phase=summary`.
  - **Gate (DB query):** after `--phase=upload`, row has `render_status='complete'`, `final_asset_url` set, `render_completed_at` set; `render_profile_id` and `metadata.video_url` **untouched** (approval invariant intact).
- [ ] **Step 4 — Framing determinism (YAR-147 proof).** Render the same row a second time (fresh workdir). Diff per-clip opening face position + camera distance (use `face-metrics` outputs) across the two runs. Assert deterministic within normalization tolerance (≤2 px per-cut). If not deterministic → YAR-147 not fixed; STOP and report.
- [ ] **Step 5 — QA calibration.** Manually score 2–3 clips against the canonical reference still (identity markers + "matches reference" framing). Run the QA agent on all clips. If agent tracks manual → trust; else fix QA prompt first. Lip-sync returns **"unmeasured"** (YAR-130 not built — never a number).
- [ ] **Step 6 — Report to Yaron.** New row id; clip URLs; final.mp4 URL; QA scores (with "unmeasured" where applicable); framing-determinism result; total Higgsfield credits; one-line PASS/FAIL per gate. Then Yaron reviews the PR and merges.

---

## Definition of Done
- Clean 5-clip Avatar Full render of the test piece, identity-locked to Rachel via Soul pass-through.
- Framing (position + camera distance) deterministic across two runs.
- `voice_id=tRhabd` everywhere in live code/docs; zero `9JqF6`/"Marry" in `agents/` (historical records untouched).
- Lifecycle closed: `render_status='complete'`, `final_asset_url`, `render_completed_at` set; approval columns untouched.
- Regenerate flags work; daily-cron path byte-identical; all regression tests green (`npm test`).
- One PR open on `yarono/avatar-full-v5-e2e-unblock`, **not merged**. Results reported per Step 6.

---

## Per-task commit discipline
One commit per task (Tasks 1–6), each on `yarono/avatar-full-v5-e2e-unblock`. Co-author line on every commit:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```
Open the PR only after Task 6 is green and the Task 7 e2e has passed its gates. Claude Code never merges.
