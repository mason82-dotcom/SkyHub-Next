-- DRAFT ONLY: never applied by startup or deployed to a running Pi.
-- No API route, DJI authentication or database grants are enabled by this file.
-- Rollout requires independently authenticated operator/admin principals, workspace
-- ownership, RLS policies and reviewed SQL transactions. Until then: DENY ALL.
CREATE TABLE IF NOT EXISTS skyhub_wpml_folders (
  workspace_id UUID NOT NULL,
  folder_id UUID NOT NULL,
  folder_name VARCHAR(70) NOT NULL CHECK (length(trim(folder_name)) BETWEEN 1 AND 70),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  PRIMARY KEY(workspace_id,folder_id)
);

CREATE TABLE IF NOT EXISTS skyhub_wpml_routes (
  workspace_id UUID NOT NULL,
  route_id UUID NOT NULL,
  folder_id UUID,
  route_name VARCHAR(70) NOT NULL CHECK (length(trim(route_name)) BETWEEN 1 AND 70),
  route_type VARCHAR(20) NOT NULL DEFAULT 'waypoint' CHECK(route_type='waypoint'),
  latest_revision BIGINT NOT NULL DEFAULT 0 CHECK(latest_revision>=0),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  PRIMARY KEY(workspace_id,route_id),
  FOREIGN KEY(workspace_id,folder_id) REFERENCES skyhub_wpml_folders(workspace_id,folder_id)
    ON DELETE RESTRICT
);

-- Route revisions are full offline plan snapshots; all user-supplied coordinate
-- and camera data are confidential and NEVER included in general API logs.
CREATE TABLE IF NOT EXISTS skyhub_wpml_route_revisions (
  workspace_id UUID NOT NULL,
  route_id UUID NOT NULL,
  revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 9223372036854775807),
  plan JSONB NOT NULL CHECK(jsonb_typeof(plan)='object' AND
    octet_length(plan::text)<=524288),
  plan_sha256 BYTEA NOT NULL CHECK(octet_length(plan_sha256)=32),
  author_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  flight_ready BOOLEAN NOT NULL DEFAULT false CHECK(flight_ready=false),
  dispatch_allowed BOOLEAN NOT NULL DEFAULT false CHECK(dispatch_allowed=false),
  PRIMARY KEY(workspace_id,route_id,revision),
  FOREIGN KEY(workspace_id,route_id) REFERENCES skyhub_wpml_routes(workspace_id,route_id)
    ON DELETE RESTRICT
);

-- A task snapshot is a reference to a frozen route revision, NOT a DJI task.
CREATE TABLE IF NOT EXISTS skyhub_wpml_task_snapshots (
  workspace_id UUID NOT NULL,
  snapshot_id UUID NOT NULL,
  route_id UUID NOT NULL,
  revision BIGINT NOT NULL,
  snapshot_json JSONB NOT NULL CHECK(jsonb_typeof(snapshot_json)='object' AND
    octet_length(snapshot_json::text)<=524288),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatch_allowed BOOLEAN NOT NULL DEFAULT false CHECK(dispatch_allowed=false),
  flight_ready BOOLEAN NOT NULL DEFAULT false CHECK(flight_ready=false),
  PRIMARY KEY(workspace_id,snapshot_id),
  FOREIGN KEY(workspace_id,route_id,revision)
    REFERENCES skyhub_wpml_route_revisions(workspace_id,route_id,revision)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_wpml_routes_workspace_folder
  ON skyhub_wpml_routes(workspace_id,folder_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wpml_revisions_workspace_time
  ON skyhub_wpml_route_revisions(workspace_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wpml_snapshots_workspace_time
  ON skyhub_wpml_task_snapshots(workspace_id,created_at DESC);

-- Default-deny, including the table owner (except privileged superusers).
-- Do not add permissive policies until a separately authenticated workspace
-- principal and its DB role/grant lifecycle are established and tested.
ALTER TABLE skyhub_wpml_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE skyhub_wpml_folders FORCE ROW LEVEL SECURITY;
ALTER TABLE skyhub_wpml_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE skyhub_wpml_routes FORCE ROW LEVEL SECURITY;
ALTER TABLE skyhub_wpml_route_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE skyhub_wpml_route_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE skyhub_wpml_task_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE skyhub_wpml_task_snapshots FORCE ROW LEVEL SECURITY;

REVOKE ALL ON skyhub_wpml_folders FROM PUBLIC;
REVOKE ALL ON skyhub_wpml_routes FROM PUBLIC;
REVOKE ALL ON skyhub_wpml_route_revisions FROM PUBLIC;
REVOKE ALL ON skyhub_wpml_task_snapshots FROM PUBLIC;

-- Immutable revisions/snapshots may not be modified or removed by the app
-- owner. Privileged DB roles can still replace triggers; operational DB
-- role isolation and out-of-band backups must be reviewed at rollout.
CREATE OR REPLACE FUNCTION skyhub_wpml_no_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $skyhub$
BEGIN
  RAISE EXCEPTION 'WPML revision or task snapshot is immutable' USING ERRCODE='42501';
  RETURN NULL;
END;
$skyhub$;

DROP TRIGGER IF EXISTS skyhub_wpml_revision_no_rewrite ON skyhub_wpml_route_revisions;
CREATE TRIGGER skyhub_wpml_revision_no_rewrite
  BEFORE UPDATE OR DELETE ON skyhub_wpml_route_revisions
  FOR EACH ROW EXECUTE FUNCTION skyhub_wpml_no_rewrite();
DROP TRIGGER IF EXISTS skyhub_wpml_revision_no_truncate ON skyhub_wpml_route_revisions;
CREATE TRIGGER skyhub_wpml_revision_no_truncate
  BEFORE TRUNCATE ON skyhub_wpml_route_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION skyhub_wpml_no_rewrite();
DROP TRIGGER IF EXISTS skyhub_wpml_snapshot_no_rewrite ON skyhub_wpml_task_snapshots;
CREATE TRIGGER skyhub_wpml_snapshot_no_rewrite
  BEFORE UPDATE OR DELETE ON skyhub_wpml_task_snapshots
  FOR EACH ROW EXECUTE FUNCTION skyhub_wpml_no_rewrite();
DROP TRIGGER IF EXISTS skyhub_wpml_snapshot_no_truncate ON skyhub_wpml_task_snapshots;
CREATE TRIGGER skyhub_wpml_snapshot_no_truncate
  BEFORE TRUNCATE ON skyhub_wpml_task_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION skyhub_wpml_no_rewrite();
