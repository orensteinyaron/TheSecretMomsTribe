# Piece Page Data Flow Audit & Repair — Spec V2

> **POST-EXECUTION REVISION 2026-05-09:** §4.3 (Drive-aware piece page Render preview) was dropped from execution scope after pre-flight discovered the lifecycle UI is not on `main`. The 784-line `ContentDetailPage.tsx` lifecycle UI lives only in dirty WIP — main has a 261-line V0 page with no lifecycle sections. V1 and V2 both treated the UI as shipped based on dev-environment screenshots; that was incorrect. The backend audit (§4.1, §4.2, §4.4, §4.5) executed as planned; §4.3's resolveOutputUrls hardening and RenderPanel iframe handling moved to a separate Linear epic, "Land lifecycle piece-page UI on main", which ships the UI itself plus the Drive-aware Render preview as one coherent change. See that epic for the UI landing plan; this section stays in place as the spec for what the eventual UI must do.
>
> **Acceptance test revision:** §5 step 4 (open piece page, screenshot all sections) and step 5 (3bcafc78 iframe play-through) were dropped — there is no UI to render against. Replaced with a direct Supabase query confirming all four sections' data is present at the row level. The UI rendering them is the separate epic's acceptance test.

**Date:** May 9, 2026 (re-spec, late afternoon)
**Target branch:** `fix/piece-page-data-flow-audit` (already created off main, no commits yet)
**Supersedes:** [`PIECE_PAGE_DATA_FLOW_AUDIT_V1.md`](PIECE_PAGE_DATA_FLOW_AUDIT_V1.md) — kept as historical record.
**Execution model:** One Claude Code session, end-to-end, after this spec is approved.
**Reference piece:** `3bcafc78-23f4-4c56-86aa-6221219dddbe` ("This one question gets my teen talking…")

---

## 1. Context & goal

### Why V2 exists

V1 was authored against `feat/piece-page-lifecycle` at commit `29cc6e2`. Between that commit and now, **16 PRs landed on `main`** (HEAD `1cd53a6`). Several touched directly in scope of V1's fixes — some superseding, some contradicting. Executing V1 verbatim would have:

