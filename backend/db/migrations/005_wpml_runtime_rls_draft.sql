-- DRAFT ONLY (ADR-001, 07.11.2026): runtime role and workspace RLS for the WPML route library.
-- NEVER applied by startup. Applying it needs a role with CREATEROLE and is a separate, reviewed manual step.
-- Depends on 003_wpml_route_library_draft.sql and 004_wpml_route_audit_draft.sql.
--
-- Model (no free-form GUC, no secret in the database):
--   skyhub_wpml_app        login role of the backend (LOGIN/PASSWORD set out of band), NOINHERIT: sees nothing itself
--   skyhub_wpml_workspace  group role that carries the minimal table grants
--   skyhub_wpml_ws_<hex>   one NOLOGIN role per workspace, member of skyhub_wpml_workspace; the app may SET ROLE to it
-- The service runs every transaction as  BEGIN; SET LOCAL ROLE skyhub_wpml_ws_<hex>; ...; COMMIT
-- with the workspace taken from the VERIFIED operator token. Policies compare workspace_id with the workspace mapped
-- to current_user, so a forgotten workspace filter or a SQL bug in the service cannot cross workspaces.
-- Limit: a fully compromised backend can SET ROLE to any workspace role; RLS is defence in depth, not a substitute.

DO $skyhub$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skyhub_wpml_workspace') THEN
    CREATE ROLE skyhub_wpml_workspace NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skyhub_wpml_app') THEN
    -- LOGIN and password are set by the operator out of band (ALTER ROLE ... LOGIN PASSWORD ...), never in this file.
    CREATE ROLE skyhub_wpml_app NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$skyhub$;

-- Workspace -> role mapping. Only the migration owner writes it (via skyhub_wpml_provision_workspace).
CREATE TABLE IF NOT EXISTS skyhub_wpml_workspace_role (
  role_name NAME PRIMARY KEY CHECK (role_name ~ '^skyhub_wpml_ws_[0-9a-f]{32}$'),
  workspace_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT skyhub_wpml_workspace_role_name CHECK (role_name = 'skyhub_wpml_ws_' || replace(workspace_id::text, '-', ''))
);
ALTER TABLE skyhub_wpml_workspace_role ENABLE ROW LEVEL SECURITY;
ALTER TABLE skyhub_wpml_workspace_role FORCE ROW LEVEL SECURITY;
REVOKE ALL ON skyhub_wpml_workspace_role FROM PUBLIC;
GRANT SELECT ON skyhub_wpml_workspace_role TO skyhub_wpml_workspace;
DROP POLICY IF EXISTS skyhub_wpml_own_mapping ON skyhub_wpml_workspace_role;
-- Each workspace role sees only its own mapping row (no list of other workspaces).
CREATE POLICY skyhub_wpml_own_mapping ON skyhub_wpml_workspace_role FOR SELECT TO skyhub_wpml_workspace
  USING (role_name = current_user);

-- Workspace of the current role, NULL for every other role (then all policies deny).
-- SECURITY INVOKER on purpose: inside SECURITY DEFINER current_user would be the owner, not the workspace role.
CREATE OR REPLACE FUNCTION skyhub_wpml_current_workspace() RETURNS UUID
LANGUAGE sql STABLE SECURITY INVOKER SET search_path FROM CURRENT AS $skyhub$
  SELECT workspace_id FROM skyhub_wpml_workspace_role WHERE role_name = current_user
$skyhub$;
REVOKE ALL ON FUNCTION skyhub_wpml_current_workspace() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION skyhub_wpml_current_workspace() TO skyhub_wpml_workspace;

-- Minimal grants: exactly what wpml-central-routes.js executes. No DELETE/TRUNCATE anywhere,
-- revisions and audit stay append-only (the 003/004 triggers additionally reject UPDATE/DELETE).
REVOKE ALL ON skyhub_wpml_folders, skyhub_wpml_routes, skyhub_wpml_route_revisions,
  skyhub_wpml_task_snapshots, skyhub_wpml_route_audit FROM skyhub_wpml_workspace, skyhub_wpml_app;
GRANT SELECT, INSERT ON skyhub_wpml_routes TO skyhub_wpml_workspace;
GRANT UPDATE (latest_revision) ON skyhub_wpml_routes TO skyhub_wpml_workspace;
GRANT SELECT, INSERT ON skyhub_wpml_route_revisions TO skyhub_wpml_workspace;
GRANT INSERT ON skyhub_wpml_route_audit TO skyhub_wpml_workspace;

DROP POLICY IF EXISTS skyhub_wpml_ws_routes ON skyhub_wpml_routes;
CREATE POLICY skyhub_wpml_ws_routes ON skyhub_wpml_routes TO skyhub_wpml_workspace
  USING (workspace_id = skyhub_wpml_current_workspace())
  WITH CHECK (workspace_id = skyhub_wpml_current_workspace());
DROP POLICY IF EXISTS skyhub_wpml_ws_revisions ON skyhub_wpml_route_revisions;
CREATE POLICY skyhub_wpml_ws_revisions ON skyhub_wpml_route_revisions TO skyhub_wpml_workspace
  USING (workspace_id = skyhub_wpml_current_workspace())
  WITH CHECK (workspace_id = skyhub_wpml_current_workspace());
DROP POLICY IF EXISTS skyhub_wpml_ws_audit ON skyhub_wpml_route_audit;
CREATE POLICY skyhub_wpml_ws_audit ON skyhub_wpml_route_audit FOR INSERT TO skyhub_wpml_workspace
  WITH CHECK (workspace_id = skyhub_wpml_current_workspace());
-- Folders and task snapshots get no policy: not used by the service yet, so they stay default-deny.

-- Admin-only provisioning of one workspace role (needs CREATEROLE). Never granted to the app or workspace roles.
CREATE OR REPLACE FUNCTION skyhub_wpml_provision_workspace(ws UUID) RETURNS NAME
LANGUAGE plpgsql SECURITY INVOKER SET search_path FROM CURRENT AS $skyhub$
DECLARE
  r NAME := 'skyhub_wpml_ws_' || replace(ws::text, '-', '');
BEGIN
  IF ws IS NULL THEN
    RAISE EXCEPTION 'workspace id required' USING ERRCODE = '22004';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', r);
  END IF;
  EXECUTE format('GRANT skyhub_wpml_workspace TO %I', r);
  EXECUTE format('GRANT %I TO skyhub_wpml_app', r);
  INSERT INTO skyhub_wpml_workspace_role (role_name, workspace_id) VALUES (r, ws)
    ON CONFLICT (role_name) DO NOTHING;
  RETURN r;
END
$skyhub$;
REVOKE ALL ON FUNCTION skyhub_wpml_provision_workspace(UUID) FROM PUBLIC;
