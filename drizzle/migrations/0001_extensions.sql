-- Run AFTER drizzle-kit push/migrate. Adds pg_trgm for fuzzy matching on aliases.
-- TimescaleDB hypertable creation is in 0002_timescale.sql (optional, skip if extension unavailable).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram index on team_aliases.alias for fast fuzzy lookup
CREATE INDEX IF NOT EXISTS idx_team_aliases_alias_trgm
  ON team_aliases USING gin (alias gin_trgm_ops);
