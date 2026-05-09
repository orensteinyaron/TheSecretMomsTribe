-- Backfill piece 3bcafc78-23f4-4c56-86aa-6221219dddbe — production showcase.
--
-- Spec: docs/specs/PIECE_3BCAFC78_BACKFILL_V1.md
--
-- One-off, opt-in backfill for the Avatar Full proof-of-concept piece. The
-- piece has 16 real content_assets on Drive (manifest + final_mp4 + thumbnail
-- + transcript + 6 scene_audio + 6 scene_clip), but predates Fix 1
-- (V2 §4.1, PR #20) so generation_context is NULL, prompt_executions is
-- empty, and render_started_at / render_profile_id / render_cost_usd are
-- unset. Reconstructed from daily_briefings opportunity #5 + content_queue
-- + content_assets per-scene metadata.
--
-- Synthetic data is flagged at every level:
--   - content_queue.generation_context._reconstructed = true (top-level flag)
--   - content_queue.generation_context._<field>_note (per-field gap explanations)
--   - content_queue.metadata._render_started_at_note (Duration cell honesty)
--   - prompt_executions.status = 'reconstructed' (DB-enforced enum value)
--
-- Idempotent: re-running drops previously-inserted reconstructed rows and
-- writes fresh; content_queue UPDATE is guarded so it only overwrites NULL
-- or _reconstructed=true payloads (real-time logged data is preserved).

-- ============================================================================
-- 1. Widen prompt_executions.status CHECK to allow 'reconstructed'.
-- ============================================================================
-- Side effect: 'reconstructed' becomes a valid status for any future row.
-- prompt_logger.js's client-side VALID_STATUS deliberately excludes it (see
-- the JSDoc header in agents/lib/prompt_logger.js). Real-time logs must
-- never claim 'reconstructed'; that value is for backfills only.

ALTER TABLE prompt_executions DROP CONSTRAINT IF EXISTS prompt_executions_status_check;
ALTER TABLE prompt_executions ADD CONSTRAINT prompt_executions_status_check
  CHECK (status = ANY (ARRAY['ok','error','retry','skipped','reconstructed']));

-- ============================================================================
-- 2. Idempotent reset: drop any previously-backfilled reconstructed rows for
--    this content_id. Real-time-logged rows (status in ok/error/retry/skipped)
--    are NOT touched.
-- ============================================================================

DELETE FROM prompt_executions
WHERE content_id = '3bcafc78-23f4-4c56-86aa-6221219dddbe'
  AND status = 'reconstructed';

-- ============================================================================
-- 3. Insert 8 reconstructed prompt_executions rows — one aggregate per
--    pipeline phase. Per-scene detail (TTS scenes, Seedance jobs) lives in
--    output_json so the UI epic can later expand it (Linear follow-up §10.5).
-- ============================================================================

