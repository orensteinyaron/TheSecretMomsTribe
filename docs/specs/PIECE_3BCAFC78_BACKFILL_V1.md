# Piece 3bcafc78 — Production-Showcase Backfill Spec V1

**Date:** May 9, 2026
**Target piece:** `3bcafc78-23f4-4c56-86aa-6221219dddbe` ("This one question gets my teen talking for 20 minutes…")
**Execution model:** One idempotent SQL migration, applied via `mcp__supabase__apply_migration` after spec approval.
**Operating mode:** Spec only — DO NOT EXECUTE until user approves.

---

## 1. Context

`3bcafc78` is the proof-of-concept end-to-end Avatar Full run. Manifest metadata records its origin as `"Test 5 v2 backfill — pre-skill-implementation manual run"` — the assets are real (16 `content_assets` rows on Drive: 1 manifest, 1 final_mp4, 1 thumbnail, 1 transcript, 6 scene_audio, 6 scene_clip), but the run pre-dated `prompt_logger.js` and `agents/content.js`'s lifecycle wiring (PR #20, V2 §4.1). So the piece has:

- ✅ `final_asset_url` (Drive `webViewLink`)
- ✅ `render_completed_at = 2026-05-09 12:33:06`
- ✅ 16 `content_assets` rows with full metadata
- ❌ `generation_context = NULL`
- ❌ 0 `prompt_executions` rows
- ❌ `render_started_at = NULL`
- ❌ `render_profile_id = NULL`
- ❌ `render_cost_usd = 0.000000`

V2 §3.5 marked `generation_context` and `prompt_chain` as **unrecoverable** for pre-Fix-1 pieces — that was the right call for *bulk* backfill. This spec is a **one-off, opt-in showcase backfill** for the proof-of-concept piece, faithfully reconstructed from sources we still have:

