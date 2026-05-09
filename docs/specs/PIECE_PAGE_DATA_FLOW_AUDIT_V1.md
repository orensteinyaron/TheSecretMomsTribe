# Piece Page Data Flow Audit & Repair — Spec V1

**Date:** May 9, 2026
**Target branch:** `feat/piece-page-lifecycle` (continues the V1 work)
**Supersedes:** N/A (corrective; PIECE_PAGE_LIFECYCLE_V1.md remains authoritative for design intent)
**Execution model:** One Claude Code session, end-to-end.
**Reference piece for verification:** `3bcafc78-23f4-4c56-86aa-6221219dddbe` ("This one question gets my teen talking…")

---

## 1. Context & goal

PIECE_PAGE_LIFECYCLE_V1 shipped the schema, the `content-queue` Edge Function (v14), and the frontend (`ContentDetailPage.tsx`). Visiting a piece page today renders without errors, but four of the page's sections silently show empty/placeholder state for **every** piece in the database:

- **Generation:** "No generation context recorded." (0 of 112 pieces have `generation_context`.)
- **Prompt Chain:** "0 steps · No prompt executions recorded yet." (`prompt_executions` table is globally empty.)
- **Render preview:** broken-image icon for the four pieces with `render_status='complete'`.
- **Render metadata:** Profile / Duration / Cost all `—` and `$0.0000` (0 of 112 pieces have `render_profile_id`).

Phase 1 audit (in chat, 2026-05-09) traced every gap to root cause. **Single dominant cause:** the lifecycle write code (`agents/lib/prompt_logger.js`, `agents/ai-magic-content-gen.js`, the V1 modifications to `agents/content.js`) exists locally but was never committed. Production agents are running pre-V1.1 code that doesn't populate these fields. Compounding this, four pieces (including the reference piece) had `render_status` hand-flipped to `complete` outside the orchestrator, leaving them in a "zombie" state with `render_started_at=NULL`, `render_profile_id=NULL`, and a non-embeddable Google Drive `/view` URL in `final_asset_url`.

**Primary outcome:** every newly-generated piece populates all five lifecycle sections of the piece page. The reference piece is fixed where recoverable. A DB guardrail makes the zombie state impossible to re-introduce.

---

## 2. Scope summary

**In scope (this spec):**

1. Commit + push the uncommitted lifecycle write code so production agents start populating `generation_context`, `prompt_executions`, and `render_profile_id`.
2. Re-render the reference piece end-to-end through the orchestrator to backfill what's recoverable (`render_started_at`, `render_completed_at`, `render_profile_id`, `render_cost_usd`, an embeddable `final_asset_url`).
3. Harden `final_asset_url` handling against non-embeddable URLs (write-time validation as primary defense, defensive read-time translation for legacy data).
4. Add a DB guardrail (CHECK constraint) preventing future zombie `render_status='complete'` rows.
5. Acceptance: generate one fresh piece end-to-end, verify all four sections populate on the piece page.

**Out of scope (explicitly):**

- Metrics-fetcher fix. `content_metrics` is empty project-wide, but this is a separate workstream tracked in **YAR-94** (Apify secrets) and **YAR-95** (analytics widget). The Analytics section of the piece page is hidden until a piece is published, so this gap is invisible in normal flow. Mentioned here only as a known gap.
- Backfill of `generation_context` and `prompt_chain` for pieces that predate this fix. The original LLM calls are gone; their context is unrecoverable. Pieces created before the commit-and-push of step 1 will continue to show "No generation context recorded" — this is correct, not a bug.
- Any changes to render profiles, content templates, or QA logic.
- Cleanup of the 19 RLS-disabled tables surfaced by Supabase advisory. Separate security workstream.

---

## 3. Findings — per-section data-flow matrix

Reference piece state at audit time (full row queried 2026-05-09):