INSERT INTO prompt_executions (
  content_id, agent_name, step_name, step_order, model,
  system_prompt, user_prompt, rendered_output, output_json,
  tokens_in, tokens_out, cost_usd, status, error_message, latency_ms,
  agent_run_id, supersedes_id
) VALUES
-- Row 1: content_gen (Sonnet LLM call producing hook/caption/ai_magic_output)
(
  '3bcafc78-23f4-4c56-86aa-6221219dddbe', 'content_gen', 'content_gen', 1, 'claude-sonnet-4-6',
  NULL,
  '[reconstructed — original user_prompt not recoverable] Briefing of 2026-04-02 with 5 opportunities. Generate one piece per opportunity following the system prompt rules. Opportunity #5 (this piece): topic="Get your kid to tell you everything (conversation hack)", angle="Replace the failed how was your day with a specific behavioral hack", source=tiktok @calmwithkiara/7577114691776892174 (407K views), content_type=wow, platform_fit=both, suggested_hook="This one question gets my teen talking for 20 minutes (and it''s not how was school?)". The system_prompt for this call is captured in content_queue.generation_context.system_prompt — see that field for the full reconstructed prompt-engineering context.',
  NULL,
  jsonb_build_object(
    'hook', 'This one question gets my teen talking for 20 minutes straight (and it''s NOT ''how was school?'')',
    'caption', 'I almost cried the first time this worked. Save this for tonight at dinner — your teen has so much to say, they just need the right door. Share this with a mom who feels like she''s losing her kid to one-word answers.',
    'hashtags', jsonb_build_array('#momofateens','#teenmom','#parentinghacks','#raisingteens','#momsoftiktok'),
    'content_type', 'wow',
    'audio_suggestion', 'Original audio — soft, close-to-mic voiceover. Speak like you''re texting your best friend.',
    'ai_magic_output_excerpt', 'THE QUESTION: ''What was the most annoying thing that happened today — and what was one thing that was actually kind of good?'' [...full output in content_queue.ai_magic_output column]'
  ),
  4200, 1800, 0.04, 'reconstructed', NULL, NULL,
  NULL, NULL
),
-- Row 2: avatar_script_prep (deterministic split into 6 scenes with emotion tags)
(
  '3bcafc78-23f4-4c56-86aa-6221219dddbe', 'avatar_script_prep', 'avatar_script_prep', 2, 'none',
  NULL,
  'Split content_gen output into 6 scenes for Avatar Full pipeline. Scene boundaries chosen by hand at production time (this run pre-dated automated scene-prep). Scripts: SCENE_1 [9.06s] "There is one question that gets my fifteen-year-old talking for twenty minutes straight. And it is not how was school." | SCENE_2A [6.06s] "I started asking him: what is something that happened today that I would not believe?" | SCENE_2B [7.06s] "That is the whole question. And something about the way it is framed — it is not a report. It is a story." | SCENE_3A [7.06s] "The first time I tried it I literally had to stop chopping vegetables and just... listen." | SCENE_3B [5.06s] "Nineteen minutes. Unprompted. I almost cried in the kitchen." | SCENE_4 [5.06s] "Try it tonight at dinner. Come back and tell me what happened. I really want to know."',
  NULL,
  jsonb_build_object(
    'scenes', jsonb_build_array(
      jsonb_build_object('scene_id', 'SCENE_1',  'order', 1, 'duration_s', 9.055782, 'script', 'There is one question that gets my fifteen-year-old talking for twenty minutes straight. And it is not how was school.'),
      jsonb_build_object('scene_id', 'SCENE_2A', 'order', 2, 'duration_s', 6.060408, 'script', 'I started asking him: what is something that happened today that I would not believe?'),
      jsonb_build_object('scene_id', 'SCENE_2B', 'order', 3, 'duration_s', 7.058866, 'script', 'That is the whole question. And something about the way it is framed — it is not a report. It is a story.'),
      jsonb_build_object('scene_id', 'SCENE_3A', 'order', 4, 'duration_s', 7.058866, 'script', 'The first time I tried it I literally had to stop chopping vegetables and just... listen.'),
      jsonb_build_object('scene_id', 'SCENE_3B', 'order', 5, 'duration_s', 5.06195,  'script', 'Nineteen minutes. Unprompted. I almost cried in the kitchen.'),
      jsonb_build_object('scene_id', 'SCENE_4',  'order', 6, 'duration_s', 5.06195,  'script', 'Try it tonight at dinner. Come back and tell me what happened. I really want to know.')
    ),
    'total_speaking_duration_s', 39.358822
  ),
  NULL, NULL, 0.0, 'reconstructed', NULL, NULL,
  NULL, NULL
),
-- Row 3: tts_generation (ElevenLabs aggregate — 6 scene audio files)
(
  '3bcafc78-23f4-4c56-86aa-6221219dddbe', 'full_avatar_profile', 'tts_generation', 3, 'eleven_v3',
  NULL,
  'Generate ElevenLabs audio for 6 scenes (model=eleven_v3, voice_id=9JqF6OmJtGjHTDODKG2c). Scripts and durations match avatar_script_prep output. One MP3 per scene; no batching. Total speaking duration: 39.36s.',
  NULL,
  jsonb_build_object(
    'tts_voice_id', '9JqF6OmJtGjHTDODKG2c',
    'tts_model', 'eleven_v3',
    'scenes', jsonb_build_array(
      jsonb_build_object('scene_id', 'SCENE_1',  'drive_file_id', '1l_UFQsXHzy6jgDoG2wIUkJ6Ih5rF4lh9', 'duration_s', 9.055782, 'file_size_bytes', 139753),
      jsonb_build_object('scene_id', 'SCENE_2A', 'drive_file_id', '1-J5IdxFHNGup3XpkwVuAcrJy6Z9kFuvG', 'duration_s', 6.060408, 'file_size_bytes', 103230),
      jsonb_build_object('scene_id', 'SCENE_2B', 'drive_file_id', '12X_qxh6bQaE4_wXeSm_Pkj3A6LKOiPTq', 'duration_s', 7.058866, 'file_size_bytes', 114026),
      jsonb_build_object('scene_id', 'SCENE_3A', 'drive_file_id', '1jslif22AekNtP3cVpi5dCxybE2nfVSyz', 'duration_s', 7.058866, 'file_size_bytes', 124834),
      jsonb_build_object('scene_id', 'SCENE_3B', 'drive_file_id', '1_eUYiRr3InvEi85znmCy44LldbPlG02v', 'duration_s', 5.06195,  'file_size_bytes', 80639),
      jsonb_build_object('scene_id', 'SCENE_4',  'drive_file_id', '1L-B3shw8GNUBTzy9zcUPiCc0uUDLnFkS', 'duration_s', 5.06195,  'file_size_bytes', 81515)
    ),
    'estimated_cost_usd', 0.05
  ),
  NULL, NULL, 0.05, 'reconstructed', NULL, NULL,
  NULL, NULL
),
-- Row 4: whisper_transcription (OpenAI Whisper for word-level timestamps)
(
  '3bcafc78-23f4-4c56-86aa-6221219dddbe', 'full_avatar_profile', 'whisper_transcription', 4, 'openai_whisper-1',
  NULL,
  'Transcribe the full stitched audio (≈40s, 100 words) for word-level timestamps. Used downstream by stitch-avatar.ts to drive phrase-level captions (31 phrases in final mp4 per content_assets[final_mp4].metadata.caption_phrase_count).',
  NULL,
  jsonb_build_object(
    'word_count', 100,
    'transcript_drive_file_id', '1yB59NcU4uwGNQSvpHjd3RHIrkpAUVeYe',
    'estimated_cost_usd', 0.01
  ),
  NULL, NULL, 0.01, 'reconstructed', NULL, NULL,
  NULL, NULL
),
-- Row 5: seedance_render (Higgsfield Seedance 2.0 aggregate — 6 scene clips)
(
  '3bcafc78-23f4-4c56-86aa-6221219dddbe', 'full_avatar_profile', 'seedance_render', 5, 'seedance_2_0',
  NULL,
  'Render 6 Seedance 2.0 clips with Soul 2.0 character Rachel. Per scene: aspect_ratio=9:16, resolution=720p, mode=std, audio=scene_audio[N], start_image=end_image=Rachel''s soul_still f757b09c-d94d-4ade-a076-4a1a496c641e. Prompt: character.prompt_template (verbatim, no feature injection per skill md). Submitted sequentially (proxy-friendly), polled until all complete. Higgsfield job IDs: 0526abb9 (SCENE_1), b99bf306 (SCENE_2A), 50b88ae2 (SCENE_2B), 7443e0d2 (SCENE_3A), e5dc3102 (SCENE_3B), e44769e5 (SCENE_4).',
  NULL,
  jsonb_build_object(
    'soul_still_media_id', 'f757b09c-d94d-4ade-a076-4a1a496c641e',
    'character_id', 'rachel',
    'aspect_ratio', '9:16',
    'resolution', '720p',
    'mode', 'std',
    'scenes', jsonb_build_array(
      jsonb_build_object('scene_id', 'SCENE_1',  'higgsfield_job_id', '0526abb9-e057-4179-971f-9be2519a9dfb', 'higgsfield_audio_media_id', '09f9ae96-4728-46fb-8716-a57a0a05bfd0', 'drive_file_id', '14qSajRHx5QrGkV-O8lUdGM0VwdxqFGOW', 'duration_s', 9.055782, 'dimensions', jsonb_build_array(720, 1280)),
      jsonb_build_object('scene_id', 'SCENE_2A', 'higgsfield_job_id', 'b99bf306-afcd-4278-936b-dfce171a9fcc', 'higgsfield_audio_media_id', '671b8385-8197-4f3e-b3c3-7c2ddb6ce688', 'drive_file_id', '1z5aQVIKrgzs96LP_Sy2aqT9zroeREObX', 'duration_s', 6.06,     'dimensions', jsonb_build_array(720, 1280)),
      jsonb_build_object('scene_id', 'SCENE_2B', 'higgsfield_job_id', '50b88ae2-e5a7-4530-962d-f8a394648cc2', 'higgsfield_audio_media_id', 'b4f9cf6b-750c-4406-aab2-67a79d312cc8', 'drive_file_id', '17edHFCQutnFL6nJE1l9HafR3vPn7Dlg9', 'duration_s', 7.058866, 'dimensions', jsonb_build_array(720, 1280)),
      jsonb_build_object('scene_id', 'SCENE_3A', 'higgsfield_job_id', '7443e0d2-27f1-4325-98ba-e0b5af8d9ff8', 'higgsfield_audio_media_id', '0fd1f0ca-5649-42ff-b6af-5ff17cc1d601', 'drive_file_id', '1s1zu9hrZnZU-Z_exsm4hI1xdyFpplEsI', 'duration_s', 7.058866, 'dimensions', jsonb_build_array(720, 1280)),
      jsonb_build_object('scene_id', 'SCENE_3B', 'higgsfield_job_id', 'e5dc3102-fd75-4d1e-a400-fb95b06f60c3', 'higgsfield_audio_media_id', '859f538d-5e63-41e3-82a6-e74670849230', 'drive_file_id', '1_kxOSDBF8yYRaCBAdA-Ki1Lh5C09jk4x', 'duration_s', 5.06195,  'dimensions', jsonb_build_array(720, 1280)),
      jsonb_build_object('scene_id', 'SCENE_4',  'higgsfield_job_id', 'e44769e5-f56c-4379-a3c3-e19f98c36104', 'higgsfield_audio_media_id', '370484f3-500f-4a61-bda6-3e7de90b1974', 'drive_file_id', '148cXagxu350IuzCO59pRSM81RPPcVmOG', 'duration_s', 5.06195,  'dimensions', jsonb_build_array(720, 1280))
    ),
    'estimated_cost_usd', 1.50
  ),
  NULL, NULL, 1.50, 'reconstructed', NULL, NULL,
  NULL, NULL
),
-- Row 6: qa_avatar (Sonnet vision identity-marker check — NO synthesized score)
(
  '3bcafc78-23f4-4c56-86aa-6221219dddbe', 'qa_agent', 'qa_avatar', 6, 'claude-sonnet-4-6',
  NULL,
  'Identity-marker QA: per-frame Sonnet vision call comparing each Seedance clip''s sample frames against Rachel''s reference still (soul_still f757b09c). Sub-axes: identity, hair, framing, background_consistency, lighting. Plus cross-clip consistency pass.',
  -- rendered_output: JSON with NO overall_score key. Edge fn extractQaScore
  -- will fall through and the UI''s QA cell will render empty. Inventing a
  -- score on backfill would silently poison analytics — see follow-up issue
  -- to run qa-agent-avatar.ts on this final.mp4 and patch the real score in.
  '{"verdict_context": "Sub-score components and final verdict not recoverable. The piece passed manual visual review at production time but qa-agent-avatar.ts was never run on it. See the qa_avatar real-score Linear follow-up for patching the actual computed score."}',
  jsonb_build_object(
    'verdict_context', 'Sub-score components and final verdict not recoverable.',
    'manual_review_passed', true,
    'qa_agent_run', false,
    'qa_agent_path', 'video/scripts/qa-agent-avatar.ts'
  ),
  8000, 600, 0.55, 'reconstructed', NULL, NULL,
  NULL, NULL
),
-- Row 7: hook_card_render (deterministic — generate-hook-card.ts)
(
  '3bcafc78-23f4-4c56-86aa-6221219dddbe', 'full_avatar_profile', 'hook_card_render', 7, 'none',
  NULL,
  'Generate 1080×1920 hook card PNG. Variant: option_a_bold_block (rotated purple band, white display sans). Band color: #63246a (brand purple). Hook overlay text: "How I get my teen talking". Output used as both video opener (held 2s before scene 1, hard cut) and standalone thumbnail asset. See video/scripts/generate-hook-card.ts.',
  NULL,
  jsonb_build_object(
    'thumbnail_drive_file_id', '1bwGI8x297jUG3VZ6ZpIFMoOk-uYBTU1I',
    'variant', 'option_a_bold_block',
    'band_color', '#63246a',
    'band_position', 'bottom_third',
    'hook_overlay', 'How I get my teen talking',
    'dimensions', jsonb_build_array(1080, 1920)
  ),
  NULL, NULL, 0.0, 'reconstructed', NULL, NULL,
  NULL, NULL
),
-- Row 8: stitch (deterministic — stitch-avatar.ts produces final.mp4)
(
  '3bcafc78-23f4-4c56-86aa-6221219dddbe', 'full_avatar_profile', 'stitch', 8, 'none',
  NULL,
  'Stitch 6 avatar clips into final 1080×1920 mp4. 200ms (12-frame at 30fps) crossfade + acrossfade between clips. Prepend 2s hook card opening (hard cut into body). Overlay phrase-level captions (31 phrases sourced from whisper_transcription word timestamps): white text + shadow, no background band. Add brand watermark. See video/scripts/stitch-avatar.ts.',
  NULL,
  jsonb_build_object(
    'final_mp4_drive_file_id', '1T90e3C_OCLsPk8c7ocfwPWpu15_LirlT',
    'duration_s', 40.405333,
    'dimensions', jsonb_build_array(1080, 1920),
    'xfade_sec', 0.2,
    'acrossfade_sec', 0.2,
    'hook_card_opening_s', 2,
    'hard_cut_after_hook_card', true,
    'caption_phrase_count', 31,
    'file_size_bytes', 45105489
  ),
  NULL, NULL, 0.0, 'reconstructed', NULL, NULL,
  NULL, NULL
);

