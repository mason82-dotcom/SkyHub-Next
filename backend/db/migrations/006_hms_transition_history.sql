-- P1 independent migration. MANUAL execution ONLY; never auto-applied by npm start.
-- Stores normalized source transitions, no raw payload, no GPS, no proprietary text.
CREATE TABLE IF NOT EXISTS skyhub_hms_active (
  device_sn VARCHAR(100) NOT NULL,
  code VARCHAR(10) NOT NULL CHECK(code ~ '^0x[0-9A-F]{8}$'),
  level SMALLINT NOT NULL CHECK(level BETWEEN 0 AND 5),
  component_index INTEGER NOT NULL CHECK(component_index BETWEEN -1 AND 65535),
  sensor_index INTEGER NOT NULL CHECK(sensor_index BETWEEN -1 AND 65535),
  PRIMARY KEY (device_sn,code,component_index,sensor_index)
);
CREATE TABLE IF NOT EXISTS skyhub_hms_transitions (
  id BIGSERIAL PRIMARY KEY,
  device_sn VARCHAR(100) NOT NULL,
  code VARCHAR(10) NOT NULL CHECK(code ~ '^0x[0-9A-F]{8}$'),
  level SMALLINT NOT NULL CHECK(level BETWEEN 0 AND 5),
  component_index INTEGER NOT NULL,
  sensor_index INTEGER NOT NULL,
  action VARCHAR(16) NOT NULL CHECK(action IN ('appeared','updated','resolved')),
  source_at TIMESTAMPTZ NOT NULL,
  time_verified BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_skyhub_hms_device_id ON skyhub_hms_transitions(device_sn,id DESC);