```
id:                  3bcafc78-23f4-4c56-86aa-6221219dddbe
status:              approved
render_status:       complete
render_started_at:   NULL                     ← zombie indicator
render_completed_at: 2026-05-09 12:33:06+00   ← hand-set today
render_profile_id:   NULL                     ← never set
render_cost_usd:     0.000000
final_asset_url:     https://drive.google.com/file/d/1T90.../view?usp=drivesdk
generation_context:  NULL
metadata:            {"composed": false}
```

Per-section verdict:

| Section | UI shows | Read path (edge fn) | Write path (agent) | Root cause |
|---|---|---|---|---|
| Generation | "No generation context recorded" | `piece.generation_context` (`supabase/functions/content-queue/index.ts` `handleGetPiece`, line 138) | `agents/content.js:689` and `agents/ai-magic-content-gen.js:378` write `generation_context` on insert | Write code uncommitted (`M agents/content.js`, `?? agents/ai-magic-content-gen.js`, `?? agents/lib/prompt_logger.js`). Production agents run pre-V1.1 code. |
| Prompt Chain | "0 steps · No prompt executions recorded yet" | `prompt_executions WHERE content_id=:id` (line 132) | `agents/content.js:705` and downstream callers via `agents/lib/prompt_logger.js` `logPromptExecution()` | Same uncommitted code. `prompt_executions` is globally empty (0 rows). |
| Render preview | broken `<img>` icon | `resolveOutputUrls(piece)` (line 73): non-`.mp4` `final_asset_url` → `output_urls.static`; UI binds `<img src={output_urls.static}>` | `agents/render-orchestrator.js:189` writes `final_asset_url` after upload to Supabase Storage | Two compounding bugs. **(a)** Orchestrator never ran for this piece — `render_started_at=NULL` despite `render_status='complete'` (orchestrator sets `render_started_at` first, line 138). The complete status was hand-flipped. **(b)** Even if a Drive URL is returned by `resolveOutputUrls`, `https://drive.google.com/file/d/<id>/view?usp=drivesdk` is not a valid `<img src>` — Drive `/view` returns HTML, not an image. |
| Render metadata (Profile / Duration / Cost) | "—" / "—" / "$0.0000" | `render_profile_id` join (line 122), `render_started_at`/`render_completed_at` delta (`ContentDetailPage.tsx:592`), `piece.render_cost_usd` | `agents/content.js:686` writes `render_profile_id`; orchestrator writes timing + cost | Same single root cause as Generation/Prompt Chain (uncommitted writes) compounded by the same zombie-flip as the preview. 0 of 112 pieces have `render_profile_id`. |
| Analytics (hidden) | n/a — section only renders when `published_at_ig OR published_at_tt` is set | `content_metrics WHERE content_id=:id` (line 191) | `agents/metrics-fetcher.js:196` writes `content_metrics` (correct table) | Out of scope. Tracked in YAR-94 / YAR-95. |

**Recoverability for the reference piece:**
- `generation_context`, `prompt_chain`: **unrecoverable** — original LLM calls are gone.
- `render_profile_id`, `render_started_at`, `render_completed_at`, `render_cost_usd`, embeddable `final_asset_url`: **recoverable** by re-running the orchestrator.

---

## 4. Fixes

Apply in order. Each step has a verification gate; do not proceed until the gate passes.

### 4.1. Commit + push the lifecycle write code

The single highest-impact fix. Currently the modifications that wire `prompt_logger.js` into the content-gen flow exist only on Yaron's machine; CI runs `agents/content.js` from `main` and never logs.

**Files to commit:**
- `agents/lib/prompt_logger.js` — new (untracked).
- `agents/ai-magic-content-gen.js` — new (untracked). Writes `generation_context`, `render_profile_id`, calls `logPromptExecution`.
- `agents/content.js` — modified. Imports `logPromptExecution`; writes `generation_context` + `render_profile_id`; logs step-1 prompt_executions row in parallel with insert.
- Any other modified agents that currently call LLMs without logging — verify with: `git grep -l "messages.create\|anthropic.messages\|openai.chat.completions" agents/` and ensure each one routes through `logPromptExecution`.

