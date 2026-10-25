-- OFFLINE-ONLY experiment. Not referenced by runtime migration or docker-compose.
-- Apply only inside an isolated, dedicated skyhub_test schema/transaction.
-- Stores allowlisted observation state; never persist raw MQTT payloads or coordinates.
-- Workspace authorization/retention are NOT implemented by this experiment.
CREATE TABLE IF NOT EXISTS dji_flighttask_observation_snapshots (
  workspace_id UUID NOT NULL,
  observation_id UUID NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id,observation_id)
);
-- No grants, no trigger-based command execution, no background schedulers,
-- no telemetry tables, and no changes to existing SkyHub migrations.
