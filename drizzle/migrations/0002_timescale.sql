-- OPTIONAL: requires TimescaleDB installed.
--   sudo apt-get install timescaledb-2-postgresql-16
--   Then: CREATE EXTENSION timescaledb; (as superuser)
-- If the extension is not available, skip this file and rely on regular Postgres indexing.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Convert odds_snapshots into a hypertable partitioned by taken_at.
-- chunk_time_interval = 1 day (reasonable for 50k-200k rows/day).
SELECT create_hypertable(
  'odds_snapshots',
  'taken_at',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE,
  migrate_data => TRUE
);

SELECT create_hypertable(
  'volumes_snapshots',
  'taken_at',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE,
  migrate_data => TRUE
);

-- Compression policy (> 7 days old)
ALTER TABLE odds_snapshots SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'event_id, market_id, selection_id, book_id'
);
SELECT add_compression_policy('odds_snapshots', INTERVAL '7 days', if_not_exists => TRUE);

-- Continuous aggregate: latest odd per (event, market, selection, book) in last 24h
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_odds_5min
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('5 minutes', taken_at) AS bucket,
  event_id,
  market_id,
  selection_id,
  book_id,
  last(odd, taken_at) AS last_odd,
  max(odd) AS max_odd,
  min(odd) AS min_odd,
  avg(odd) AS avg_odd,
  count(*) AS snapshot_count
FROM odds_snapshots
GROUP BY bucket, event_id, market_id, selection_id, book_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('mv_odds_5min',
  start_offset => INTERVAL '2 hours',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists => TRUE
);