**Pre-commit checks:**
1. `prompt_logger.js` never throws (per its own contract). Confirm by running `agents/lib/__tests__/prompt_logger.test.js` (already in the working tree under `agents/lib/__tests__/`).
2. Running `node agents/content.js` (or an equivalent dry-run) against a single signal locally writes one new row to `prompt_executions` and a non-null `generation_context` on the new `content_queue` row. Verify with:
   ```sql
   SELECT id, generation_context IS NOT NULL AS has_ctx,
          (SELECT COUNT(*) FROM prompt_executions WHERE content_id = c.id) AS chain_len
   FROM content_queue c
   ORDER BY created_at DESC LIMIT 1;
   ```
3. No `console.error('[prompt_logger]')` lines in the dry-run output.

**Commit shape:**
- One commit: `feat(lifecycle): wire prompt_logger + generation_context + render_profile_id into content gen`. Body lists the four sections of the piece page that this unblocks. Co-authored as usual.
- Push to `feat/piece-page-lifecycle`. Open a PR but do not merge until §4.4 lands too — the new write code will start producing rows that should be protected by the guardrail.

**Verification gate:** the next scheduled GitHub Actions content-gen run produces at least one new piece with `generation_context IS NOT NULL` and `(SELECT COUNT(*) FROM prompt_executions WHERE content_id = <new_id>) >= 1`.

### 4.2. Re-run orchestrator on the reference piece

The orchestrator filters its work queue with `render_status='pending' AND render_profile_id IS NOT NULL` (`agents/render-orchestrator.js:50-51`). The reference piece is `complete/NULL`, so it will not be picked up. Two sub-steps:

**4.2.1. Reset zombie state + assign a profile.** Run as a one-shot SQL migration so the change is auditable and reversible:

```sql
-- 20260509XXXXXX_backfill_zombie_render_3bcafc78.sql
WITH default_profile AS (
  SELECT id FROM render_profiles
  WHERE slug = 'static-image-v1'  -- pick the profile that matches piece.post_format; confirm at write time
  LIMIT 1
)
UPDATE content_queue
SET render_status      = 'pending',
    render_started_at  = NULL,
    render_completed_at = NULL,
    render_cost_usd    = NULL,
    final_asset_url    = NULL,
    render_profile_id  = (SELECT id FROM default_profile)
WHERE id = '3bcafc78-23f4-4c56-86aa-6221219dddbe';
```

The exact `render_profiles.slug` to use depends on what the piece needs — it's a text/static piece (not video), so `static-image-v1` or whichever profile matches `post_format`. Confirm by querying `render_profiles` before writing the migration.

**4.2.2. Trigger orchestrator.** Either wait for the next scheduled run, or invoke it directly:

```bash
node agents/render-orchestrator.js --piece-id 3bcafc78-23f4-4c56-86aa-6221219dddbe
```

(If the orchestrator doesn't have a single-piece flag, add one as a small CLI affordance — it's a one-line change and saves time on subsequent backfills.)

**Verification gate:** after the orchestrator completes, the piece has all of:
- `render_status='complete'`
- `render_started_at IS NOT NULL`
- `render_completed_at IS NOT NULL`
- `render_profile_id IS NOT NULL`
- `render_cost_usd >= 0`
- `final_asset_url` is a Supabase Storage URL (matches `https://fvxaykkmzsbrggjgdfjj.supabase.co/storage/v1/object/public/...` or equivalent), not a Drive URL.

Also: visiting the piece page in the UI shows the Render section's preview rendering correctly, with Profile name, Duration, and a non-zero Cost.

### 4.3. Harden `final_asset_url` against non-embeddable URLs

Two layers of defense.

