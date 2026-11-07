-- OFFLINE-ONLY RLS laboratory policy for the existing dedicated test schema.
-- NEVER run this file in production or on the Raspberry Pi.
-- Table must already exist from dji-flighttask-observation.sql.
-- Application logins need separate, explicitly reviewed least-privilege GRANTs.
REVOKE ALL ON dji_flighttask_observation_snapshots FROM PUBLIC;
ALTER TABLE dji_flighttask_observation_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE dji_flighttask_observation_snapshots FORCE ROW LEVEL SECURITY;
-- At least one permissive policy is required. Keep the mandatory tenant
-- predicate RESTRICTIVE so a future permissive policy cannot OR it away.
DROP POLICY IF EXISTS skyhub_flighttask_workspace_grant ON dji_flighttask_observation_snapshots;
DROP POLICY IF EXISTS skyhub_flighttask_workspace_scope ON dji_flighttask_observation_snapshots;
CREATE POLICY skyhub_flighttask_workspace_grant
  ON dji_flighttask_observation_snapshots
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (true) WITH CHECK (true);
CREATE POLICY skyhub_flighttask_workspace_scope
  ON dji_flighttask_observation_snapshots
  AS RESTRICTIVE FOR ALL TO PUBLIC
  USING (workspace_id::text = NULLIF(current_setting('skyhub.workspace_id', true), ''))
  WITH CHECK (workspace_id::text = NULLIF(current_setting('skyhub.workspace_id', true), ''));
-- A policy does not grant SELECT/INSERT/UPDATE/DELETE itself. The isolated
-- integration test grants these privileges to its disposable NOLOGIN test role.
-- The custom setting alone is NOT an authentication proof; only trusted
-- transactions against a non-owner NOBYPASSRLS role may set it.