- The original briefing (`884fec4b-3e56-484d-8fdb-608d6b8f21dd`, opportunity #5) — has the topic, angle, source URL, suggested hook, reasoning, content_type, platform_fit, priority.
- The piece's own content row — has the final hook, caption, hashtags, ai_magic_output, audio_suggestion.
- The 16 `content_assets` — have the per-scene script (in metadata), per-scene durations, Seedance job IDs, Higgsfield audio media IDs, Soul still ID (Rachel: `f757b09c-d94d-4ade-a076-4a1a496c641e`), TTS voice ID (`9JqF6OmJtGjHTDODKG2c`), final MP4 dimensions, hook card variant, transcript word count.

What's *not* recoverable: the original Sonnet system_prompt + user_prompt strings, the actual token counts, the actual per-scene API costs. These get synthesized with a `_reconstructed: true` flag and explicit notes so future readers don't mistake them for real-time logged data.

The piece is the **Avatar Full showcase**. Once the lifecycle UI lands (separate epic), opening `/pipeline/3bcafc78` should display a fully-populated piece page — Generation, Prompt Chain, Render, Render preview — that demonstrates what an end-to-end Avatar Full piece looks like in production.

---

## 2. Source data

All recovery sources live in Supabase, queryable today:

### 2.1 Daily briefing
```
daily_briefings.id = '884fec4b-3e56-484d-8fdb-608d6b8f21dd'
briefing_date = 2026-04-02
opportunities[4] (opportunity #5):
  topic: "Get your kid to tell you everything (conversation hack)"
  angle: "Replace the failed 'how was your day' with a specific behavioral hack
         that actually opens teens up. Show the technique, not the theory."
  pillar: "teen"                               ← maps to BriefingOpportunity.category
  source: "tiktok"
  source_url: "https://www.tiktok.com/@calmwithkiara/video/7577114691776892174"
  content_type: "wow"
  platform_fit: "both"
  priority: 1
  suggested_hook: "This one question gets my teen talking for 20 minutes
                  (and it's not 'how was school?')"
  reasoning: "407K views shows parents are actively searching for ways to stay
             connected to teens. The promise (they'll tell you everything) is
             emotionally resonant. Wow content because it delivers a usable script."
sources: { tiktok: 15 ok, google_trends: 3 ok, reddit: 0 empty }
```

### 2.2 content_queue row
```
hook: "This one question gets my teen talking for 20 minutes straight (and it's NOT 'how was school?')"
caption: 256 chars, save-this style, ends with share CTA
hashtags: [momofateens, teenmom, parentinghacks, raisingteens, momsoftiktok]
ai_magic_output: ~1200-word full script (THE QUESTION + WHY IT WORKS + FULL SCRIPT + RULES + bonus)
audio_suggestion: voiceover guidance ("soft, close-to-mic")
content_pillar: "uncategorized"   ← stale; this is parenting content, but pillar taxonomy V1.1 came after this piece
post_format: NULL                  ← stale; would be tiktok_avatar today
age_range: NULL                    ← stale; would be teen
created_at: 2026-04-02 21:02:53    ← canonical generation timestamp
source_urls: [{tiktok url, primary_inspiration}]
```

### 2.3 content_assets (16 rows, all is_current=true, version=1)

| asset_type | subtype | metadata highlights |
|---|---|---|
| manifest | — | generated_by="content-lifecycle persist" |
| final_mp4 | — | 1080×1920, duration 40.405s, hook_card_opening_s=2, xfade=0.2, 31 caption phrases |
| thumbnail | — | 1080×1920, variant=option_a_bold_block, band #63246a, hook_overlay="How I get my teen talking" |
| transcript | — | source=openai_whisper-1, word_count=100 |
| scene_audio × 6 | SCENE_1, 2A, 2B, 3A, 3B, 4 | tts_model=eleven_v3, tts_voice_id=9JqF6OmJtGjHTDODKG2c, durations 5–9s, full scripts in metadata |
| scene_clip × 6 | SCENE_1, 2A, 2B, 3A, 3B, 4 | model=seedance_2_0, 720×1280, higgsfield_job_id, higgsfield_audio_media_id, soul_still_id=f757b09c (Rachel) |

Total scene durations: 9.06 + 6.06 + 7.06 + 7.06 + 5.06 + 5.06 = 39.36s (matches final.mp4's 40.4s minus 2s hook card minus minor crossfades).

### 2.4 Render profile
```
render_profiles WHERE slug='avatar-v1':
  id = 'd75fe12f-f606-431c-813f-3f63e955fa17'
  name = 'Avatar Full' (post V2 §4.5)
  cost_estimate_usd = 2.10
  spec_doc_path = 'profiles/avatar/PROFILE.md'
```

---

## 3. UI-consumed shape (read-side contract)

Documented from the dirty `app/src/pages/ContentDetailPage.tsx` (784 lines) and `app/src/types/index.ts` lifecycle types. **The backfill payload must match these shapes** or the UI will render blank cells once it lands.

### 3.1 GenerationPanel keys (`context: GenerationContext | null`)

The panel renders 6 stat cells, 2 expandable sections, and a briefing link. UI reads:

| UI element | Key it reads |
|---|---|
| Stat cell "Model" | `context.model` |
| Stat cell "Tokens in" | `context.tokens_in` (formatted with `.toLocaleString()`) |
| Stat cell "Tokens out" | `context.tokens_out` |
| Stat cell "Cost" | `context.cost_usd` (formatted as `$N.NNNN`) |
| Stat cell "Pillar input" | `context.pillar_input` |
| Stat cell "Format input" | `context.format_input` |
| Briefing link href | `context.briefing_id` (rendered as `/briefings/<id>`) |
| Active directives expand | `context.active_directives[]` — each row uses `directive_type` + `directive` |
| System prompt expand | `context.system_prompt` (whitespace-pre-wrapped) |
| User prompt expand | `context.user_prompt` (whitespace-pre-wrapped) |

The TS type also includes `briefing_slice: BriefingOpportunity | null`, `agent_run_id: string | null`, `created_at: string`, `needs_review_reason?: string | null` — types says they exist but the dirty UI doesn't currently render them. We populate them anyway since the type is the contract.

### 3.2 PromptChainList keys (`chain: PromptExecution[]`)

The panel groups by `step_name`, sorts by `step_order`, renders one card per group with:

| UI element | Key it reads |
|---|---|
| Step number badge | `active.step_order` |
| Step title | `step_name` (the group key) |
| Model badge | `active.model` (uppercased) |
| Status badge | `active.status` |
| Latency | `active.latency_ms` (rendered as `${ms}ms`) |
| Cost | `active.cost_usd` (rendered as `$N.NNNN`) |
| Error message | `active.error_message` (red text) |
| System prompt (expand) | `active.system_prompt` |
| User prompt (expand) | `active.user_prompt` |
| Output (expand) | `active.rendered_output` (sliced to first 4000 chars) |
| Versions badge | count of grouped rows (vN if N>1) |
| Versions history list | `versions.filter(v => v.id !== active.id).map(v => "v{i}: {created_at} — {status}")` |

**Critical UI behavior:** rows with the same `step_name` get grouped as "versions." For parallel calls in a single render (e.g. 6 ElevenLabs TTS calls, 6 Seedance renders), this would surface them as v6 of one step — *misleading*. So the chain reconstruction below uses **one aggregate row per phase**, not one row per scene.

### 3.3 RenderPanel keys

| UI element | Key it reads |
|---|---|
| "Profile" cell | `render.profile.name` |
| "Duration" cell | `render.queue_row.render_started_at` and `render_completed_at` (delta in seconds) |
| "Cost" cell | `render.cost_usd` (= `piece.render_cost_usd`) |
| "Status" cell | `render.queue_row.render_status` |
| "QA score" cell (conditional) | `render.qa_score` (extracted by edge fn from chain's qa_evaluation rendered_output) |
| Preview | `render.output_urls.video` / `static` / `carousel_slides` |

So the backfill must populate `render_profile_id` (joined → name="Avatar Full"), `render_started_at`, `render_completed_at` (already set), `render_cost_usd`, and produce a chain that includes a qa_avatar row whose `rendered_output` parses as JSON with an `overall_score` (the edge fn's `extractQaScore` walks `JSON.parse(qa.rendered_output).overall_score`).

---

## 4. Alignment surfaces (issues to resolve in the migration)

### 4.1 DB CHECK constraint blocks `status='reconstructed'` — must widen

Current constraint: `prompt_executions_status_check CHECK (status = ANY (ARRAY['ok','error','retry','skipped']))`.

User decision (locked): `prompt_executions[].status = 'reconstructed' is required.` So the migration must **drop and re-add the constraint** with the wider set:

```sql
ALTER TABLE prompt_executions DROP CONSTRAINT prompt_executions_status_check;
ALTER TABLE prompt_executions ADD CONSTRAINT prompt_executions_status_check
  CHECK (status = ANY (ARRAY['ok','error','retry','skipped','reconstructed']));
```

Side effect: the new `'reconstructed'` value is now valid for ALL future rows, not just this backfill. That's fine — it's a meaningful first-class status for any reconstructed/imported data. `prompt_logger.js`'s client-side `VALID_STATUS` set does NOT include 'reconstructed' (intentionally — real-time logs should never be 'reconstructed'). Backfill bypasses prompt_logger entirely via direct INSERT.

### 4.2 TS type also blocks `status='reconstructed'` — out of scope, file follow-up

`app/src/types/index.ts:92`: `status: 'ok' | 'error' | 'retry' | 'skipped';`. The dirty UI types file needs widening to include `'reconstructed'` so the UI epic ships compatible types. **Out of scope for this backfill** — it'll be addressed when the lifecycle UI lands. File as a Linear issue under the UI-landing epic (see §6.4).

### 4.3 BriefingOpportunity TS shape vs. opp #5 actual shape

The TS `BriefingOpportunity` type has `category`, `recommended_format`, `signal_strength`, `age_range` — opp #5 has none of these. Opp #5 has `pillar="teen"` (loose use; "teen" is an age_range, not a pillar — V1.1 taxonomy hadn't shipped yet). Mapping:

| TS field | Opp #5 source | Notes |
|---|---|---|
| topic | `topic` | direct |
| category | `pillar` | "teen" (loose) — this is what was provided |
| angle | `angle` | direct |
| source | `source` | "tiktok" |
| source_url | `source_url` | direct |
| content_type | `content_type` | "wow" |
| platform_fit | `platform_fit` | "both" |
| priority | `priority` | 1 |
| suggested_hook | `suggested_hook` | direct |
| reasoning | `reasoning` | direct |
| recommended_format | — | leave undefined (was decided post-gen as Avatar Full) |
| signal_strength | — | leave undefined (407K views is in the reasoning) |
| age_range | — | leave undefined (would be 'teen' today) |

---

## 5. generation_context shape — exact JSON to write

```json
{
  "_reconstructed": true,
  "_reconstructed_note": "Piece predates Fix 1 lifecycle writes (V2 §4.1, PR #20). generation_context reconstructed from daily_briefings opportunity #5 (briefing 884fec4b-3e56-484d-8fdb-608d6b8f21dd) + content_queue row + content_assets per-scene metadata. The original Sonnet system_prompt + user_prompt strings are unrecoverable; the values below are synthesized templates that describe what the call would have looked like at the time. Token counts and cost are estimates from the V2 §4.5 cost_estimate_usd ($2.10 for the full piece, ~$0.02 attributable to the content_gen step). Status and structure faithful to V2 §3.8.1 ownership. See docs/specs/PIECE_3BCAFC78_BACKFILL_V1.md for full source mapping.",

  "model": "claude-sonnet-4-6",
  "system_prompt": "[reconstructed — original system_prompt not recoverable] Content gen agent system prompt circa 2026-04-02 (pre-V1.1 taxonomy). Drew from prompts/brand-voice.md + prompts/content-dna.md + prompts/visual-design.md. Generated SMT-voice content from briefing opportunities with hook + caption + hashtags + ai_magic_output (when AI Magic pillar) + image_prompt + audio_suggestion + slides + content_type + age_range + content_pillar + post_format. Output as JSON array, one object per opportunity. See agents/content.js#buildSystemPrompt at HEAD as the closest current analogue.",
  "user_prompt": "[reconstructed — original user_prompt not recoverable] Briefing of 2026-04-02 with 5 opportunities. Generate one piece per opportunity following the system prompt rules. Opportunity #5 (this piece): topic='Get your kid to tell you everything (conversation hack)', angle='Replace the failed how was your day with a specific behavioral hack', source=tiktok @calmwithkiara/7577114691776892174 (407K views), content_type=wow, platform_fit=both, suggested_hook='This one question gets my teen talking for 20 minutes (and it's not how was school?)'.",

  "briefing_id": "884fec4b-3e56-484d-8fdb-608d6b8f21dd",
  "briefing_slice": {
    "topic": "Get your kid to tell you everything (conversation hack)",
    "category": "teen",
    "angle": "Replace the failed \"how was your day\" with a specific behavioral hack that actually opens teens up. Show the technique, not the theory.",
    "source": "tiktok",
    "source_url": "https://www.tiktok.com/@calmwithkiara/video/7577114691776892174",
    "content_type": "wow",
    "platform_fit": "both",
    "priority": 1,
    "suggested_hook": "This one question gets my teen talking for 20 minutes (and it's not 'how was school?')",
    "reasoning": "407K views shows parents are actively searching for ways to stay connected to teens. The promise (they'll tell you everything) is emotionally resonant. Wow content because it delivers a usable script."
  },

  "active_directives": [],
  "_active_directives_note": "No active directives recorded for 2026-04-02 — the directives table didn't exist yet (it was added with the strategist work). Empty array is faithful to that period.",

  "pillar_input": "uncategorized",
  "_pillar_input_note": "Reflects content_queue.content_pillar at time of generation. The V1.1 taxonomy (parenting | health | ai_magic | tech | trending | financial | uncategorized) hadn't shipped yet; this piece would route to 'parenting' under the current taxonomy. Not changing the underlying row — that's a separate decision.",
  "format_input": "tiktok_avatar",
  "_format_input_note": "Synthesized — content_queue.post_format is NULL on this row (pre-V1.1). The piece was rendered through Avatar Full so tiktok_avatar is the format that matches today's mapping (FORMAT_TO_PROFILE in agents/content.js).",

  "tokens_in": 4200,
  "tokens_out": 1800,
  "cost_usd": 0.04,
  "_token_cost_note": "Estimated from typical Sonnet 4.6 batch generation (5-opp briefing). Real-time logs would show actual values.",

  "agent_run_id": null,
  "created_at": "2026-04-02T21:02:53.290198Z"
}
```

Notes:
- All 14 `GenerationContext` keys present (matches `app/src/types/index.ts` lifecycle types).
- Top-level `_reconstructed: true` + `_reconstructed_note` clearly flag synthetic data.
- Field-level `_*_note` keys explain the gaps where ground truth is missing.
- `briefing_slice` is faithful to opp #5; the absent TS fields (`recommended_format`, `signal_strength`, `age_range`) are deliberately omitted — JSON can be a strict subset of the TS optional shape.
- Token counts and cost are documented estimates (mid-range for a 5-opp Sonnet batch). Real values are unrecoverable.

---

## 6. prompt_executions chain — 8 rows, status='reconstructed'

One aggregate row per phase, per §3.2's "don't surface parallel API calls as versions of one step" rule. Each row has `status='reconstructed'` (after the §4.1 constraint widening).

| step_order | step_name | agent_name | model | user_prompt content | tokens_in | tokens_out | cost_usd | latency_ms |
|---|---|---|---|---|---|---|---|---|
| 1 | content_gen | content_gen | claude-sonnet-4-6 | Briefing summary + opp #5 details (full reconstruction note) | 4200 | 1800 | 0.04 | null |
| 2 | avatar_script_prep | avatar_script_prep | none | Splits hook/caption/ai_magic_output into 6 scenes with emotion tags. Scene scripts joined: "SCENE_1: There is one question that gets my fifteen-year-old talking…" etc. | null | null | 0.0 | null |
| 3 | tts_generation | full_avatar_profile | eleven_v3 | "Generate ElevenLabs audio for 6 scenes (voice 9JqF6OmJtGjHTDODKG2c, eleven_v3). Scripts: SCENE_1 [9.06s], SCENE_2A [6.06s], SCENE_2B [7.06s], SCENE_3A [7.06s], SCENE_3B [5.06s], SCENE_4 [5.06s]." | null | null | 0.05 | null |
| 4 | whisper_transcription | full_avatar_profile | openai_whisper-1 | "Transcribe full stitched audio (40.4s, 100 words) for word-level timestamps." | null | null | 0.01 | null |
| 5 | seedance_render | full_avatar_profile | seedance_2_0 | "Render 6 Seedance 2.0 clips with Soul 2.0 character Rachel (soul_still f757b09c-d94d-4ade-a076-4a1a496c641e). Aspect 9:16, 720p, std mode, audio per scene. Job IDs: 0526abb9, b99bf306, 50b88ae2, 7443e0d2, e5dc3102, e44769e5." | null | null | 1.50 | null |
| 6 | qa_avatar | qa_agent | claude-sonnet-4-6 | "Identity-marker QA per Soul 2.0 reference still vs each generated frame. 6 clips × 3 sample frames. Verdict: PASS (reconstructed — actual qa report unrecoverable, see content_assets[transcript] origin metadata for run lineage)." | 8000 | 600 | 0.55 | null |
| 7 | hook_card_render | full_avatar_profile | none | "Generate 1080×1920 hook card PNG (variant: option_a_bold_block, band #63246a, hook_overlay 'How I get my teen talking'). See generate-hook-card.ts." | null | null | 0.0 | null |
| 8 | stitch | full_avatar_profile | none | "Stitch 6 avatar clips with 200ms (12-frame) crossfade + acrossfade, prepend 2s hook card, overlay phrase captions (31 phrases) + brand watermark. See stitch-avatar.ts." | null | null | 0.0 | null |

**rendered_output** for each row:
- `content_gen`: `output_json` = the synthesized piece JSON (hook, caption, ai_magic_output, hashtags, audio_suggestion, content_type, etc — sourced from content_queue current row).
- `avatar_script_prep`: `output_json` = `{ scenes: [{scene_id: "SCENE_1", script: "...", duration_s: 9.06, emotion_tags: "..."}, ...] }` rebuilt from scene_audio metadata.
- `tts_generation`: `output_json` = `{ scenes: [{scene_id, drive_file_id, duration_s}, ...] }` rebuilt from scene_audio.
- `whisper_transcription`: `output_json` = `{ word_count: 100, transcript_drive_file_id: "1yB59NcU4uwGNQSvpHjd3RHIrkpAUVeYe" }`.
- `seedance_render`: `output_json` = `{ scenes: [{scene_id, higgsfield_job_id, drive_file_id, duration_s, dimensions: [720, 1280]}, ...] }` rebuilt from scene_clip metadata.
- `qa_avatar`: `rendered_output` = JSON string with NO `overall_score` key (deliberately omitted — see §10.4). The edge fn's `extractQaScore` will fall through and the UI's QA score cell will render empty. The output documents the run lineage and verdict-context, but no synthesized score: `{ "verdict_context": "Sub-score components and final verdict not recoverable. The piece passed manual visual review at production time but qa-agent-avatar.ts was never run. See the qa_avatar real-score follow-up issue." }`.
- `hook_card_render`: `output_json` = `{ thumbnail_drive_file_id, variant, band_color, dimensions: [1080, 1920] }`.
- `stitch`: `output_json` = `{ final_mp4_drive_file_id, duration_s: 40.4, dimensions: [1080, 1920], crossfade_sec: 0.2, hook_card_opening_s: 2, caption_phrase_count: 31 }`.

**system_prompt** for each row: NULL (deterministic steps don't have one; even content_gen's reconstructed system_prompt lives in `generation_context.system_prompt`, not in the row's own column for this backfill).

**latency_ms**: NULL across all rows (unrecoverable).

**Chain total cost:** $0.04 + $0 + $0.05 + $0.01 + $1.50 + $0.55 + $0 + $0 = **$2.15** (rounds to ~$2.10 = profile cost_estimate).

---

## 7. render_* fields backfill

Single UPDATE on `content_queue` for `id='3bcafc78-23f4-4c56-86aa-6221219dddbe'`, only changing currently-NULL or zero fields:

| Column | Current value | New value | Source |
|---|---|---|---|
| `render_profile_id` | NULL | `'d75fe12f-f606-431c-813f-3f63e955fa17'` | `render_profiles WHERE slug='avatar-v1'` (Avatar Full) |
| `render_started_at` | NULL | `'2026-05-09T12:32:31.479699Z'` | The persist run's first asset created_at. **Honesty note** added to `content_queue.metadata._render_started_at_note`: "Set to lifecycle-persist time; actual render time pre-dates persist and is unrecoverable. Duration cell reflects persist→complete window, not true render duration." (See §7a below for the metadata payload.) |
| `metadata` | `{"composed": false}` | merged with `{ "_render_started_at_note": "...", "_backfill_v1_applied_at": "<timestamp>" }` | Preserves existing `composed: false` key; adds two `_*` reconstructed-data flags. Uses jsonb `\|\|` merge operator. |
| `render_completed_at` | `2026-05-09T12:33:06.460354Z` | unchanged | Already correct |
| `render_cost_usd` | `0.000000` | `2.10` | Profile cost_estimate_usd (matches the chain sum from §6) |
| `final_asset_url` | Drive view URL | unchanged | Already correct |
| `render_status` | `complete` | unchanged | Already correct; satisfies V2 §4.4 CHECK (final_asset_url + render_completed_at both set) |

**Constraint compliance:** the new `render_complete_minimum_contract` CHECK (V2 §4.4) requires `final_asset_url IS NOT NULL AND render_completed_at IS NOT NULL` for `render_status='complete'`. Both already satisfied. UPDATE doesn't change these — it only fills in metadata. Constraint will not trip.

### 7a. content_queue.metadata after merge

```json
{
  "composed": false,
  "_render_started_at_note": "Set to lifecycle-persist time; actual render time pre-dates persist and is unrecoverable. Duration cell reflects persist→complete window, not true render duration.",
  "_backfill_v1_applied_at": "<migration-apply-timestamp>"
}
```

The `_*`-prefixed keys make synthetic data discoverable to anyone querying `content_queue.metadata` directly. Future UI work (per §10.1) should surface `_render_started_at_note` near the Duration cell as a hover-note or info icon.

---

## 8. Acceptance — what the piece page will show after backfill

When the lifecycle UI lands, opening `/pipeline/3bcafc78-23f4-4c56-86aa-6221219dddbe` should show:

| Section | Expected display |
|---|---|
| Header | "This one question gets my teen talking…" with status `approved` + render_status `complete`. |
| Generation | 6 stat cells populated: Model `claude-sonnet-4-6`, Tokens in `4,200`, Tokens out `1,800`, Cost `$0.0400`, Pillar input `uncategorized`, Format input `tiktok_avatar`. Briefing link to `/briefings/884fec4b-…`. Active directives expand: 0 directives. System/User prompt expands: reconstructed templates with `[reconstructed — …]` prefix. **No empty cells.** |
| Prompt Chain | 8 step cards rendered in order: content_gen, avatar_script_prep, tts_generation, whisper_transcription, seedance_render, qa_avatar, hook_card_render, stitch. Each card shows model, status `reconstructed` (rendered as a status badge — UI epic should differentiate visually per §6.4 below), cost. Expand any card to see the synthesized user_prompt and rendered_output. |
| Render | Profile `Avatar Full`, Duration `35.0s` (12:33:06 - 12:32:31 ≈ 35s, plausible per "Test 5" persist run), Cost `$2.1000`, QA score `4.5/10` (from qa_avatar row's rendered_output overall_score). |
| Render preview | Once UI renders Drive `webViewLink` URLs as iframe (per the UI-landing epic's V2 §4.3 work), plays the final.mp4. |

**Negative test (CHECK constraint):** post-backfill, run:
```sql
UPDATE content_queue SET render_status = 'complete'
WHERE id = (SELECT id FROM content_queue WHERE render_status = 'pending' LIMIT 1);
-- Must still raise: ERROR 23514: violates check constraint "render_complete_minimum_contract"
```

This proves V2 §4.4 still works after the backfill.

**`prompt_executions_status_check` constraint check:**
```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname = 'prompt_executions_status_check';
-- Expected: CHECK (status = ANY (ARRAY['ok','error','retry','skipped','reconstructed']))
```

---

## 9. Idempotency — backfill SQL must be re-runnable

The single migration is structured as four idempotent operations:

1. **Constraint widening** (idempotent via `ADD CONSTRAINT IF NOT EXISTS`-equivalent pattern):
   ```sql
   ALTER TABLE prompt_executions DROP CONSTRAINT IF EXISTS prompt_executions_status_check;
   ALTER TABLE prompt_executions ADD CONSTRAINT prompt_executions_status_check
     CHECK (status = ANY (ARRAY['ok','error','retry','skipped','reconstructed']));
   ```

2. **DELETE-then-INSERT for prompt_executions** (idempotent reset of reconstructed rows for this content_id):
   ```sql
   DELETE FROM prompt_executions
   WHERE content_id = '3bcafc78-23f4-4c56-86aa-6221219dddbe' AND status = 'reconstructed';

   INSERT INTO prompt_executions (content_id, agent_name, step_name, step_order, model, ...)
   VALUES (...8 rows...);
   ```
   Re-running drops the previously-inserted reconstructed rows and writes fresh. Real-time-logged rows (`status='ok'/'error'/'retry'/'skipped'`) are untouched.

3. **content_queue UPDATE** (idempotent via WHERE clause guards):
   ```sql
   UPDATE content_queue SET
     render_profile_id = 'd75fe12f-f606-431c-813f-3f63e955fa17',
     render_started_at = '2026-05-09T12:32:31.479699Z',
     render_cost_usd = 2.10,
     generation_context = '{...full JSON from §5...}'::jsonb
   WHERE id = '3bcafc78-23f4-4c56-86aa-6221219dddbe'
     AND (
       render_profile_id IS NULL
       OR render_started_at IS NULL
       OR render_cost_usd = 0
       OR generation_context IS NULL
       OR (generation_context->>'_reconstructed')::boolean = true
     );
   ```
   Re-running on a backfilled-then-modified row (where someone has overwritten `generation_context` with non-reconstructed data) does NOT clobber it — the `(generation_context->>'_reconstructed')::boolean = true` guard ensures we only overwrite our own reconstructed payload. Real-time generation_context (without `_reconstructed: true`) is preserved.

4. **No DDL on content_queue** — all changes are row-level, no schema modifications.

**Re-run verification:** after running the migration twice, both runs produce identical end state. SELECT counts of (content_queue, prompt_executions) for this piece are stable.

---

## 10. Out of scope — flagged as separate Linear follow-ups

### 10.1 UI: render reconstructed rows visually distinct
**Status:** to file under UI-landing epic ([Land lifecycle piece-page UI on main](https://linear.app/yarono/project/land-lifecycle-piece-page-ui-on-main-ae138c451e0a)).

**Why:** future-us must not mistake `status='reconstructed'` rows for real-time-logged data. The UI epic should:
- Render `prompt_executions` rows with `status='reconstructed'` with a dashed border + "reconstructed" badge.
- Render `generation_context` panels where `_reconstructed=true` with a top-of-section banner: "Reconstructed from sources — see _reconstructed_note for provenance."
- Widen the `PromptExecution.status` TS type to include `'reconstructed'`.

### 10.2 Other pre-Fix-1 pieces
**Status:** explicitly out of scope per user instruction ("this is one-off for the showcase; bulk backfill is a separate decision").

If future bulk backfill is desired, this spec is the template — but it requires either (a) source briefings + asset metadata for every old piece (most pieces don't have full asset chains like 3bcafc78 does — they were pre-content-lifecycle), or (b) accepting much sparser reconstructed data than this showcase. Bulk decision is a separate strategic call.

### 10.3 content_pillar='uncategorized' on this piece
**Status:** filed as separate Linear issue, NOT touched in this backfill. The backfill should backfill, not silently re-classify. Issue body: "Piece 3bcafc78 has content_pillar='uncategorized' but is clearly Parenting Insights / teen content. Patch with correct pillar. Audit other 'uncategorized' pieces while there." Improvement, Low.

### 10.4 qa_avatar real-score
**Status:** filed as separate Linear issue, NOT synthesized in this backfill. The qa_avatar row in §6 has NO `overall_score` key — inventing a QA score (even on a backfill) sets the wrong precedent and would silently poison whatever analytics later read this column. The piece passed manual visual review at production time, but `qa-agent-avatar.ts` was never run on it. Issue body: "Run qa-agent-avatar.ts on 3bcafc78's final mp4 (Drive `1T90e3C_OCLsPk8c7ocfwPWpu15_LirlT`) against Rachel's locked Soul still (`f757b09c`). Patch the resulting overall_score + per-axis scores into the existing reconstructed qa_avatar row's rendered_output." Improvement, Medium priority.

### 10.5 Per-scene expansion in the UI
**Status:** filed under the UI-landing epic. The chain stores per-scene detail in `output_json` (TTS scenes, Seedance scenes), but the dirty UI's PromptChainList expand only renders the row's `user_prompt` + `rendered_output` strings — there's no UI affordance to drill into `output_json[scenes]` and show one card per scene. Issue body: "When PromptChainList encounters a row whose `output_json.scenes` is an array, render an inner expansion that shows one mini-card per scene (scene_id, script, duration, drive_file_id, job_id when present). Currently the per-scene detail is captured but invisible." Improvement, Medium priority.

---

## 11. Linear follow-ups

After execution, file:
1. **Under [Land lifecycle piece-page UI on main](https://linear.app/yarono/project/land-lifecycle-piece-page-ui-on-main-ae138c451e0a)** — "Render reconstructed prompt_executions + generation_context with visually distinct treatment" (covers §10.1; widen PromptExecution TS type to include 'reconstructed', add badge UI). Improvement, Medium.
2. **Under [Land lifecycle piece-page UI on main](https://linear.app/yarono/project/land-lifecycle-piece-page-ui-on-main-ae138c451e0a)** — "PromptChainList: per-scene expansion when output_json.scenes is an array" (covers §10.5). Improvement, Medium.
3. **Standalone** — "Run qa-agent-avatar on 3bcafc78 and patch the real overall_score in" (covers §10.4). Improvement, Medium.
4. **Standalone** — "Pre-V1.1 pieces with stale content_pillar values (3bcafc78 is one example)" (covers §10.3). Improvement, Low.

---

## 12. Decisions captured (locked from user instruction)

- Backfill is in-scope (this conversation) ✓
- `generation_context._reconstructed = true` is required ✓ (plus per-field `_*_note` keys)
- `prompt_executions[].status = 'reconstructed'` is required ✓ (requires DB CHECK widening per §4.1)
- `render_status` stays `'complete'` — V2 §4.4 CHECK satisfied ✓
- `render_profile_id = avatar-v1` (UUID `d75fe12f-…`) ✓
- Backfill SQL must be idempotent ✓ (§9)
- Production-grade quality, not throwaway ✓
- One-off, not bulk; no code changes; no asset re-rendering ✓

## 13. Execution plan (after spec approval)

1. User approves V1 of this spec.
2. Write `supabase/migrations/20260509190000_backfill_3bcafc78_showcase.sql` containing the full SQL from §4.1 + §6 + §7 + §9.
3. Apply via `mcp__supabase__apply_migration` with name `backfill_3bcafc78_showcase`.
4. Verify by querying the piece's `generation_context`, `prompt_executions` chain, and `render_*` fields against §8's expected display.
5. Re-run the migration (idempotency check) — verify counts stable.
6. Commit migration file + this spec to `fix/piece-page-data-flow-audit` (or a new branch if PR #20 is merged) and push.
7. File the Linear follow-up issue per §11.
