-- Kill-switch persistent: kind flaggati auto-disabled dopo performance negativa
CREATE TABLE IF NOT EXISTS kind_disabled (
  kind_key VARCHAR(64) PRIMARY KEY,
  disabled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT,
  resolved_count INT,
  win_rate DOUBLE PRECISION,
  manual BOOLEAN NOT NULL DEFAULT FALSE
);
