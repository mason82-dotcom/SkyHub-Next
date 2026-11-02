-- DJI Pilot 2 media registration. Additive, deliberately NOT wired into server.js.
-- No STS secrets, auth tokens or raw image data are ever persisted.
CREATE TABLE IF NOT EXISTS dji_pilot_media_grants (
  workspace_id UUID NOT NULL,
  object_key_prefix TEXT NOT NULL,
  bucket VARCHAR(63) NOT NULL DEFAULT 'dji-cloud'
    CHECK (bucket='dji-cloud'),
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, object_key_prefix),
  UNIQUE (object_key_prefix),
  CHECK (expires_at > issued_at),
  CHECK (object_key_prefix ~
    '^[0-9a-f-]{36}/media/[0-9a-f]{32}$')
);

CREATE TABLE IF NOT EXISTS dji_pilot_media_verified (
  workspace_id UUID NOT NULL,
  object_key TEXT NOT NULL,
  grant_prefix TEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  fingerprint VARCHAR(128),
  tiny_fingerprint VARCHAR(128),
  file_group_id VARCHAR(128),
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  etag VARCHAR(256) NOT NULL,
  object_last_modified TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  pilot_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (workspace_id,object_key),
  FOREIGN KEY (workspace_id,grant_prefix)
    REFERENCES dji_pilot_media_grants(workspace_id,object_key_prefix)
    ON DELETE RESTRICT,
  CHECK (object_key LIKE grant_prefix || '/%'),
  CHECK (length(object_key) <= 1024)
);
CREATE UNIQUE INDEX IF NOT EXISTS dji_pilot_verified_fingerprint
  ON dji_pilot_media_verified(workspace_id,fingerprint)
  WHERE fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS dji_pilot_verified_tiny
  ON dji_pilot_media_verified(workspace_id,tiny_fingerprint)
  WHERE tiny_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS dji_pilot_verified_by_grant
  ON dji_pilot_media_verified(workspace_id,grant_prefix);
