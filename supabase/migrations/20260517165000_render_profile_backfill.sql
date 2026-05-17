-- render_profile_id backfill from post_format
-- Spec: docs/specs/CHANNEL_MODEL_V1.md §3.1 (render_profile_backfill)
-- Linear: YAR-120 (parent: YAR-117)
--
-- For rows with NULL render_profile_id, infer the correct profile from post_format.
-- When both are set, render_profile_id wins — it's the source of truth.
-- Inconsistent existing mappings (e.g. ig_static → moving-images) are tolerated as-is.
--
-- Expected affected rows (per pre-migration distribution): ~20.

BEGIN;

UPDATE content_queue cq
SET render_profile_id = rp.id
FROM render_profiles rp
WHERE cq.render_profile_id IS NULL
  AND cq.post_format IS NOT NULL
  AND cq.deleted_at IS NULL
  AND rp.slug = CASE cq.post_format::text
    WHEN 'tiktok_slideshow' THEN 'moving-images'
    WHEN 'tiktok_text'      THEN 'moving-images'
    WHEN 'ig_carousel'      THEN 'static-image'
    WHEN 'ig_static'        THEN 'static-image'
    WHEN 'ig_meme'          THEN 'static-image'
    WHEN 'video_script'     THEN 'moving-images'
    ELSE NULL
  END;

COMMIT;
