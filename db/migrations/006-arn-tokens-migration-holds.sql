-- Hold-until-verified rows for the one-time legacy MySQL ARN balance migration.
-- Apply with the additive runner. The worker does not run this file on boot.
-- The balance migration itself is a separate staff script and does not run here.

CREATE TABLE IF NOT EXISTS nexus_economy_arn_migration_holds (
  discord_user_id TEXT PRIMARY KEY,
  amount BIGINT NOT NULL CHECK (amount > 0),
  economic_identity_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'credited')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  credited_at TIMESTAMPTZ
);
