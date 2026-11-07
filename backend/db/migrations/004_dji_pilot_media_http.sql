-- DJI Pilot 2 group reports and workspace-scoped metadata-only HTTP audit.
-- Applies after 003; intentionally not loaded during server startup.
CREATE TABLE IF NOT EXISTS dji_pilot_media_group_reports (
  workspace_id UUID NOT NULL,
  file_group_id VARCHAR(128) NOT NULL,
  file_count INTEGER NOT NULL CHECK (file_count > 0),
  file_uploaded_count INTEGER NOT NULL CHECK (file_uploaded_count > 0),
  verified_count INTEGER NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,file_group_id),
  CHECK (file_uploaded_count <= file_count),
  CHECK (verified_count = file_uploaded_count),
  CHECK (file_group_id ~ '^[A-Za-z0-9_.:-]{1,128}$')
);

CREATE TABLE IF NOT EXISTS dji_pilot_media_http_audit (
  audit_id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL,
  operation VARCHAR(32) NOT NULL CHECK (
    operation IN ('tiny_fingerprints','fast_upload','upload_callback','group_upload_callback')
  ),
  outcome VARCHAR(24) NOT NULL CHECK (
    outcome IN ('ok','invalid','denied','conflict','pending','unavailable')
  ),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dji_pilot_media_audit_workspace_time
  ON dji_pilot_media_http_audit(workspace_id,recorded_at DESC);

-- Append-only audit record: database rejection, not only an API convention.
CREATE OR REPLACE FUNCTION skyhub_dji_pilot_media_audit_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'DJI Pilot media HTTP audit is immutable'
    USING ERRCODE='42501';
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid='dji_pilot_media_http_audit'::regclass
       AND tgname='dji_pilot_media_audit_no_update_delete'
  ) THEN
    CREATE TRIGGER dji_pilot_media_audit_no_update_delete
      BEFORE UPDATE OR DELETE ON dji_pilot_media_http_audit
      FOR EACH ROW EXECUTE FUNCTION skyhub_dji_pilot_media_audit_immutable();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid='dji_pilot_media_http_audit'::regclass
       AND tgname='dji_pilot_media_audit_no_truncate'
  ) THEN
    CREATE TRIGGER dji_pilot_media_audit_no_truncate
      BEFORE TRUNCATE ON dji_pilot_media_http_audit
      FOR EACH STATEMENT EXECUTE FUNCTION skyhub_dji_pilot_media_audit_immutable();
  END IF;
END;
$$;
