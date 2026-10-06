-- Pause switch for live ARN credits and spends.
-- A zero-amount ledger row cannot record pause: ledger amounts must be non-zero.
-- Apply with the additive runner. The worker does not run this file on boot.

CREATE TABLE IF NOT EXISTS nexus_economy_arn_control (
  id TEXT PRIMARY KEY,
  paused BOOLEAN NOT NULL,
  actor TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