- Broken the just-shipped `skills/full-avatar-profile` (anchored to slug `avatar-v1`) by deleting that slug.
- Broken the just-shipped `skills/content-lifecycle` persist flow (writes Drive `webViewLink` URLs to `content_queue.final_asset_url`) by adding a CHECK constraint that rejects Drive URLs.
- Used a cost estimate ($0.020) that was off by **two orders of magnitude** vs. the skill's stated ~$2.10/piece.
- Treated `3bcafc78` as a hand-flipped zombie when it is actually a successful run of the new persist pipeline (16 content_assets rows on Drive).
- Committed an 883-line dirty `agents/content.js` diff against a `content.js` that has been heavily rewritten across 5 unrelated PRs (#6, #10, #11, #12, #13) — a near-certain merge wreck.

V2 is built against current main and stays narrow: **only the gaps that remain after the 16 PRs are fixed.**

### What changed on main (since V1)

| PR | Title | Relevance to this spec |
|---|---|---|
| #14 | feat(skills): add full-avatar-profile production skill | Avatar Full is now defined as a skill anchored to slug `avatar-v1` (Higgsfield Seedance + Soul 2.0, not HeyGen). Cost ~$2.10/piece. |
| #18, #19 | feat(skills): content-lifecycle persistence skill + Drive uploader | New canonical persistence: profile skill produces a manifest → `content-lifecycle.ts persist` → Drive folder + `content_assets` rows. Sets `content_queue.final_asset_url` to Drive `webViewLink`. |
| #15 | feat(video): avatar QA agent CLI | `qa-agent-avatar.ts` exists, calibrated for Soul 2.0 / Seedance. Has its own scoring rubric (identity, hair, framing, background_consistency, lighting). |
| #16 | feat(video): hook card thumbnail generator | `generate-hook-card.ts` produces 1080×1920 PNG used as both video opener and thumbnail. |
| #17 | feat(video): avatar stitcher CLI | `stitch-avatar.ts` does the 200ms xfade stitch + captions + watermark. |
| #3 | feat(content-regen): regenerate-stale-drafts | Salvages pre-V1 drafts (rewrites format/caption to new gates). **Not a backfill mechanism for `generation_context` / `prompt_executions`.** |
| #6, #11, #12, #13 | content gen quality fixes | Heavy rewrites of `agents/content.js`. Now writes `render_profile_id` (85/112 pieces have one, distributed `moving-images: 43`, `static-image: 42`). Still does NOT write `generation_context` or call any prompt logger. |

### Primary outcome

Every newly-generated piece populates all four lifecycle sections of the piece page. The four sections that are still broken project-wide are:

- **Generation:** "No generation context recorded." 0/112 pieces have `generation_context`. **No PR addressed this.**
- **Prompt Chain:** "0 steps." `prompt_executions` is empty (0 rows globally). **No PR addressed this.**
- **Render preview:** Drive `webViewLink` URLs render as broken `<img>` icons. Content-lifecycle writes them as the production contract; the UI doesn't know how to embed them.
- **Render metadata for `3bcafc78`:** Profile / Duration / Cost still `—` and `$0.0000` because `content-lifecycle.ts` doesn't write `render_profile_id`, `render_started_at`, or `render_cost_usd`. Other 85 pieces with `render_profile_id` work fine on those fields except cost (4 zombie rows have $0.0000 cost).

V2 closes those gaps. Nothing more.

---

## 2. Scope summary

**In scope (this spec):**

1. Wire LLM-call logging into ContentGen so `prompt_executions` and `content_queue.generation_context` start populating. (V1 fix #2, scope unchanged: commit `prompt_logger.js`, `prompt_logger.test.js`, `ai-magic-content-gen.js`, plus a tight ~10-line additive diff to `agents/content.js`.)
2. Patch `content-lifecycle.ts` to also write `render_started_at`, `render_profile_id`, and `render_cost_usd` when persisting, so its outputs are visible in the piece page Render section.
3. Make the piece page Render section embed Drive URLs correctly. The fix is read-side in the edge function (`resolveOutputUrls`) plus a corresponding UI tweak in `RenderPanel`. **Reverses V1's "reject Drive URLs at write time" decision** — Drive URLs are now the production storage path, can't reject them.
4. Clean up the 3 actual zombie pieces (`0c48679f` → pending; `52955325` + `d84c27e9` → rejected/duplicate_hook). Add a CHECK constraint that prevents future hand-flipped `render_status='complete'` rows. **Constraint shape revised** from V1 to be compatible with the new content-lifecycle write pattern (only `final_asset_url IS NOT NULL` required, since lifecycle.ts doesn't write `render_started_at`).
5. Rename the existing `Avatar` profile row's display name to `"Avatar Full"` (1-row UPDATE). Delete the unused draft `Avatar Video` row (slug `avatar`, 0 FK refs). **Slug `avatar-v1` is preserved** — the on-main skill is anchored to it.

**Out of scope (explicitly):**

- **Creating a new `avatar-full` slug.** V1 said to delete `avatar-v1` and create `avatar-full`. V2 reverses this — see §3.7. The skill md is anchored to `avatar-v1`; renaming the slug breaks the skill's "When NOT to use" guard.
- **Adding `final_asset_url_embeddable` CHECK constraint.** V1 specified this; V2 drops it. Drive `webViewLink` URLs are the production storage contract. The fix moves to read-time (edge function `resolveOutputUrls` + UI handling).
- **Writing thumbnail extraction logic.** V1 specified t=1.0s frame extract. The thumbnail is the hook card (PR #16) — already produced and persisted as `content_assets.asset_type='thumbnail'`. V2 just makes the piece page UI find it there.
- **Wiring `content-lifecycle.ts` into the orchestrator.** Currently the orchestrator dispatches to the OLD `generate-avatar-video.ts` (HeyGen-based). The NEW lifecycle skill is invoked manually. Connecting them is a separate work item — track as Linear issue, do not solve here.
- **Backfilling `generation_context` / `prompt_chain` for pre-fix pieces.** Original LLM calls are gone. Unrecoverable. The UI's empty-state copy already explains this.
- **Backfilling `render_profile_id` for 27 pre-fix pieces** (those without one). Out of scope; let them age out.
- **Metrics-fetcher / `content_metrics`.** Tracked in YAR-94 / YAR-95.
- **RLS hardening on the 19 unprotected tables.** Separate security workstream — file as Linear issue.

---

## 3. Findings — fresh data-flow matrix (audited 2026-05-09 PM)

### 3.1 Project-wide counts

| Metric | V1 audit (AM) | V2 audit (PM) | Change |
|---|---|---|---|
| `content_queue` total | 112 | 112 | 0 |
| with `generation_context IS NOT NULL` | 0 | **0** | none — gap intact |
| with `render_profile_id IS NOT NULL` | 0 | **85** (43 moving-images, 42 static-image, 0 Avatar Full) | content.js now writes it |
| `render_status='complete'` | 4 | 4 | unchanged |
| `prompt_executions` total rows | 0 | **0** | none — gap intact |
| `content_assets` total rows | 16 | **16** (all for `3bcafc78`) | persistence path is producing |
| `content_metrics` total rows | 0 | 0 | YAR-94/95 |

### 3.2 Reference piece `3bcafc78` — corrected interpretation

V1 called this a "hand-flipped zombie." **It isn't.** It has 16 `content_assets` rows — `final_mp4`, `manifest`, `scene_audio`, `scene_clip`, `thumbnail`, `transcript` — all written by a real `content-lifecycle persist` run on 2026-05-09 12:32:31 UTC. The Drive URL on `final_asset_url` (`https://drive.google.com/file/d/1T90.../view?usp=drivesdk`) is the canonical `webViewLink` returned by Drive's API and written by `content-lifecycle.ts:305`.

What's missing from this piece (root cause of the broken Render section):

| Field | Value | Should be set by | Currently |
|---|---|---|---|
| `render_started_at` | NULL | content-lifecycle.ts | not written |
| `render_completed_at` | 2026-05-09 12:33:06 | content-lifecycle.ts | written ✓ |
| `render_profile_id` | NULL | content-lifecycle.ts | not written |
| `render_cost_usd` | 0 | content-lifecycle.ts | not written |
| `final_asset_url` | Drive `webViewLink` | content-lifecycle.ts | written ✓ |
| `generation_context` | NULL | content.js (V2 fix #1) | not written |
| `prompt_executions` chain | empty | LLM callers via prompt_logger (V2 fix #1) | not written |

So **the persist pipeline writes 2 of 5 expected `content_queue` fields**. V2 fix #2 closes that.

### 3.3 Per-section data-flow matrix (current main)

| Section | UI shows for `3bcafc78` | Read path (edge fn) | Write path | Verdict |
|---|---|---|---|---|
| Generation | "No generation context recorded" | `piece.generation_context` | `agents/content.js` does NOT write it | Gap. **V2 fix #1** addresses. |
| Prompt Chain | "0 steps" | `prompt_executions WHERE content_id=:id` | No code calls `prompt_logger.logPromptExecution` (file uncommitted) | Gap. **V2 fix #1** addresses. |
| Render preview | broken `<img>` icon | `resolveOutputUrls(piece)` line 73: non-`.mp4` `final_asset_url` → `output_urls.static`; UI binds `<img>` | `content-lifecycle.ts:305` writes Drive `webViewLink` (legitimately) | Gap is read-side, not write-side. **V2 fix #3** addresses. |
| Render metadata | Profile `—`, Duration `—`, Cost `$0.0000` | `render_profile_id` join, `render_started_at`/`completed_at` delta, `piece.render_cost_usd` | `content-lifecycle.ts` writes `render_completed_at` only; not `render_started_at`, not `render_profile_id`, not `render_cost_usd` | Gap is write-side, in `content-lifecycle.ts`. **V2 fix #2** addresses. |
| Analytics | hidden (not published) | `content_metrics` | `agents/metrics-fetcher.js` (YAR-94/95) | Out of scope. |

### 3.4 The 3 actual zombies (true hand-flips)

| Piece | Hook | Status | content_assets count | Cleanup |
|---|---|---|---|---|
| `0c48679f-062f-4c87-adf4-afb3dd7b03c7` | "The sunscreen pediatricians actually recommend? It's $8 at Target." | approved/complete | 0 | reset to pending |
| `52955325-80fa-464a-867a-1ce2ac608d9b` | "If your friend has it all together, **she is** the one you need to check on first." | rejected/complete | 0 | rejected, add `rejection_reason='duplicate_hook'`, reset render_status to pending |
| `d84c27e9-5a79-44d0-9b36-8ebd034bb492` | "If your friend has it all together, **she's** the one you need to check on first." | approved/complete | 0 | flip to rejected, `rejection_reason='duplicate_hook'`, reset render_status to pending |

`52955325` + `d84c27e9` are the duplicate-hook pair (only contraction differs). `0c48679f` is unique.

### 3.5 Recoverability summary

| Field | Pre-V1.1 pieces (created < 2026-04-19) | Post-V1.1 pieces | Gap closes when |
|---|---|---|---|
| `generation_context` | unrecoverable | populated for new pieces only | V2 fix #1 lands |
| `prompt_executions` chain | unrecoverable | populated for new pieces only | V2 fix #1 lands |
| `render_profile_id` | partially set (85/112); the 27 unset ones won't be backfilled | populated by current main's `content.js` | already working |
| `render_started_at`, `render_cost_usd` | only via re-render | populated for new pieces | V2 fix #2 lands |

### 3.6 Tensions surfaced (locked decisions in V1 that don't fit current main)

These were tagged "locked" coming into V2 but contradict current main. V2 reverses them with reasoning:

| V1 locked decision | Why it doesn't fit | V2 disposition |
|---|---|---|
| "Reject non-embeddable URLs at write time, no translator" | Drive `webViewLink` is the production `final_asset_url` per `content-lifecycle.ts:305`. A CHECK constraint rejecting Drive URLs would block the persist pipeline that just shipped. | **Reversed.** Move the fix to read-side (edge function `resolveOutputUrls`). No write-time constraint. No translator either — UI handles Drive URLs explicitly via iframe-or-thumbnail logic. |
| Cost estimate $0.020 (variable-only) | Avatar Full skill md states ~$2.10/piece. Seedance dominates ($1.50). | **Revised.** Update Avatar profile's `cost_estimate_usd` to `2.10` (matches skill md). Moving Images stays $0.023 (already set). Note this is variable cost only, not subscription. |
| Zombie guardrail: `render_status='complete'` requires `render_started_at IS NOT NULL AND render_completed_at IS NOT NULL AND render_profile_id IS NOT NULL` | `content-lifecycle.ts` only writes `render_completed_at` + `final_asset_url`. The just-shipped persist pipeline wouldn't satisfy the constraint. | **Revised constraint:** require `final_asset_url IS NOT NULL AND render_completed_at IS NOT NULL`. Cleaner contract: "complete means a final asset exists, regardless of which writer set it." V2 fix #2 also makes content-lifecycle write the other fields, but the constraint stays minimal. |
| Slug `avatar-full` (delete `avatar-v1`) | Skill md hardcodes `avatar-v1` in frontmatter description and "When NOT to use" guard. Orchestrator RENDERERS dispatch keys on `avatar-v1`. | **Reversed.** Keep slug `avatar-v1`, rename display name to `"Avatar Full"`. See §3.7. |
| Thumbnails: extract poster frame from MP4 at t=1.0s, store to `thumbnail_url` | Hook card thumbnail (PR #16) is the canonical thumbnail. Already produced by full-avatar-profile skill, persisted as `content_assets.asset_type='thumbnail'`. | **Reversed.** UI reads thumbnail from `content_assets`. No new column needed. Reading via edge function (V2 fix #3). |

### 3.7 Slug decision (Phase 3 recommendation)

**Recommendation: Option A — Keep slug `avatar-v1`. Rename the existing `render_profiles` row's `name` from `"Avatar"` to `"Avatar Full"`. Retitle `profiles/avatar/PROFILE.md` to "Avatar Full". Leave skill frontmatter alone.**

Reasoning:

1. The skill md (`skills/full-avatar-profile/SKILL.md`) hardcodes slug `avatar-v1` in two places: the frontmatter `description` ("Use this skill when..."), and the "When NOT to use" guard ("`render_profile` is not `avatar-v1` — return error"). Switching the slug requires editing the skill md and any future skill caller.
2. The orchestrator's `RENDERERS` dispatch map uses `avatar-v1` as a key (`agents/render-orchestrator.js:370`). Same edit cost.
3. Renaming the display name is a 1-row UPDATE on `render_profiles`. Zero code edits.
4. Slug is internal contract (skill ↔ DB ↔ orchestrator); display name is the user-facing label. The user-facing name should be "Avatar Full" because that's how CONTENT_STRATEGY_V1 and FACE_OF_SMT_V1 refer to it. The internal slug should stay stable.
5. Future cleanup: when the skill is rewritten or replaced (e.g. for a v2 profile), THEN consider migrating to a new slug. Not in this spec's scope.

Also: delete the unused draft `Avatar Video` row (slug `avatar`, status `draft`, 0 FK refs). It's leftover from earlier scoping and adds confusion.

### 3.8 Lifecycle code disposition (Phase 3 recommendation)

**Recommendation: Option C — Both `prompt_logger` and `content-lifecycle` are needed. They're orthogonal and complementary.**

Reasoning:

1. `content-lifecycle.ts` (PR #19) writes asset persistence: Drive uploads + `content_assets` rows. Does NOT call any LLM, does NOT write `prompt_executions` or `generation_context`.
2. `prompt_logger.js` (uncommitted) writes LLM-call observability: one `prompt_executions` row per LLM call with system/user prompts, model, tokens, cost, supersedes_id. Does NOT touch asset persistence.
3. Both must land for all three piece-page UI sections (Generation / Prompt Chain / Render) to populate. Neither replaces the other.
4. **The dirty `agents/content.js`** I had locally is mostly noise — main's `content.js` rewrote the file across 5 PRs. Strategy: **discard the dirty content.js entirely**, take main's clean version, and apply just the ~10-line lifecycle additions on top (the import, the `generation_context: generationContext` write, and the `logPromptExecution` call). Done in §4.1.

#### 3.8.1 Per-field ownership table

To make Option C concrete and avoid fuzzy ownership: every field touched by this work is owned by exactly one writer at exactly one phase. Both writers can write to overlapping `content_queue` columns at different lifecycle phases (gen-time vs. render-time). They never write the same column at the same phase.

| Field | Owner | Phase | Notes |
|---|---|---|---|
| `content_queue` row INSERT (hook, caption, slides, hashtags, content_pillar, post_format, source_urls, briefing_id, etc.) | `agents/content.js` | Gen-time | Existing main behavior. Unchanged. |
| `content_queue.render_profile_id` | `agents/content.js` | Gen-time | Set when content is generated, based on format selection. Existing main behavior (85/112 pieces have it). |
| `content_queue.generation_context` | `agents/content.js` | Gen-time | **NEW (V2 fix #1).** Frozen snapshot at insert time: `{model, system_prompt, user_prompt, tokens_in, tokens_out, cost_usd, pillar_input, format_input, active_directives, briefing_id}`. |
| `prompt_executions` rows (one per LLM call) | Callers via `agents/lib/prompt_logger.js` | Any phase that calls an LLM | **NEW (V2 fix #1).** One row per LLM call across the lifetime of a piece. Step 1 = content gen; downstream steps = QA, regen, etc. as those agents are wired up. |
| `content_queue.render_status` (`pending` / `rendering`) | `agents/render-orchestrator.js` | Render-time, dispatch | Sets `pending → rendering` when a renderer is spawned. |
| `content_queue.render_started_at` | `agents/render-orchestrator.js` (legacy renderers) **OR** `video/scripts/content-lifecycle.ts` persist mode (new path) | Render-time, start | Whichever pipeline runs writes it. **V2 fix #2** adds this write to the new path, which currently only writes `render_completed_at`. |
| `content_queue.render_completed_at` | Same — orchestrator (legacy) **OR** content-lifecycle (new) | Render-time, end | Both write it. Both are valid. |
| `content_queue.render_status` (`complete` / `failed` / `qa_failed` / `blocked`) | Same — orchestrator (legacy) **OR** content-lifecycle (new) | Render-time, end | Both write it. |
| `content_queue.render_cost_usd` | Same — orchestrator (legacy: aggregates from `cost_log`) **OR** content-lifecycle (new: from manifest's `render_params.cost_usd`) | Render-time, end | **V2 fix #2** adds this write to content-lifecycle. |
| `content_queue.render_profile_id` (RE-write at render time) | `video/scripts/content-lifecycle.ts` (new path only) | Render-time, end | **V2 fix #2** adds this. The orchestrator path doesn't re-write it because content.js already set it at gen-time; the lifecycle path needs to re-write it because lifecycle can be invoked standalone for pieces that didn't go through content.js (e.g. 3bcafc78). |
| `content_queue.render_error` | `agents/render-orchestrator.js` only | Render-time, on failure | Lifecycle path doesn't currently produce errors that get persisted to `content_queue` — its errors go to stderr. Out of scope for V2. |
| `content_queue.final_asset_url` | Same — orchestrator (legacy: returns from renderer, typically Supabase Storage URL) **OR** content-lifecycle (new: Drive `webViewLink`) | Render-time, end | **Both are valid.** Drive URLs and Supabase Storage URLs both written here, depending on which pipeline ran. The piece-page UI handles both via §4.3 read-side fixes. |
| `content_assets` rows (one per uploaded artifact) | `video/scripts/content-lifecycle.ts` only | Persist phase (after render produces a manifest) | The new path's exclusive write target. Legacy renderers do NOT write `content_assets` — only `content_queue.final_asset_url`. |

#### 3.8.2 Pipeline disambiguation

Two pipelines currently coexist:

- **Legacy pipeline (current production for new pieces):** `agents/content.js` insert → `agents/render-orchestrator.js` polls → `RENDERERS[slug]` dispatches to `generate-video-v2.ts` (Moving Images) / `image-gen.js` (Static Image) / `generate-avatar-video.ts` (avatar-v1, HeyGen-based). Renderer returns a URL → `setComplete` writes `final_asset_url` (typically Supabase Storage). No `content_assets` rows.
- **New persist pipeline (manual invocation only, not wired into orchestrator yet):** profile skill (e.g. `full-avatar-profile`) produces a manifest → operator runs `npx tsx video/scripts/content-lifecycle.ts persist --content-id X --manifest path/to/manifest.json` → uploads to Drive, writes `content_assets`, updates `content_queue` render fields. `final_asset_url` is Drive `webViewLink`.

**Both write the same `content_queue` columns.** Whichever runs last wins. In practice they don't race because the new pipeline isn't auto-triggered — that wiring is a separate Linear issue (see §6 / §8).

#### 3.8.3 Boundary discipline

- **Don't add prompt_logger calls inside `content-lifecycle.ts`.** Lifecycle persists assets; it doesn't log LLM calls because it doesn't make any.
- **Don't add `content_assets` writes inside `agents/content.js` or the legacy orchestrator path.** That table is the new pipeline's exclusive territory.
- **`generation_context` is gen-time only.** Don't update it at render-time even if more context becomes known. It's a frozen snapshot.
- **`prompt_executions` rows are append-only.** Use `supersedes_id` to mark a row superseded; never UPDATE or DELETE existing rows.

---

## 4. Fixes

Apply in order. Each step has a verification gate; do not proceed until the gate passes.

### 4.1 Wire ContentGen into prompt_logger + generation_context

Files to add:
- `agents/lib/prompt_logger.js` (new, 145 lines, untracked locally) — `logPromptExecution`, `withPromptLogging`, `logDeterministicStep`. Never throws.
- `agents/lib/__tests__/prompt_logger.test.js` (new, 63 lines, untracked locally) — confirms never-throw contract.
- `agents/ai-magic-content-gen.js` (new, 503 lines, untracked locally) — separate AI Magic content-gen agent with lifecycle wiring. Writes `generation_context` + `render_profile_id` + step-1 `prompt_executions` row.

File to modify (additive, on top of main's clean version):
- `agents/content.js` — add three things:
  1. `import { logPromptExecution } from './lib/prompt_logger.js';` near the top.
  2. After the `content_queue` insert (around line 749 of current main), add `generation_context: generationContext` to the insert payload, where `generationContext` is built from `{model, system_prompt, user_prompt, tokens_in, tokens_out, cost_usd, pillar_input, format_input, active_directives, briefing_id}`.
  3. After the insert succeeds, call `logPromptExecution({ contentId: newPieceId, agentName: 'content_gen', stepName: 'content_gen', stepOrder: 1, model, systemPrompt, userPrompt, renderedOutput, tokensIn, tokensOut, costUsd, status: 'ok', latencyMs })`. Done in parallel (`Promise.allSettled`) so insert remains the critical path.

**Discard the dirty `agents/content.js`** in the working tree; take main's clean version as base. The 880-line dirty diff against main is mostly stale conflicts — only the three additions above are wanted.

Pre-commit checks (local, before pushing):
1. Run `node --test agents/lib/__tests__/prompt_logger.test.js` — must pass.
2. Run a one-piece dry generation with a real signal (Sonnet per spec — content gen stays Sonnet). Verify in Supabase:
   ```sql
   SELECT id, generation_context IS NOT NULL AS has_ctx,
          (SELECT COUNT(*) FROM prompt_executions WHERE content_id = c.id) AS chain_len
   FROM content_queue c
   ORDER BY created_at DESC LIMIT 1;
   ```
   Expect: `has_ctx=true, chain_len>=1`.
3. No `[prompt_logger] insert failed` lines in stderr.

Commit shape: one commit, message `feat(lifecycle): wire prompt_logger + generation_context into content gen`. Body lists the 3 piece-page sections this unblocks.

**Verification gate:** the next scheduled GitHub Actions content-gen run produces at least one new piece with `generation_context IS NOT NULL` and a non-empty `prompt_executions` chain.

### 4.2 Patch content-lifecycle.ts to write missing render_* fields

Edit `video/scripts/content-lifecycle.ts`, the `runPersist()` function, where `content_queue` is updated (currently lines 305-313):

```typescript
// BEFORE (current main):
const finalAssetUrl = uploaded.find((u) => u.asset_type === "final_mp4")?.drive.webViewLink ?? null;
const { error: updateErr } = await sb
  .from("content_queue")
  .update({
    render_status: "complete",
    render_completed_at: new Date().toISOString(),
    final_asset_url: finalAssetUrl,
  })
  .eq("id", args.contentId);

// AFTER:
const finalAssetUrl = uploaded.find((u) => u.asset_type === "final_mp4")?.drive.webViewLink ?? null;
const renderStartedAt = manifest.produced_at ?? new Date(Date.now() - 5 * 60_000).toISOString();
const renderCostUsd = manifest.render_params?.cost_usd ?? null;
const renderProfileId = manifest.render_params?.render_profile_id ?? null;

const { error: updateErr } = await sb
  .from("content_queue")
  .update({
    render_status: "complete",
    render_started_at: renderStartedAt,        // NEW
    render_completed_at: new Date().toISOString(),
    render_profile_id: renderProfileId,        // NEW
    render_cost_usd: renderCostUsd,            // NEW
    final_asset_url: finalAssetUrl,
  })
  .eq("id", args.contentId);
```

The manifest produced by profile skills must therefore include:
- `produced_at` (ISO timestamp, when the render started — already optional in the manifest contract, see `Manifest` interface)
- `render_params.cost_usd` (numeric, total piece cost — full-avatar-profile skill md already specifies this in the output schema, line 150)
- `render_params.render_profile_id` (uuid)

Document the contract in `skills/content-lifecycle/SKILL.md` — add a note that profile skills must include these manifest fields if downstream consumers (piece page UI, cost reports) are to work.

**Verification gate:** after deploying this patch, run `content-lifecycle.ts persist` on a fresh manifest. Verify in Supabase:
```sql
SELECT render_status, render_started_at, render_completed_at, render_profile_id, render_cost_usd, final_asset_url
FROM content_queue WHERE id = '<test_content_id>';
```
Expect all six fields populated, with `final_asset_url` being a Drive `webViewLink`.

### 4.3 Make piece page Render section embed Drive URLs correctly

Two-layer fix.

**4.3.1 Edge function `resolveOutputUrls`** (`supabase/functions/content-queue/index.ts`).

Current logic (line 73): non-`.mp4` `final_asset_url` falls into `output_urls.static`. That's wrong for Drive `webViewLink` URLs which are videos but don't end in `.mp4`. Replace with a `content_assets`-aware resolver. **The block must include a comment documenting why Drive URLs are accepted** (PR #19's `content-lifecycle.ts:305` writes them as the production storage contract). Without this comment, the next person reading the code will mistake Drive URLs for legacy junk and try to lock them out — which is exactly what V1 spec'd before the architectural drift was caught.

```typescript
// Drive URLs are the production storage contract for any content rendered via the
// content-lifecycle persist pipeline (see skills/content-lifecycle/SKILL.md and
// video/scripts/content-lifecycle.ts:305 — that script writes Drive webViewLink URLs
// to content_queue.final_asset_url). Do NOT lock these out at write time. Drive
// `/file/d/<id>/view` URLs are not embeddable as <img src> or <video src> directly,
// so we rewrite them here for embed context: /preview for iframe video, lh3 for img.
// The legacy orchestrator pipeline writes Supabase Storage URLs which embed natively
// — that branch stays unchanged.
function resolveOutputUrls(piece: any, assets: any[]): { video?: string; carousel_slides?: string[]; static?: string; thumbnail?: string } {
  // Prefer content_assets (canonical for the new pipeline) over content_queue.final_asset_url (denormalized snapshot — both pipelines write it).
  const currentAssets = (assets || []).filter((a) => a.is_current);
  const finalMp4Asset = currentAssets.find((a) => a.asset_type === "final_mp4");
  const thumbnailAsset = currentAssets.find((a) => a.asset_type === "thumbnail");

  const out: any = {};

  if (finalMp4Asset) {
    out.video = driveEmbedUrl(finalMp4Asset.drive_file_id);
  } else if (piece.final_asset_url?.includes("drive.google.com")) {
    // Legacy: extract file_id from /file/d/<id>/ pattern (older content-lifecycle runs predate content_assets writes)
    const m = piece.final_asset_url.match(/\/file\/d\/([^/]+)/);
    if (m) out.video = driveEmbedUrl(m[1]);
  } else if (piece.final_asset_url?.endsWith(".mp4")) {
    out.video = piece.final_asset_url;  // Supabase Storage URL from legacy orchestrator path
  } else if (Array.isArray(piece.slide_images) && piece.slide_images.length > 0) {
    out.carousel_slides = piece.slide_images.map((s: any) => s.url ?? s.image_url ?? s).filter(Boolean);
  } else if (piece.image_url) {
    out.static = piece.image_url;
  }

  if (thumbnailAsset) {
    out.thumbnail = driveContentUrl(thumbnailAsset.drive_file_id);  // for <img> tags
  }

  return out;
}

// Drive URL embed helpers. /preview embeds in <iframe> (video), /uc?id= and lh3 hosts
// embed in <img> (image). The /view URL Drive returns by default does NOT embed in either.
function driveEmbedUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}
function driveContentUrl(fileId: string): string {
  return `https://lh3.googleusercontent.com/d/${fileId}`;
}
```

Update `handleGetPiece` to also fetch `content_assets` for the piece and pass to `resolveOutputUrls`:

```typescript
const assetsPromise = sb.from("content_assets").select("*").eq("content_id", id).eq("is_current", true);
const [renderProfileRes, chainRes, metricsRes, assetsRes] = await Promise.all([..., assetsPromise]);
// ...
output_urls: resolveOutputUrls(piece, assetsRes.data || []),
```

Pull deployed v14 source via `mcp__supabase__get_edge_function`, commit as a separate baseline commit (per S1 option b), THEN apply the above edit, THEN redeploy via `mcp__supabase__deploy_edge_function`.

**4.3.2 UI `RenderPanel`** (`app/src/pages/ContentDetailPage.tsx:578-644`).

The current panel uses `<video src={output_urls.video}>` and `<img src={output_urls.static}>`. Drive `/preview` URLs need an `<iframe>` instead of `<video>`:

```tsx
{output_urls.video ? (
  output_urls.video.includes("drive.google.com") ? (
    <iframe
      src={output_urls.video}
      allow="autoplay"
      className="w-full max-w-md aspect-[9/16] rounded-md border-0"
      data-testid="render-preview-video"
    />
  ) : (
    <video src={output_urls.video} controls className="w-full max-w-md rounded-md" data-testid="render-preview-video" />
  )
) : ...
```

Same for thumbnail — bind to `output_urls.thumbnail` (which is a `lh3.googleusercontent.com/d/<id>` URL, embeddable in `<img>`) when available.

**Verification gate:** open `/pipeline/3bcafc78-23f4-4c56-86aa-6221219dddbe` in the dashboard. Render section shows the video playing in an iframe. Thumbnail (if surfaced anywhere) loads as a real image.

### 4.4 Zombie cleanup + minimal CHECK constraint

Migration — single file, one CHECK + three UPDATEs:

```sql
-- 20260509XXXXXX_render_complete_minimum_contract.sql

-- Add CHECK constraint as NOT VALID (allows the existing zombie rows to live until cleanup completes).
ALTER TABLE content_queue
  ADD CONSTRAINT render_complete_minimum_contract
  CHECK (
    render_status != 'complete'
    OR (final_asset_url IS NOT NULL AND render_completed_at IS NOT NULL)
  ) NOT VALID;

-- Cleanup zombies.
UPDATE content_queue
SET render_status = 'pending',
    render_completed_at = NULL
WHERE id = '0c48679f-062f-4c87-adf4-afb3dd7b03c7';

UPDATE content_queue
SET status = 'rejected',
    rejection_reason = 'duplicate_hook',
    render_status = 'pending',
    render_completed_at = NULL
WHERE id IN (
  '52955325-80fa-464a-867a-1ce2ac608d9b',
  'd84c27e9-5a79-44d0-9b36-8ebd034bb492'
);

-- Validate. 3bcafc78 satisfies (final_asset_url + render_completed_at both set), 85 in-flight pieces are not 'complete'.
ALTER TABLE content_queue VALIDATE CONSTRAINT render_complete_minimum_contract;
```

Why this constraint shape (vs. V1's three-column requirement):

- Minimum semantic contract for "complete": a final asset exists and we know when. Both writers (orchestrator's old path, content-lifecycle's new path) set these two.
- `render_started_at`, `render_profile_id`, `render_cost_usd` will populate after V2 fix #2 lands, but they're not part of the "complete" contract — they're metadata that should be set, not gating conditions for completeness. (V2 fix #2 ensures they ARE set for new pieces; this constraint doesn't care.)

**Verification gate:**
```sql
-- Should fail with constraint violation:
UPDATE content_queue SET render_status = 'complete' WHERE id = (SELECT id FROM content_queue WHERE render_status = 'pending' LIMIT 1);
-- Should succeed (3bcafc78 has both required fields):
SELECT 1; -- (constraint already validated, this is a tautology)
```

### 4.5 Rename Avatar profile + delete unused Avatar Video draft + update PROFILE.md

Migration:

```sql
-- 20260509YYYYYY_rename_avatar_profile_avatar_full.sql

-- Rename display name only — slug avatar-v1 stays (skill is anchored to it).
UPDATE render_profiles
SET name = 'Avatar Full',
    cost_estimate_usd = 2.10,        -- per skills/full-avatar-profile/SKILL.md cost budget
    spec_doc_path = 'profiles/avatar/PROFILE.md'
WHERE slug = 'avatar-v1';

-- Delete unused draft.
DELETE FROM render_profiles WHERE slug = 'avatar';
-- (Verified: 0 FK refs, safe to delete.)
```

Edit `profiles/avatar/PROFILE.md`:
- Title `# Avatar Video — Render Profile v1` → `# Avatar Full — Render Profile v1`
- Body: keep slug `avatar-v1` (do not rename in body), add a new "Cost" section: `Variable cost: ~$2.10/piece (Seedance ~$1.50, ElevenLabs ~$0.05, Whisper ~$0.01, Sonnet QA ~$0.55). Subscriptions: Heygen Creator $24-29/mo, ElevenLabs Starter $5/mo (latter for the legacy HeyGen pipeline; Soul 2.0 pipeline uses ElevenLabs only for TTS).`
- Add "Thumbnails" section: `Hook card produced by video/scripts/generate-hook-card.ts, persisted as content_assets.asset_type='thumbnail'.`
- Add "Output Spec" section to match other profiles' shape.

**Verification gate:**
```sql
SELECT slug, name, cost_estimate_usd FROM render_profiles WHERE slug = 'avatar-v1';
-- Expect: avatar-v1, "Avatar Full", 2.10
SELECT COUNT(*) FROM render_profiles WHERE slug = 'avatar';
-- Expect: 0
```

Skill md (`skills/full-avatar-profile/SKILL.md`) is **not** edited — it remains anchored to `avatar-v1`.

---

## 5. Acceptance test

Single, complete end-to-end test (after all five fixes are merged locally; Heygen/ElevenLabs keys still NOT required for this test because the test piece routes to Moving Images, the active runnable profile):

1. Trigger one fresh content-gen run with a single signal: `node agents/content.js --signals 1`. (ContentGen is Sonnet per spec.)
2. Note the new `content_queue.id`. It will route to Moving Images or Static Image (the only profiles content.js currently routes to). Verify in Supabase:
   ```sql
   SELECT id, render_profile_id, generation_context IS NOT NULL AS has_ctx,
          (SELECT COUNT(*) FROM prompt_executions WHERE content_id = c.id) AS chain_len
   FROM content_queue c WHERE id = '<new_id>';
   ```
   Expect: `render_profile_id` set, `has_ctx=true`, `chain_len >= 1`.
3. Wait for the orchestrator to render it (or invoke directly: `node agents/render-orchestrator.js`). Moving Images uses `pexels + openai_tts + whisper`, all `status=active`.
4. Open `/pipeline/<new_id>` in the dashboard. Confirm:
   - **Generation** populates: model, tokens in/out, cost, pillar input, format input, active directives, full prompt expandable.
   - **Prompt Chain** populates: ≥1 step, with model, latency, cost, expandable system/user prompt and rendered output.
   - **Render** populates: Profile name, Duration in seconds, non-zero Cost, working preview.
   - **Render preview** shows the actual video/image, no broken-image icon.
5. Open `/pipeline/3bcafc78-23f4-4c56-86aa-6221219dddbe` (the legacy Avatar Full piece). Render section now plays the Drive-hosted MP4 in an iframe. Profile, Duration, Cost still `—` (those won't populate until someone re-runs persist on it with the patched lifecycle script — out of scope for this test). Generation/Prompt Chain still empty (unrecoverable). **All four sections render correctly given the data they have.**
6. Negative tests:
   ```sql
   -- Should fail (constraint violation):
   UPDATE content_queue
   SET render_status = 'complete'
   WHERE id = (SELECT id FROM content_queue WHERE render_status = 'pending' LIMIT 1);
   -- Expected: ERROR 23514: violates check constraint "render_complete_minimum_contract"
   ```
7. Take screenshot of the new piece's piece page (all four sections expanded). Attach to PR description.

**Avatar Full QA gate (deferred):** the V1 acceptance test required a live Avatar Full render via Heygen/ElevenLabs. V2 drops that — Avatar Full requires keys not currently configured (`heygen.status='no_key'`, `elevenlabs.status='no_key'`). The Avatar Full path is exercised separately (a) by 3bcafc78's existing `content_assets`, which prove the persist pipeline works, and (b) by `qa-agent-avatar.ts` (PR #15) running on a new Avatar Full piece in a follow-up session once keys are configured. **No live Avatar Full render in this PR.**

If all six gates pass: V2 is satisfied. Merge `fix/piece-page-data-flow-audit` to main.

---

## 6. Known gaps not addressed here

- **Orchestrator hasn't been wired to call `content-lifecycle.ts`.** Currently it dispatches to the OLD `generate-avatar-video.ts`. The new persist flow requires manual invocation. Track as a separate Linear issue: "Wire content-lifecycle into orchestrator dispatch."
- **ContentGen never routes to Avatar Full.** All 85 pieces with `render_profile_id` go to Moving Images or Static Image. The on-main `agents/content.js` doesn't include Avatar Full as a routing target. Out of scope; Avatar Full is currently invoked manually.
- **`content_metrics` is empty project-wide.** YAR-94 (Apify secrets), YAR-95 (analytics widget). Hidden in the UI until publish.
- **Pre-V1.1 pieces have null `generation_context` and empty prompt chains.** Unrecoverable. UI's empty-state copy already explains.
- **27 pieces have no `render_profile_id`.** Not backfilled. Ageing-out.
- **Three migrations untracked locally** (`20260501133140_create_signals_table.sql`, `20260501134353_create_ai_magic_opportunities.sql`, `20260501155709_link_cost_log_to_agent_runs.sql`). Tables exist in DB but migrations aren't versioned in git. File as Linear issue "version-control catch-up."
- **19 RLS-disabled tables** (Supabase advisory). Separate security workstream.
- **Content-lifecycle has no `re_render` or `publish` mode** (placeholder). Out of scope.

---

## 7. Decisions captured

Carried forward from V1 (validated against current main):
- **S1 / Edge fn baseline:** pull deployed v14 source via MCP, commit as a separate "track-edge-fn-source" commit BEFORE applying §4.3.1's edits. ✓
- **S2 / Agent sweep scope:** strict — only the lifecycle files, defined per §3.8 as `prompt_logger.js`, `prompt_logger.test.js`, `ai-magic-content-gen.js`, plus a ~10-line additive diff to `agents/content.js`. ✓
- **S3 / Untracked migrations:** out of scope, separate Linear issue. ✓
- **Keys timing:** wait until `HEYGEN_API_KEY` + `ELEVENLABS_API_KEY` are configured before any Avatar Full live render. **Not required for the V2 acceptance test** (uses Moving Images). ✓
- **Zombie cleanup specifics:** 0c48679f → pending; 52955325 + d84c27e9 → rejected/duplicate_hook + render_status reset to pending. ✓

Reversed in V2 (with reasoning in §3.6):
- "Reject Drive URLs at write time" → moved to read-side, Drive URLs are the production storage contract.
- Cost estimate $0.020 → 2.10 (matches skill md).
- Zombie guardrail constraint → minimal: `final_asset_url IS NOT NULL AND render_completed_at IS NOT NULL`.
- Slug `avatar-full` → keep `avatar-v1`, rename display name only.
- Thumbnails poster-frame at t=1.0s → use hook card from `content_assets`.
- "No translator" → still no translator, but the read-side resolver IS aware of Drive URL formats and translates display URLs (`/file/d/<id>/view` → `/file/d/<id>/preview` for video iframe, `lh3.googleusercontent.com/d/<id>` for thumbnail img). This is URL **rewriting for embed context**, not translating between sources.

Phase 3 recommendations made:
- **Slug:** Option A (keep `avatar-v1`).
- **Lifecycle code:** Option C (both, complementary).

---

## 8. Linear

Open epic under Yarono team: **"Piece Page Data Flow Audit V2"**. Five child issues:
1. Wire ContentGen into prompt_logger + generation_context (V2 §4.1)
2. Patch content-lifecycle.ts to write missing render_* fields (V2 §4.2)
3. Drive-aware piece page Render preview (V2 §4.3)
4. Zombie cleanup + render_complete_minimum_contract CHECK (V2 §4.4)
5. Rename Avatar profile to Avatar Full + delete draft Avatar Video (V2 §4.5)

Plus separate issues (related, not blocking):
- "Wire content-lifecycle into orchestrator dispatch" (the missing wiring layer; tracks the new lifecycle skill becoming the default render path).
- "Dedup check in ContentGen — reject duplicate hooks before render" (Improvement, Medium priority).
- "RLS hardening — 19 unprotected tables" (Bug, High priority).
- "Migration version-control catch-up — track 3 untracked migrations" (Improvement, Low priority).
- "ContentGen routing — add Avatar Full as a routing target" (Improvement; tracks the format-routing gap surfaced by the audit — 0 of 85 profile-tagged pieces route to Avatar Full despite it being the primary Rachel format).
- "Avatar Full live acceptance test + qa-agent-avatar calibration" (Avatar & Voice label, blocked on `HEYGEN_API_KEY` + `ELEVENLABS_API_KEY`; runs the live Avatar Full pipeline and validates `qa-agent-avatar.ts` scoring on a real piece).

Reference YAR-94 / YAR-95 as related-not-blocking on the epic.
