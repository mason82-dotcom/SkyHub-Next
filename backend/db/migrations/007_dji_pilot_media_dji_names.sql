-- DJI Pilot 2 media: original DJI file names in the bucket (backend/pilot-media-rename.js).
-- Additive and idempotent (second run is a no-op). Applied manually by the operator; never automatically.
-- pilot_object_key keeps the key Pilot 2 uploaded to (org_<fingerprint>_<ms>.<ext>) after the object was renamed to
-- <grant_prefix>/<DJI file name>, so a repeated upload callback for the original key is still recognised.
-- Rollback: first rename back (object_key := pilot_object_key in MinIO and here), then
--   DROP INDEX IF EXISTS dji_pilot_verified_pilot_key;
--   ALTER TABLE dji_pilot_media_verified DROP CONSTRAINT IF EXISTS dji_pilot_verified_pilot_key_scope;
--   ALTER TABLE dji_pilot_media_verified DROP COLUMN IF EXISTS pilot_object_key;
ALTER TABLE dji_pilot_media_verified ADD COLUMN IF NOT EXISTS pilot_object_key TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dji_pilot_verified_pilot_key_scope') THEN
    ALTER TABLE dji_pilot_media_verified ADD CONSTRAINT dji_pilot_verified_pilot_key_scope
      CHECK (pilot_object_key IS NULL OR
             (pilot_object_key LIKE grant_prefix || '/%' AND length(pilot_object_key) <= 1024
              AND pilot_object_key <> object_key));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS dji_pilot_verified_pilot_key
  ON dji_pilot_media_verified(workspace_id, pilot_object_key)
  WHERE pilot_object_key IS NOT NULL;
