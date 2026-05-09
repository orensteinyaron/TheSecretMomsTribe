-- Cost-honesty pass on the 3bcafc78 backfill (additive — does NOT rewrite
-- 20260509190000_backfill_3bcafc78_showcase.sql).
--
-- Spec: docs/specs/PIECE_3BCAFC78_BACKFILL_V1.md (per-row audit decided in
-- chat after first migration applied — same precedent as the qa_avatar
-- score-omission decision: cost and tokens for a row whose agent never
-- ran (or whose metrics aren't recoverable) is synthesized data, and
-- synthesized data poisons whatever analytics later read it. Move the
-- estimate to a separate field, leave the chain showing only what we
-- have evidence for).
--
-- Audit per row:
--   content_gen          ZERO OUT  (agent ran — content exists — but
--                                  msg.usage from the real call is
--                                  unrecoverable; numbers were synthesized)
--   avatar_script_prep   KEEP      ($0 deterministic, accurate)
--   tts_generation       KEEP      (cost derivable from scene_audio script
--                                  character counts × ElevenLabs eleven_v3
--                                  rate)
--   whisper_transcription KEEP     (cost derivable from 39.36s audio
--                                  duration × Whisper $0.006/min ceiling)
--   seedance_render      KEEP      (cost derivable from 6 confirmed
--                                  higgsfield_job_ids × ~$0.25 per clip
--                                  credit consumption)
--   qa_avatar            ZERO OUT  (agent never ran on this piece —
--                                  qa-agent-avatar.ts post-dates the
--                                  manual production run; estimate was
--                                  pure synthesis)
--   hook_card_render     KEEP      ($0 deterministic, accurate)
--   stitch               KEEP      ($0 deterministic, accurate)
--
-- Logged-cost row sum after this migration: $1.56 (was $2.15)
-- Estimated (un-logged) phases: content_gen $0.04 + qa_avatar $0.55 = $0.59
--   These move to generation_context._estimated_cost_breakdown
--
-- Also: content_queue.render_cost_usd reduced from $2.10 to $1.56 to match
-- the logged-cost chain sum. The Render Cost cell will under-count vs the
-- profile cost_estimate ($2.10) — that's accurate, it's the cost we have
-- evidence for. The full estimate is preserved in generation_context.
--
-- Idempotent: pure UPDATEs with content_id + step_name guards. Re-running
-- sets the same values; no duplicates created.

-- ============================================================================
-- 1. content_gen row: zero out synthesized cost + tokens. Add note in
--    output_json explaining why. The row stays (agent did run; the row is
--    proof) but the numeric metrics are NULL because we don't have the
--    real msg.usage.
-- ============================================================================

UPDATE prompt_executions
SET cost_usd = NULL,
    tokens_in = NULL,
    tokens_out = NULL,
    output_json = output_json || jsonb_build_object(
      '_cost_omitted_note',
      'content_gen ran on 2026-04-02 (content_queue.id=3bcafc78 exists with hook/caption/ai_magic_output as proof) but msg.usage from that real Sonnet call is unrecoverable. Token counts and cost were synthesized as estimates in V1 of this backfill; cleared in V2 of the spec''s cost-honesty pass to match the qa_avatar precedent. Estimated cost surfaced in content_queue.generation_context._estimated_cost_breakdown.'
    )
WHERE content_id = '3bcafc78-23f4-4c56-86aa-6221219dddbe'
  AND step_name = 'content_gen'
  AND status = 'reconstructed';

-- ============================================================================
-- 2. qa_avatar row: zero out — agent never ran. Add omission note.
--    Real score will be patched in per YAR-112.
-- ============================================================================

UPDATE prompt_executions
SET cost_usd = NULL,
    tokens_in = NULL,
    tokens_out = NULL,
    output_json = output_json || jsonb_build_object(
      '_cost_omitted_note',
      'qa-agent-avatar.ts did not run on this piece (predates the skill); estimated cost surfaced in content_queue.generation_context._estimated_cost_breakdown. Real score + tokens + cost will be patched per Linear issue YAR-112.'
    )
WHERE content_id = '3bcafc78-23f4-4c56-86aa-6221219dddbe'
  AND step_name = 'qa_avatar'
  AND status = 'reconstructed';

-- ============================================================================
-- 3. tts_generation: keep cost ($0.05). Add derivation note.
-- ============================================================================

UPDATE prompt_executions
SET output_json = output_json || jsonb_build_object(
      '_cost_derived_from',
      'ElevenLabs eleven_v3 audio generation cost is per-character. Scene scripts (in content_assets[scene_audio].metadata.script): SCENE_1 ~117c, SCENE_2A ~86c, SCENE_2B ~110c, SCENE_3A ~87c, SCENE_3B ~56c, SCENE_4 ~91c. Total ~547 chars. At eleven_v3 rate ~$0.0001/char (subscription-amortized), per-call attribution ≈ $0.05. The 6 scene_audio Drive files exist as proof of completion.'
    )
WHERE content_id = '3bcafc78-23f4-4c56-86aa-6221219dddbe'
  AND step_name = 'tts_generation'
  AND status = 'reconstructed';

-- ============================================================================
-- 4. whisper_transcription: keep cost ($0.01). Add derivation note.
-- ============================================================================

UPDATE prompt_executions
SET output_json = output_json || jsonb_build_object(
      '_cost_derived_from',
      'OpenAI whisper-1 priced at $0.006/min (ceiling). Final stitched audio duration 39.36s → ceil(39.36/60) = 1 min × $0.006 = $0.006, rounded to $0.01 in the per-piece cost budget. Transcript Drive file (1yB59NcU4uwGNQSvpHjd3RHIrkpAUVeYe) exists with word_count=100 as proof of completion.'
    )
WHERE content_id = '3bcafc78-23f4-4c56-86aa-6221219dddbe'
  AND step_name = 'whisper_transcription'
  AND status = 'reconstructed';

-- ============================================================================
-- 5. seedance_render: keep cost ($1.50). Add derivation note.
-- ============================================================================

UPDATE prompt_executions
SET output_json = output_json || jsonb_build_object(
      '_cost_derived_from',
      'Higgsfield Seedance 2.0 priced via credit consumption (~150 credits ≈ $1.50 for 6 clips at Creator-tier amortization, per skills/full-avatar-profile/SKILL.md cost budget). Six higgsfield_job_ids are recorded in output_json.scenes (0526abb9, b99bf306, 50b88ae2, 7443e0d2, e5dc3102, e44769e5) as proof of 6 actual renders; corresponding scene_clip Drive files all exist (content_assets WHERE asset_type=scene_clip). Subscription-amortized per-call cost is approximate but the artifact count is exact.'
    )
WHERE content_id = '3bcafc78-23f4-4c56-86aa-6221219dddbe'
  AND step_name = 'seedance_render'
  AND status = 'reconstructed';

-- ============================================================================
-- 6. content_queue: update render_cost_usd to logged-only sum + add the
--    estimated_cost_breakdown to generation_context.
-- ============================================================================

UPDATE content_queue
SET render_cost_usd = 1.56,
    generation_context = generation_context || jsonb_build_object(
      '_estimated_cost_breakdown', jsonb_build_object(
        'content_gen', 0.04,
        'qa_avatar',   0.55,
        'total_estimated', 0.59,
        'note',         'Costs for phases where the agent ran but msg.usage isn''t recoverable (content_gen) or where the agent never ran at all (qa_avatar). For budgeting reference only — render_cost_usd reflects only logged-cost rows ($1.56 sum across avatar_script_prep $0 + tts_generation $0.05 + whisper_transcription $0.01 + seedance_render $1.50 + hook_card_render $0 + stitch $0). Profile cost_estimate_usd ($2.10) ≈ logged $1.56 + estimated $0.59 — agreement within rounding. Real-time-logged pieces have neither this _estimated_cost_breakdown nor _cost_omitted_note keys; their render_cost_usd is the chain sum directly.'
      ),
      '_cost_honesty_pass_applied_at', NOW()::text
    )
WHERE id = '3bcafc78-23f4-4c56-86aa-6221219dddbe'
  AND (generation_context->>'_reconstructed')::boolean = true;