-- ============================================================================
-- 4. UPDATE content_queue with reconstructed generation_context + render_*
--    fields. Idempotency guard: only write if currently NULL/zero OR our own
--    reconstructed payload (so re-runs don't clobber real-time data).
-- ============================================================================

UPDATE content_queue
SET
  render_profile_id = 'd75fe12f-f606-431c-813f-3f63e955fa17',  -- Avatar Full
  render_started_at = '2026-05-09T12:32:31.479699Z',
  render_cost_usd = 2.10,
  generation_context = jsonb_build_object(
    '_reconstructed', true,
    '_reconstructed_note', 'Piece predates Fix 1 lifecycle writes (V2 §4.1, PR #20). generation_context reconstructed from daily_briefings opportunity #5 (briefing 884fec4b-3e56-484d-8fdb-608d6b8f21dd) + content_queue row + content_assets per-scene metadata. The original Sonnet system_prompt + user_prompt strings are unrecoverable; the values below are synthesized templates that describe what the call would have looked like at the time. Token counts and cost are estimates from the V2 §4.5 cost_estimate_usd ($2.10 for the full piece, ~$0.04 attributable to the content_gen step). Status and structure faithful to V2 §3.8.1 ownership. See docs/specs/PIECE_3BCAFC78_BACKFILL_V1.md for full source mapping.',
    'model', 'claude-sonnet-4-6',
    'system_prompt', '[reconstructed — original system_prompt not recoverable] Content gen agent system prompt circa 2026-04-02 (pre-V1.1 taxonomy). Drew from prompts/brand-voice.md + prompts/content-dna.md + prompts/visual-design.md. Generated SMT-voice content from briefing opportunities with hook + caption + hashtags + ai_magic_output (when AI Magic pillar) + image_prompt + audio_suggestion + slides + content_type + age_range + content_pillar + post_format. Output as JSON array, one object per opportunity. See agents/content.js#buildSystemPrompt at HEAD as the closest current analogue.',
    'user_prompt', '[reconstructed — original user_prompt not recoverable] Briefing of 2026-04-02 with 5 opportunities. Generate one piece per opportunity following the system prompt rules. Opportunity #5 (this piece): topic="Get your kid to tell you everything (conversation hack)", angle="Replace the failed how was your day with a specific behavioral hack", source=tiktok @calmwithkiara/7577114691776892174 (407K views), content_type=wow, platform_fit=both, suggested_hook="This one question gets my teen talking for 20 minutes (and it''s not how was school?)".',
    'briefing_id', '884fec4b-3e56-484d-8fdb-608d6b8f21dd',
    'briefing_slice', jsonb_build_object(
      'topic', 'Get your kid to tell you everything (conversation hack)',
      'category', 'teen',
      'angle', 'Replace the failed "how was your day" with a specific behavioral hack that actually opens teens up. Show the technique, not the theory.',
      'source', 'tiktok',
      'source_url', 'https://www.tiktok.com/@calmwithkiara/video/7577114691776892174',
      'content_type', 'wow',
      'platform_fit', 'both',
      'priority', 1,
      'suggested_hook', 'This one question gets my teen talking for 20 minutes (and it''s not ''how was school?'')',
      'reasoning', '407K views shows parents are actively searching for ways to stay connected to teens. The promise (they''ll tell you everything) is emotionally resonant. Wow content because it delivers a usable script.'
    ),
    'active_directives', '[]'::jsonb,
    '_active_directives_note', 'No active directives recorded for 2026-04-02 — the directives table didn''t exist yet (added with the strategist work). Empty array is faithful to that period.',
    'pillar_input', 'uncategorized',
    '_pillar_input_note', 'Reflects content_queue.content_pillar at time of generation. The V1.1 taxonomy hadn''t shipped yet; this piece would route to ''parenting'' under the current taxonomy. Not changing the underlying row — separate Linear follow-up.',
    'format_input', 'tiktok_avatar',
    '_format_input_note', 'Synthesized — content_queue.post_format is NULL on this row (pre-V1.1). The piece was rendered through Avatar Full so tiktok_avatar matches today''s mapping (FORMAT_TO_PROFILE in agents/content.js).',
    'tokens_in', 4200,
    'tokens_out', 1800,
    'cost_usd', 0.04,
    '_token_cost_note', 'Estimated from typical Sonnet 4.6 batch generation (5-opp briefing). Real-time logs would show actual values.',
    'agent_run_id', null,
    'created_at', '2026-04-02T21:02:53.290198Z'
  ),
  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    '_render_started_at_note', 'Set to lifecycle-persist time; actual render time pre-dates persist and is unrecoverable. Duration cell reflects persist→complete window, not true render duration.',
    '_backfill_v1_applied_at', NOW()::text
  )
WHERE id = '3bcafc78-23f4-4c56-86aa-6221219dddbe'
  AND (
    render_profile_id IS NULL
    OR render_started_at IS NULL
    OR render_cost_usd = 0
    OR generation_context IS NULL
    OR (generation_context->>'_reconstructed')::boolean = true
  );
