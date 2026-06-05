-- Collapse Rachel voice_id canon onto tRhabdS7JjlQ0lVEImuM (YAR-144).
-- The deprecated 9JqF6OmJtGjHTDODKG2c was aspirational; the renderer constant
-- (RACHEL_ELEVENLABS_VOICE_ID) and 3 shipped pieces use tRhabd. Code wins.
UPDATE content_queue
SET avatar_config = jsonb_set(avatar_config, '{voice_id}', '"tRhabdS7JjlQ0lVEImuM"')
WHERE avatar_config->>'voice_id' = '9JqF6OmJtGjHTDODKG2c';
