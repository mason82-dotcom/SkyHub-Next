-- Experimental, opt-in only. NEVER part of the active SkyHub migration chain.
-- Designed for a disposable schema containing a verified-media fixture and audit trigger.
BEGIN;
CREATE TABLE skyhub_pv_jobs (
  job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  requested_by varchar(128) NOT NULL,
  state varchar(24) NOT NULL DEFAULT 'queued'
    CHECK(state IN ('queued','running','candidate-ready','failed')),
  source_sha256 char(64)
    CHECK(source_sha256 IS NULL OR source_sha256 ~ '^[0-9a-f]{64}$'),
  claim_token uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  heartbeat_at timestamptz,
  lease_expires_at timestamptz,
  finished_at timestamptz,
  CONSTRAINT pv_job_verified_asset_fk FOREIGN KEY(workspace_id,asset_id)
    REFERENCES dji_pilot_media_verified(workspace_id,asset_id) ON DELETE RESTRICT,
  CONSTRAINT pv_job_idempotent_key UNIQUE(workspace_id,idempotency_key),
  CONSTRAINT pv_job_state_lease_check CHECK(
    (state='queued' AND claim_token IS NULL AND started_at IS NULL AND finished_at IS NULL
      AND heartbeat_at IS NULL AND lease_expires_at IS NULL)
    OR
    (state='running' AND claim_token IS NOT NULL AND started_at IS NOT NULL AND finished_at IS NULL
      AND heartbeat_at IS NOT NULL AND lease_expires_at IS NOT NULL AND lease_expires_at>heartbeat_at)
    OR
    (state IN ('candidate-ready','failed') AND claim_token IS NULL AND finished_at IS NOT NULL
      AND heartbeat_at IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT pv_job_result_check CHECK(
    (state='candidate-ready' AND source_sha256 IS NOT NULL)
    OR (state<>'candidate-ready' AND source_sha256 IS NULL)
  )
);
CREATE INDEX pv_job_queue_idx ON skyhub_pv_jobs(created_at,job_id) WHERE state='queued';
CREATE INDEX pv_job_expiry_idx ON skyhub_pv_jobs(workspace_id,lease_expires_at,job_id) WHERE state='running';
CREATE TABLE skyhub_pv_job_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES skyhub_pv_jobs(job_id) ON DELETE RESTRICT,
  action varchar(24) NOT NULL CHECK(action IN
    ('requested','replayed','claimed','heartbeat','candidate_recorded','failed','read','lease_expired')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER pv_job_audit_immutable_update BEFORE UPDATE OR DELETE
  ON skyhub_pv_job_audit FOR EACH ROW EXECUTE FUNCTION skyhub_dji_pilot_media_audit_immutable();
CREATE TRIGGER pv_job_audit_immutable_truncate BEFORE TRUNCATE
  ON skyhub_pv_job_audit FOR EACH STATEMENT EXECUTE FUNCTION skyhub_dji_pilot_media_audit_immutable();
CREATE TABLE skyhub_pv_job_denied_audit (
  denial_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid,
  action varchar(24) NOT NULL CHECK(action='request_denied'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER pv_denied_audit_immutable_update BEFORE UPDATE OR DELETE
  ON skyhub_pv_job_denied_audit FOR EACH ROW EXECUTE FUNCTION skyhub_dji_pilot_media_audit_immutable();
CREATE TRIGGER pv_denied_audit_immutable_truncate BEFORE TRUNCATE
  ON skyhub_pv_job_denied_audit FOR EACH STATEMENT EXECUTE FUNCTION skyhub_dji_pilot_media_audit_immutable();
COMMIT;
