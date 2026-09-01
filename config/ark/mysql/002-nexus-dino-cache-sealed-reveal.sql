ALTER TABLE nexus_dino_cache_transactions
  MODIFY COLUMN state ENUM('PENDING','ROLLED','PURCHASED','SEALED','REVEALED','DELIVERING','DELIVERED','FAILED','RETRY') NOT NULL DEFAULT 'PURCHASED',
  ADD COLUMN IF NOT EXISTS revealed_at DATETIME(3) NULL AFTER rolled_at,
  ADD COLUMN IF NOT EXISTS discord_notified_at DATETIME(3) NULL AFTER revealed_at,
  ADD COLUMN IF NOT EXISTS announced_at DATETIME(3) NULL AFTER discord_notified_at;

UPDATE nexus_dino_cache_transactions SET state='PURCHASED' WHERE state='PENDING';
UPDATE nexus_dino_cache_transactions SET state='SEALED' WHERE state='ROLLED';

ALTER TABLE nexus_dino_cache_transactions
  MODIFY COLUMN state ENUM('PURCHASED','SEALED','REVEALED','DELIVERING','DELIVERED','FAILED','RETRY') NOT NULL DEFAULT 'PURCHASED';

CREATE INDEX ix_nexus_dino_cache_reveal ON nexus_dino_cache_transactions (player_eos_id, state, created_at);
CREATE INDEX ix_nexus_dino_cache_notify ON nexus_dino_cache_transactions (state, discord_notified_at, created_at);
