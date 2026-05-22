-- YAR-136 PR-A Revision: split looks into two axes (look + location) with
-- per-combination still cache.
--
-- Preserves the v1 rachel_looks table data (Smoke 2 rows) by renaming to
-- _legacy_v1. Drop in a follow-up cleanup migration after 2 weeks of stability.

BEGIN;

-- 1. Preserve v1 table for rollback safety.
ALTER TABLE rachel_looks RENAME TO rachel_looks_legacy_v1;
ALTER INDEX rachel_looks_status_idx RENAME TO rachel_looks_legacy_v1_status_idx;

COMMENT ON TABLE rachel_looks_legacy_v1 IS
  'v1 single-axis look table from PR-A first pass. Preserved for rollback. '
  'Drop in follow-up cleanup migration ~2 weeks after revision merge.';

-- 2. New rachel_looks (styling axis only)
CREATE TABLE rachel_looks (
  look_id     text PRIMARY KEY,
  wardrobe    text NOT NULL,
  hair        text NOT NULL,
  accessories text,
  notes       text,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'active', 'retired')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  retired_at  timestamptz,
  created_by  text NOT NULL,
  source      text NOT NULL DEFAULT 'skill_v1'
              CHECK (source IN ('canon_seed', 'skill_v1'))
);

CREATE INDEX rachel_looks_status_idx ON rachel_looks(status);

COMMENT ON TABLE rachel_looks IS
  'Styling axis of Rachel Avatar Full rotation: wardrobe + hair + accessories. '
  'Independent of location. Composed at render time via pickCombination -> '
  'pickLook + pickLocation + rachel_stills cache lookup.';

-- 3. New rachel_locations (setting axis)
CREATE TABLE rachel_locations (
  location_id text PRIMARY KEY,
  setting     text NOT NULL,
  lighting    text NOT NULL,
  framing     text NOT NULL,
  tier        text NOT NULL CHECK (tier IN ('primary', 'secondary')),
  notes       text,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'active', 'retired')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  retired_at  timestamptz,
  created_by  text NOT NULL,
  source      text NOT NULL DEFAULT 'skill_v1'
              CHECK (source IN ('canon_seed', 'skill_v1'))
);

CREATE INDEX rachel_locations_status_idx ON rachel_locations(status);
CREATE INDEX rachel_locations_tier_idx ON rachel_locations(tier)
  WHERE status = 'active';

COMMENT ON TABLE rachel_locations IS
  'Setting axis of Rachel Avatar Full rotation: setting + lighting + framing. '
  'Tier-aware: primary locations (kitchen, studio) appear 5/7 of renders; '
  'secondary 2/7. Independent of look.';

-- 4. New rachel_stills (per-combination cache)
CREATE TABLE rachel_stills (
  still_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  look_id        text NOT NULL REFERENCES rachel_looks(look_id),
  location_id    text NOT NULL REFERENCES rachel_locations(location_id),
  soul_still_id  text NOT NULL,
  soul_still_url text NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'active', 'retired')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  approved_at    timestamptz,
  retired_at     timestamptz,
  created_by     text NOT NULL
);

-- Partial unique: exactly one active still per (look, location) combo.
-- Allows N pending candidates during bootstrap + retire history.
CREATE UNIQUE INDEX rachel_stills_one_active_per_combo
  ON rachel_stills (look_id, location_id)
  WHERE status = 'active';

CREATE INDEX rachel_stills_status_idx ON rachel_stills(status);
CREATE INDEX rachel_stills_combo_idx ON rachel_stills(look_id, location_id);

COMMENT ON TABLE rachel_stills IS
  'Per-combination cache of Higgsfield Soul 2.0 stills for (look x location). '
  'pickCombination reads this table. When a combo has no active still, the '
  'render-time generateStill flow mints one (auto-approves first of 3).';

-- 5. Seed look_01 (Cozy cream knit) -- canonical Look #1 from FACE_OF_SMT_V1.md
INSERT INTO rachel_looks (
  look_id, wardrobe, hair, accessories, notes,
  status, approved_at, created_by, source
) VALUES (
  'look_01',
  'cream cable-knit sweater',
  'loose half-up',
  NULL,
  'Canon Look #1 from FACE_OF_SMT_V1.md. Best for trust content, '
  'morning content, comfort topics.',
  'active',
  now(),
  'canon_seed',
  'canon_seed'
);

-- 6. Seed location_01 (Kitchen -- primary)
INSERT INTO rachel_locations (
  location_id, setting, lighting, framing, tier, notes,
  status, approved_at, created_by, source
) VALUES (
  'location_01',
  'modern kitchen, kitchen island in background, soft cream walls',
  'morning window light, warm, daylight balanced',
  'medium shot, eye level, shallow depth of field',
  'primary',
  'Canon primary location #1. Best for parenting insights, mom health, day-to-day mom content.',
  'active',
  now(),
  'canon_seed',
  'canon_seed'
);

-- 7. Seed the canonical Soul still for (look_01, location_01) -- Yaron''s
--    original Cream Knit reference. Carries forward from v1 unchanged.
INSERT INTO rachel_stills (
  look_id, location_id, soul_still_id, soul_still_url,
  status, approved_at, created_by
) VALUES (
  'look_01',
  'location_01',
  'f757b09c-d94d-4ade-a076-4a1a496c641e',
  'https://d2ol7oe51mr4n9.cloudfront.net/user_3DGDY5uQO2VTYDyY6tkVHLr8qE8/f757b09c-d94d-4ade-a076-4a1a496c641e.png',
  'active',
  now(),
  'canon_seed'
);

COMMIT;
