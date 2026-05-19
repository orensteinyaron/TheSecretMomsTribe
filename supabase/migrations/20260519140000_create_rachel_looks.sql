-- supabase/migrations/20260519140000_create_rachel_looks.sql
BEGIN;

CREATE TABLE rachel_looks (
  look_id       text PRIMARY KEY,
  soul_still_id text NOT NULL,
  soul_still_url text NOT NULL,
  wardrobe      text NOT NULL,
  setting       text NOT NULL,
  notes         text,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'active', 'retired')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  approved_at   timestamptz,
  retired_at    timestamptz,
  created_by    text NOT NULL,
  source        text NOT NULL DEFAULT 'skill_v1'
                CHECK (source IN ('canon_seed', 'skill_v1'))
);

CREATE INDEX rachel_looks_status_idx ON rachel_looks(status);

COMMENT ON TABLE rachel_looks IS
  'Mutable registry of Higgsfield Soul 2.0 stills for Rachel (Face of SMT). '
  'Canon doc FACE_OF_SMT_V1.md governs aesthetic intent; this table governs runtime rotation. '
  'Looks are picked LRU with cooldown=2 by video/lib/wardrobe-rotation/pick-next-look.ts.';

COMMENT ON COLUMN rachel_looks.status IS
  'pending = generated, awaiting Yaron approval; '
  'active = in rotation; retired = removed from pool, history preserved.';

COMMENT ON COLUMN rachel_looks.source IS
  'canon_seed = inserted by migration from FACE_OF_SMT_V1.md; '
  'skill_v1 = generated via skills/avatar-full-wardrobe-rotation create_new_look flow.';

-- Seed: Look #1 only. The other 10 canon looks have no Soul still IDs/URLs;
-- they will be minted via the skill's create_new_look flow (see YAR-136 spec).
INSERT INTO rachel_looks (
  look_id, soul_still_id, soul_still_url, wardrobe, setting, notes,
  status, approved_at, created_by, source
) VALUES (
  'look_01',
  'f757b09c-d94d-4ade-a076-4a1a496c641e',
  'https://d2ol7oe51mr4n9.cloudfront.net/user_3DGDY5uQO2VTYDyY6tkVHLr8qE8/f757b09c-d94d-4ade-a076-4a1a496c641e.png',
  'cozy cream knit sweater, loose half-up hair',
  'home interior, natural warm light',
  'Canon Look #1 — the production-locked still used for every Avatar Full render up to YAR-136. Pre-existing reference; carried forward as seed.',
  'active',
  now(),
  'canon_seed',
  'canon_seed'
);

COMMIT;
