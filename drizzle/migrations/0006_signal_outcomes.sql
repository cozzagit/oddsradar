-- Sprint 6: tracking outcome dei signal per learning / ROI
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'signal_outcome') THEN
    CREATE TYPE signal_outcome AS ENUM ('pending', 'won', 'lost', 'void', 'unknown');
  END IF;
END $$;

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS outcome signal_outcome NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_score_home INT,
  ADD COLUMN IF NOT EXISTS actual_score_away INT,
  ADD COLUMN IF NOT EXISTS closing_odd DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS simulated_stake DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS simulated_profit DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS idx_signals_outcome_resolved ON signals (outcome, resolved_at);
CREATE INDEX IF NOT EXISTS idx_signals_type_outcome ON signals (type, outcome);
