-- Draft companion to 003_wpml_route_library_draft.sql, NEVER auto-deployed.
-- The only use on this branch is disposable skyhub_test CI schemas.
-- No active policy, grants or live HTTP/API credentials are provisioned.
CREATE TABLE IF NOT EXISTS skyhub_wpml_route_audit (
  workspace_id UUID NOT NULL,
  route_id UUID NOT NULL,
  revision BIGINT NOT NULL CHECK (revision BETWEEN 1 AND 12),
  actor_id UUID NOT NULL,
  event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('created','revision_appended')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,route_id,revision),
  FOREIGN KEY(workspace_id,route_id,revision)
    REFERENCES skyhub_wpml_route_revisions(workspace_id,route_id,revision)
    ON DELETE RESTRICT,
  CONSTRAINT skyhub_wpml_audit_event_order CHECK (
    (revision=1 AND event_type='created') OR
    (revision>1 AND event_type='revision_appended')
  )
);

-- No route name, geographical coordinates, camera data, serialized plan,
-- request credential, IP address or free-form user strings in this table.
CREATE INDEX IF NOT EXISTS idx_wpml_audit_workspace_time
  ON skyhub_wpml_route_audit(workspace_id,recorded_at DESC);

ALTER TABLE skyhub_wpml_route_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE skyhub_wpml_route_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON skyhub_wpml_route_audit FROM PUBLIC;

-- The base draft already defines skyhub_wpml_no_rewrite().  The same
-- append-only behavior is required for evidence of every successful write.
DROP TRIGGER IF EXISTS skyhub_wpml_audit_no_rewrite ON skyhub_wpml_route_audit;
CREATE TRIGGER skyhub_wpml_audit_no_rewrite
  BEFORE UPDATE OR DELETE ON skyhub_wpml_route_audit
  FOR EACH ROW EXECUTE FUNCTION skyhub_wpml_no_rewrite();
DROP TRIGGER IF EXISTS skyhub_wpml_audit_no_truncate ON skyhub_wpml_route_audit;
CREATE TRIGGER skyhub_wpml_audit_no_truncate
  BEFORE TRUNCATE ON skyhub_wpml_route_audit
  FOR EACH STATEMENT EXECUTE FUNCTION skyhub_wpml_no_rewrite();
