-- Avatar cover-image stage (phaseCover): three-asset contract for avatar pieces
-- (video + thumbnail + cover). The thumbnail (first frame + hook banner) was
-- previously transient; the cover is a new purpose-generated 9:16 image.
--
-- Applied to fvxaykkmzsbrggjgdfjj via MCP apply_migration on 2026-06-11.

ALTER TABLE public.content_queue
  ADD COLUMN IF NOT EXISTS thumbnail_asset_url text,
  ADD COLUMN IF NOT EXISTS cover_asset_url text;

COMMENT ON COLUMN public.content_queue.thumbnail_asset_url IS
  'First-frame + hook-banner PNG (the video''s opening frame), uploaded by render-avatar-full-v5 --phase=cover. Frame-faithful cover; TikTok uses this path (its API only supports frame-based covers).';
COMMENT ON COLUMN public.content_queue.cover_asset_url IS
  'Purpose-generated 1080x1920 cover PNG (Gemini Nano Banana, reference-based on the render''s Soul still; Soul 2.0 via Higgsfield as last-resort fallback). Passed as cover_url on IG Reels publish. Generation metadata lives under metadata.cover.';

-- Fallback-chain registration per the services convention (fallback_service_id
-- points at the next tier). Tier 3 (Soul 2.0 via Higgsfield MCP) is registered
-- first so the primary row can reference it.
INSERT INTO public.services (name, slug, service_type, provider, env_key_name, status, cost_per_unit, cost_unit, config)
SELECT
  'Higgsfield Soul 2.0 (cover fallback)',
  'higgsfield_soul',
  'image_gen',
  'higgsfield',
  NULL,
  'active',
  0.015,
  'per_image',
  '{"role":"cover_fallback_tier3","note":"Session-scoped Higgsfield MCP - cannot be called from Node. render-avatar-full-v5 --phase=cover exits 5 to surface Soul generation to the Claude session; the session records the result via --phase=cover-record."}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.services WHERE slug = 'higgsfield_soul');

INSERT INTO public.services (name, slug, service_type, provider, env_key_name, status, cost_per_unit, cost_unit, fallback_service_id, config)
SELECT
  'Gemini Nano Banana (cover gen)',
  'gemini_nano_banana',
  'image_gen',
  'google',
  'GEMINI_API_KEY',
  'no_key',
  0.039,
  'per_image',
  (SELECT id FROM public.services WHERE slug = 'higgsfield_soul'),
  '{"role":"cover_primary","model":"gemini-2.5-flash-image","retry":1,"note":"Primary cover generator (reference-based, identity from the render Soul still). Retries once with an adjusted prompt before falling back to fallback_service_id (Soul 2.0 via Higgsfield). status flips to active once GEMINI_API_KEY lands in .env."}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.services WHERE slug = 'gemini_nano_banana');