**4.3.1. Write-time validation (primary).** The orchestrator already uploads to Supabase Storage and writes the public URL — the Drive URL on the reference piece was injected manually (likely a dev experiment). To prevent this category of bug from recurring, add a CHECK constraint:

```sql
-- 20260509YYYYYY_final_asset_url_must_be_embeddable.sql
ALTER TABLE content_queue
  ADD CONSTRAINT final_asset_url_embeddable
  CHECK (
    final_asset_url IS NULL
    OR final_asset_url ~ '^https://(fvxaykkmzsbrggjgdfjj\.supabase\.co/storage/v1/object/public/|[a-z0-9.-]+\.supabase\.co/storage/)'
    OR final_asset_url ~ '\.(mp4|jpg|jpeg|png|webp|gif)(\?.*)?$'
  ) NOT VALID;
-- NOT VALID: don't fail on the existing zombie until §4.2 reaches it.
```

After §4.2 backfills the reference piece, validate:

```sql
ALTER TABLE content_queue VALIDATE CONSTRAINT final_asset_url_embeddable;
```

**4.3.2. Read-time defensive translation (secondary).** `resolveOutputUrls` in `supabase/functions/content-queue/index.ts:73` should refuse to emit `output_urls.static` when the URL is non-embeddable, so legacy data or any future bypass of the constraint fails closed (no preview) rather than open (broken image icon):

```typescript
function isEmbeddable(url: string): boolean {
  if (/\.(mp4|jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(url)) return true;
  if (url.includes('.supabase.co/storage/')) return true;
  return false;
}

function resolveOutputUrls(piece: any): { video?: string; carousel_slides?: string[]; static?: string } {
  if (piece.final_asset_url?.endsWith('.mp4')) return { video: piece.final_asset_url };
  if (piece.final_asset_url && isEmbeddable(piece.final_asset_url)) return { static: piece.final_asset_url };
  if (Array.isArray(piece.slide_images) && piece.slide_images.length > 0) {
    return { carousel_slides: piece.slide_images.map((s: any) => s.url ?? s.image_url ?? s).filter(Boolean) };
  }
  if (piece.image_url && isEmbeddable(piece.image_url)) return { static: piece.image_url };
  return {};
}
```

The UI's `RenderPanel` already handles empty `output_urls` gracefully — it falls through to "No rendered asset yet." That's the correct fail-closed behavior.

**Recommended approach: do both.** Write-time is the real fix; read-time is a 5-line safety net for legacy rows and any future bypass.

**Decision deferred to executor:** whether to add an explicit Drive-URL translator (e.g. rewrite `drive.google.com/file/d/<id>/view` → `https://drive.google.com/uc?id=<id>`). Recommendation: **do not** — Drive `/uc?id=` URLs are unreliable for `<img>` (subject to quota interstitials, sign-in walls), and admitting them weakens the embeddability contract. The right answer is: assets live in Supabase Storage. The constraint enforces that.

**Verification gate:** the constraint is `VALIDATED`; an attempt to `UPDATE content_queue SET final_asset_url='https://drive.google.com/file/d/abc/view'` raises `ERROR 23514: violates check constraint "final_asset_url_embeddable"`.

### 4.4. DB guardrail against zombie `render_status='complete'`

The four-row leak this audit found existed because nothing prevented `UPDATE content_queue SET render_status='complete'` without going through the orchestrator. Same shape as 4.3 — write-time CHECK, with a `NOT VALID` declaration to allow staged cleanup:

```sql
-- 20260509ZZZZZZ_render_complete_must_have_started.sql
ALTER TABLE content_queue
  ADD CONSTRAINT render_complete_requires_started
  CHECK (
    render_status != 'complete'
    OR (render_started_at IS NOT NULL
        AND render_completed_at IS NOT NULL
        AND render_profile_id IS NOT NULL)
  ) NOT VALID;
```

The constraint requires three things together (started_at, completed_at, profile_id), not just `render_started_at`, because each is independently a marker of "the orchestrator actually ran." Without all three, the row is meaningless: the page shows blanks, downstream consumers (publishing, metrics) have no anchor.

