-- Add qa_rules.variants[] override map on avatar-v1.
--
-- avatar-v1 hosts three QA "variants" keyed off avatar_config.format
-- + an ask_rachel flag:
--   - full_avatar    (default — Avatar Full baseline; no overrides)
--   - avatar_visual  (Avatar+Visual 50/50 — adds 2 dims)
--   - ask_rachel     (Ask Rachel format — adds 2 dims)
--
-- Each variant declares add_to_in_scope[] — dims that move from
-- out_of_scope_dimensions to in_scope_dimensions when that variant
-- is dispatched. The profile aggregator (profiles/avatar-visual.ts,
-- profiles/ask-rachel.ts) reads the variant override and merges.
--
-- This keeps render_profiles as the source of truth for what's
-- measured per variant. Adding a new variant or moving a dim into a
-- variant's scope is a single SQL UPDATE; no agent rewrite.

BEGIN;

UPDATE render_profiles
SET qa_rules = jsonb_set(
  qa_rules,
  '{variants}',
  '{
    "full_avatar": { "add_to_in_scope": [] },
    "avatar_visual": {
      "add_to_in_scope": ["split_timing_verification", "visual_segment_relevance"]
    },
    "ask_rachel": {
      "add_to_in_scope": ["two_voice_presence", "turn_taking_alignment"]
    }
  }'::jsonb
)
WHERE slug = 'avatar-v1';

DO $$
DECLARE
  has_variants int;
BEGIN
  SELECT COUNT(*) INTO has_variants
  FROM render_profiles
  WHERE slug = 'avatar-v1' AND qa_rules->'variants' IS NOT NULL;
  IF has_variants = 0 THEN
    RAISE EXCEPTION 'qa_rules_variants: avatar-v1 row missing qa_rules.variants after migration';
  END IF;
END $$;

COMMIT;
