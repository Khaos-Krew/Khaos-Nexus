-- Additive ARN event journal for dedupe and caps.
-- Does not change wallet, ledger, or order CHECK constraints.
-- Apply once with: node scripts/apply-economy-sql-migrations.cjs
-- The economy worker does not run this file on boot.

CREATE TABLE IF NOT EXISTS nexus_economy_arn_events (
  event_key TEXT PRIMARY KEY,
  feed_key TEXT NOT NULL,
  economic_identity_id TEXT,
  outcome TEXT NOT NULL,
  roll INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nexus_economy_arn_events_feed_idx
  ON nexus_economy_arn_events (feed_key, created_at DESC);
