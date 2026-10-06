CREATE TABLE IF NOT EXISTS {{schema}}.nexus_coin_shop_quotes (
  nonce TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  economic_identity_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  price BIGINT NOT NULL,
  expected_balance BIGINT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS {{schema}}.nexus_coin_shop_entitlements (
  economic_identity_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  ledger_id BIGINT,
  refund_ledger_id BIGINT,
  price BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'refunded')),
  equipped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (economic_identity_id, sku)
);
CREATE TABLE IF NOT EXISTS {{schema}}.nexus_coin_shop_attempts (
  id BIGSERIAL PRIMARY KEY,
  economic_identity_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS nexus_coin_shop_attempts_identity_created_idx
  ON {{schema}}.nexus_coin_shop_attempts (economic_identity_id, created_at DESC);
CREATE TABLE IF NOT EXISTS {{schema}}.nexus_coin_shop_audit (
  audit_id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  ledger_id BIGINT,
  sku TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
