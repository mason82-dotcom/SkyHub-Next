-- DJI Pilot 2 read-only library projection. Additive on migrations 003 and 004.
-- No effect on the existing legacy media_assets table or active server routes.
ALTER TABLE dji_pilot_media_verified
  ADD COLUMN IF NOT EXISTS asset_id UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS idx_pilot_library_workspace_asset
  ON dji_pilot_media_verified(workspace_id,asset_id);
CREATE INDEX IF NOT EXISTS idx_pilot_library_page
  ON dji_pilot_media_verified(workspace_id,verified_at DESC,asset_id DESC);
CREATE INDEX IF NOT EXISTS idx_pilot_library_group
  ON dji_pilot_media_verified(workspace_id,file_group_id,grant_prefix)
  WHERE file_group_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS dji_pilot_media_library_audit (
  audit_id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL,
  action VARCHAR(16) NOT NULL CHECK (action IN ('list','detail','m3m_group')),
  outcome VARCHAR(16) NOT NULL CHECK (outcome IN ('ok','denied','invalid','pending','unavailable')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pilot_library_audit_workspace_time
  ON dji_pilot_media_library_audit(workspace_id,recorded_at DESC);

-- Reuses the 004 append-only audit trigger, already tested against PostgreSQL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='dji_pilot_media_library_audit'::regclass
      AND tgname='pilot_library_audit_no_update_delete') THEN
    CREATE TRIGGER pilot_library_audit_no_update_delete
      BEFORE UPDATE OR DELETE ON dji_pilot_media_library_audit
      FOR EACH ROW EXECUTE FUNCTION skyhub_dji_pilot_media_audit_immutable();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='dji_pilot_media_library_audit'::regclass
      AND tgname='pilot_library_audit_no_truncate') THEN
    CREATE TRIGGER pilot_library_audit_no_truncate
      BEFORE TRUNCATE ON dji_pilot_media_library_audit
      FOR EACH STATEMENT EXECUTE FUNCTION skyhub_dji_pilot_media_audit_immutable();
  END IF;
END;
$$;
