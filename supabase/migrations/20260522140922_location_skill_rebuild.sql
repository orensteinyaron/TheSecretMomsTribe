-- YAR-136 PR-C: rebuild rachel_locations with structured set fields +
-- Rachel-in-location canonical reference. Cascade-wipes rachel_stills (2 active
-- locations + 16 stills from PR-A revision) — intentional, those were generated
-- against the inconsistent location model.
--
-- The look pool (rachel_looks: look_01, look_02 active) is preserved unchanged.

BEGIN;

-- 1. Drop existing tables. CASCADE on rachel_locations also drops rachel_stills
--    (FK reference). rachel_stills drop is then a no-op-but-safe explicit re-drop.
DROP TABLE rachel_stills CASCADE;
DROP TABLE rachel_locations CASCADE;

-- 2. Rebuild rachel_locations with structured set definition + canonical reference
CREATE TABLE rachel_locations (
  location_id text PRIMARY KEY,
  name text NOT NULL,                       -- 'kitchen', 'home_studio'
  tier text NOT NULL CHECK (tier IN ('primary', 'secondary')),

  -- Structured set definition (all required)
  camera_angle text NOT NULL,               -- 'eye level, straight on'
  camera_distance text NOT NULL,            -- 'medium shot, chest up'
  rachel_position text NOT NULL,            -- 'standing just behind the kitchen island, hands resting on the marble'
  background_composition text NOT NULL,     -- 'cooktop on back-wall counter, oven on right, marble splashback, cabinets'
  lighting_setup text NOT NULL,             -- 'bright natural daylight from window on left, soft shadows'
  props text[] NOT NULL,                    -- ['kitchen island', 'marble counter', ...]
  wall_color text NOT NULL,                 -- 'soft white'
  floor_material text NOT NULL,             -- 'light oak hardwood'

  -- Rachel-in-location canonical reference (set after bootstrap approval)
  reference_image_url text,                 -- NULL until bootstrapped + approved
  reference_image_id text,                  -- Higgsfield job ID for the approved canonical

  notes text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  retired_at timestamptz,
  created_by text NOT NULL,
  source text NOT NULL DEFAULT 'skill_v1'
    CHECK (source IN ('canon_seed', 'skill_v1'))
);

CREATE INDEX rachel_locations_status_idx ON rachel_locations(status);
CREATE INDEX rachel_locations_tier_active_idx
  ON rachel_locations(tier) WHERE status = 'active';

COMMENT ON TABLE rachel_locations IS
  'Structured set definitions for Rachel''s Avatar Full locations. Each row '
  'is one canonical room (kitchen, studio, etc.) with all set details + a '
  'reference_image_url pointing to the approved Rachel-in-location canonical. '
  'Every anchored still generated against this location uses the canonical '
  'as a medias reference via nano_banana_pro.';

-- 3. Rebuild rachel_stills with audit column for reference snapshot
CREATE TABLE rachel_stills (
  still_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  look_id text NOT NULL REFERENCES rachel_looks(look_id),
  location_id text NOT NULL REFERENCES rachel_locations(location_id),
  soul_still_id text NOT NULL,              -- Higgsfield job UUID
  soul_still_url text NOT NULL,             -- CDN URL of the generated still
  reference_image_url_used text NOT NULL,   -- snapshot of location.reference_image_url at generation time
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  retired_at timestamptz,
  created_by text NOT NULL
);

-- Partial unique: exactly one active still per (look, location) combo.
CREATE UNIQUE INDEX rachel_stills_active_combo_idx
  ON rachel_stills (look_id, location_id) WHERE status = 'active';
CREATE INDEX rachel_stills_combo_idx ON rachel_stills (look_id, location_id);
CREATE INDEX rachel_stills_status_idx ON rachel_stills (status);

COMMENT ON TABLE rachel_stills IS
  'Per-combination cache of nano_banana_pro wardrobe-swap outputs. Each still '
  'is generated against the location''s reference_image_url as medias. '
  'reference_image_url_used snapshots the canonical at generation time — '
  'survives canonical updates so we can audit which stills were generated '
  'against which canonical version.';

-- 4. Pre-seed pending location rows with canon brief data.
--    reference_image_url left NULL — bootstrap mints + approves the canonical.

INSERT INTO rachel_locations (
  location_id, name, tier,
  camera_angle, camera_distance, rachel_position,
  background_composition, lighting_setup, props,
  wall_color, floor_material,
  notes, status, created_by, source
) VALUES (
  'location_01',
  'kitchen',
  'primary',
  'eye level, straight on',
  'medium shot, chest up',
  'standing just behind the kitchen island, hands resting on the marble surface',
  'gas cooktop visible on back-wall counter behind Rachel, stainless steel double oven on the right, marble splashback above the cooktop, white shaker upper cabinets, window with shutters and view of trees/ocean on the far left',
  'bright natural daylight from window camera-left, soft fill, no harsh shadows',
  ARRAY['white marble island', 'gas cooktop on back-wall counter', 'stainless steel double oven', 'marble splashback', 'white shaker cabinets', 'window with shutters (view of trees/ocean)'],
  'soft white',
  'light oak hardwood',
  'Canon primary location #1. Reference image pending — mint via bootstrapLocation(1, aesthetic_reference_url).',
  'pending',
  'canon_seed',
  'canon_seed'
);

INSERT INTO rachel_locations (
  location_id, name, tier,
  camera_angle, camera_distance, rachel_position,
  background_composition, lighting_setup, props,
  wall_color, floor_material,
  notes, status, created_by, source
) VALUES (
  'location_02',
  'home_studio',
  'primary',
  'eye level, straight on',
  'medium shot, chest up',
  'seated at a wooden desk, hands resting calmly on the desk surface',
  'large monstera plant with green leaves on the left, soft pink decor on the right, white walls, bright natural daylight from a window on the far left, wooden desk',
  'bright natural daylight from window camera-left, soft ambient fill',
  ARRAY['wooden desk', 'monstera plant in pot', 'soft pink decor accent', 'white walls', 'bright window with daylight'],
  'warm off-white',
  'light wood',
  'Canon primary location #2. Reference image pending — mint via bootstrapLocation(2, aesthetic_reference_url). Note: aesthetic reference may show podcast elements (headphones, mic, phone) — explicitly exclude in bootstrap prompt.',
  'pending',
  'canon_seed',
  'canon_seed'
);

COMMIT;