**Cleanup of existing zombies.** Three rows besides the reference piece:
- `0c48679f-062f-4c87-adf4-afb3dd7b03c7` — "The sunscreen pediatricians actually recommend? It's $8 at Target."
- `52955325-80fa-464a-867a-1ce2ac608d9b` and `d84c27e9-5a79-44d0-9b36-8ebd034bb492` — same hook ("If your friend has it all together…"), apparent dup.

These have no `final_asset_url` either, so they were not even partial renders. Reset to `pending` (no `render_profile_id`, so they won't be picked up until someone assigns one):

```sql
UPDATE content_queue
SET render_status = 'pending',
    render_completed_at = NULL
WHERE id IN ('0c48679f-062f-4c87-adf4-afb3dd7b03c7',
             '52955325-80fa-464a-867a-1ce2ac608d9b',
             'd84c27e9-5a79-44d0-9b36-8ebd034bb492');
```

Then validate:

```sql
ALTER TABLE content_queue VALIDATE CONSTRAINT render_complete_requires_started;
```

**Verification gate:** running `UPDATE content_queue SET render_status='complete' WHERE id = <any-pending-piece>` raises `ERROR 23514: violates check constraint "render_complete_requires_started"`. The reference piece (post-§4.2) does NOT trigger the violation, because the orchestrator set all three timestamps.

---

## 5. Acceptance test

Single, complete end-to-end test:

1. Trigger one fresh content-gen run after §4.1 has merged: `node agents/ai-magic-content-gen.js --signals 1` (or the equivalent CLI flag; see the agent's own help).
2. Note the new `content_queue.id`.
3. Wait for the next orchestrator run (or invoke it directly per §4.2.2 with the new id).
4. Open `/pipeline/:id` in the dashboard and confirm all of:
   - **Generation section** populates: model, tokens in/out, cost, pillar input, format input, active directives, full prompt expandable.
   - **Prompt Chain section** populates: ≥1 step, each step has model, latency, cost, expandable system/user prompt and rendered output.
   - **Render section** populates: Profile name, Duration in seconds, non-zero Cost, working preview (image visible or video playable).
   - **Render preview** shows the actual asset, no broken-image icon.
5. Run the negative tests:
   ```sql
   -- Should both fail with constraint violations:
   UPDATE content_queue SET final_asset_url = 'https://drive.google.com/file/d/x/view' WHERE id = '<new_id>';
   UPDATE content_queue SET render_status = 'complete' WHERE id = (SELECT id FROM content_queue WHERE render_status = 'pending' LIMIT 1);
   ```

If all five gates pass: the spec is satisfied. Merge `feat/piece-page-lifecycle` to main.

---

## 6. Known gaps not addressed here

For honest documentation, listed here so they aren't re-discovered as new bugs:

- **Analytics section / `content_metrics` is empty.** `agents/metrics-fetcher.js` writes to the correct table but isn't producing rows. Tracked in YAR-94 (Apify secrets) and YAR-95 (analytics widget). Not in scope for this spec — the Analytics section is hidden until a piece is published, so this gap is invisible in normal flow.
- **Pre-V1.1 pieces have null `generation_context` / empty prompt chains.** Unrecoverable — original LLM calls are gone. The UI's empty-state copy ("This piece was created before the generation_context field was added; new pieces after V1.1 will populate this section.") already explains this. Not a bug; do not backfill.
- **19 RLS-disabled tables** flagged by Supabase advisory (incl. `agent_runs`, `cost_log`, `system_settings`, `system_directives`). Separate security workstream.

---

## 7. Linear

Open a Linear epic `PIECE_PAGE_DATA_FLOW_AUDIT_V1` with four issues, one per §4 sub-section. Acceptance test (§5) is the epic-level acceptance criterion. Mention YAR-94 / YAR-95 as related-not-blocking.
