CREATE TABLE IF NOT EXISTS event_live_states (
  id BIGSERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  home_goals INT,
  away_goals INT,
  elapsed_min INT,
  status TEXT,
  red_cards_home INT DEFAULT 0,
  red_cards_away INT DEFAULT 0,
  raw JSONB
);

CREATE INDEX IF NOT EXISTS idx_els_event_time ON event_live_states (event_id, taken_at DESC);
