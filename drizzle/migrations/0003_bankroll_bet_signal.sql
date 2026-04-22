-- Sprint 3: add users.bankroll_eur + signal type 'bet'

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS bankroll_eur numeric(10,2) NOT NULL DEFAULT 500;

-- Drizzle's enum is read-only after creation; add new value idempotently.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'signal_type'::regtype AND enumlabel = 'bet'
  ) THEN
    ALTER TYPE signal_type ADD VALUE 'bet';
  END IF;
END $$;
