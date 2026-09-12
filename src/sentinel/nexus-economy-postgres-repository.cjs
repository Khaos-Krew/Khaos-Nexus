'use strict';

const DEFAULT_SCHEMA = 'public';
const SUPPORTED_CURRENCIES = Object.freeze(['NEXUS_COINS', 'NEXUS_POINTS', 'DINO_CACHE_TOKENS']);
const CURRENCY_ALIASES = Object.freeze({
  NEXUS_COINS: 'NEXUS_COINS',
  'NEXUS COINS': 'NEXUS_COINS',
  NEXUSCOINS: 'NEXUS_COINS',
  NEXUS_POINTS: 'NEXUS_POINTS',
  'NEXUS POINTS': 'NEXUS_POINTS',
  NEXUSPOINTS: 'NEXUS_POINTS',
  DINO_CACHE_TOKENS: 'DINO_CACHE_TOKENS',
  'DINO CACHE TOKENS': 'DINO_CACHE_TOKENS',
  DINOCACHETOKENS: 'DINO_CACHE_TOKENS'
});

function sqlIdent(value) {
  const id = String(value || DEFAULT_SCHEMA).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) throw new Error('Postgres schema name is invalid.');
  return `"${id}"`;
}

function cleanExternalId(value, label = 'External ID') {
  const id = String(value || '').trim();
  if (!id || id.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(id)) throw new Error(`${label} is invalid.`);
  return id;
}

function cleanProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(provider)) throw new Error('Identity provider is invalid.');
  return provider;
}

function normalizeCurrency(value = 'NEXUS_POINTS') {
  const raw = String(value || '').trim().toUpperCase().replace(/[-]+/g, '_').replace(/\s+/g, ' ');
  const currency = CURRENCY_ALIASES[raw] || CURRENCY_ALIASES[raw.replace(/_/g, ' ')] || null;
  if (!currency || !SUPPORTED_CURRENCIES.includes(currency)) throw new Error('Unsupported Nexus economy currency.');
  return currency;
}

function ledgerLimit(value, fallback = 10) {
  const limit = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('Ledger limit must be a whole number from 1 to 50.');
  return limit;
}

class NexusEconomyPostgresRepository {
  constructor({ pool, schema = DEFAULT_SCHEMA } = {}) {
    if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') {
      throw new Error('Postgres pool with connect() and query() is required.');
    }
    this.pool = pool;
    this.schema = sqlIdent(schema);
  }

  async getIdentityByLink(provider, externalId) {
    const p = cleanProvider(provider);
    const id = cleanExternalId(externalId);
    const result = await this.pool.query(
      `SELECT i.economic_identity_id, i.status, l.provider, l.external_id, l.verified_at, l.source\n` +
      `FROM ${this.schema}.nexus_economic_identity_links l\n` +
      `JOIN ${this.schema}.nexus_economic_identities i ON i.economic_identity_id = l.economic_identity_id\n` +
      `WHERE l.provider = $1 AND l.external_id = $2`,
      [p, id]
    );
    return result.rows?.[0] || null;
  }

  async resolveVerifiedIdentity({ discordUserId, eosId } = {}) {
    const discord = cleanExternalId(discordUserId, 'Discord user ID');
    const eos = cleanExternalId(eosId, 'EOS ID');
    const result = await this.pool.query(
      `SELECT i.economic_identity_id, i.status\n` +
      `FROM ${this.schema}.nexus_economic_identities i\n` +
      `JOIN ${this.schema}.nexus_economic_identity_links d ON d.economic_identity_id = i.economic_identity_id\n` +
      `JOIN ${this.schema}.nexus_economic_identity_links e ON e.economic_identity_id = i.economic_identity_id\n` +
      `WHERE i.status = 'verified'\n` +
      `AND d.provider = 'discord' AND d.external_id = $1 AND d.verified_at IS NOT NULL\n` +
      `AND e.provider = 'eos' AND e.external_id = $2 AND e.verified_at IS NOT NULL`,
      [discord, eos]
    );
    return result.rows?.[0] || null;
  }

  async getWalletByDiscord(discordUserId, currency = 'NEXUS_POINTS') {
    const discord = cleanExternalId(discordUserId, 'Discord user ID');
    const normalizedCurrency = normalizeCurrency(currency);
    const result = await this.pool.query(
      `SELECT w.economic_identity_id, w.currency, w.balance\n` +
      `FROM ${this.schema}.nexus_economy_wallets w\n` +
      `JOIN ${this.schema}.nexus_economic_identity_links l ON l.economic_identity_id = w.economic_identity_id\n` +
      `JOIN ${this.schema}.nexus_economic_identities i ON i.economic_identity_id = w.economic_identity_id\n` +
      `WHERE l.provider = 'discord' AND l.external_id = $1 AND l.verified_at IS NOT NULL\n` +
      `AND i.status = 'verified' AND w.currency = $2`,
      [discord, normalizedCurrency]
    );
    return result.rows?.[0] || null;
  }

  async getAccount(discordUserId) {
    const wallet = await this.getWalletByDiscord(discordUserId, 'NEXUS_POINTS');
    return wallet ? { discord_user_id: String(discordUserId), ...wallet } : null;
  }

  async listLedger(discordUserId, { currency = 'NEXUS_POINTS', limit = 10 } = {}) {
    const discord = cleanExternalId(discordUserId, 'Discord user ID');
    const normalizedCurrency = normalizeCurrency(currency);
    const safeLimit = ledgerLimit(limit);
    const result = await this.pool.query(
      `SELECT x.id, x.economic_identity_id, x.currency, x.amount, x.balance_after, x.entry_type, x.source, x.created_at\n` +
      `FROM ${this.schema}.nexus_economy_ledger x\n` +
      `JOIN ${this.schema}.nexus_economic_identity_links l ON l.economic_identity_id = x.economic_identity_id\n` +
      `WHERE l.provider = 'discord' AND l.external_id = $1 AND x.currency = $2\n` +
      `ORDER BY x.created_at DESC, x.id DESC\n` +
      `LIMIT $3`,
      [discord, normalizedCurrency, safeLimit]
    );
    return (result.rows || []).map((row) => Object.freeze({
      id: row.id,
      economicIdentityId: row.economic_identity_id,
      currency: row.currency,
      amount: Number(row.amount),
      balanceAfter: Number(row.balance_after),
      type: row.entry_type,
      source: row.source,
      at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
    }));
  }

  async transact(economicIdentityId, currency, work) {
    const identityId = cleanExternalId(economicIdentityId, 'Economic identity ID');
    const normalizedCurrency = normalizeCurrency(currency);
    if (typeof work !== 'function') throw new Error('Transaction callback is required.');
    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`nexus-economy:${identityId}:${normalizedCurrency}`]);
      const tx = this.#transactionView(client);
      const result = await work(tx);
      await client.query('COMMIT');
      committed = true;
      return result;
    } catch (error) {
      if (!committed) {
        try { await client.query('ROLLBACK'); } catch {}
      }
      throw error;
    } finally {
      client.release();
    }
  }

  #transactionView(client) {
    return {
      findOrder: async (orderId) => {
        const result = await client.query(`SELECT order_data FROM ${this.schema}.nexus_economy_orders WHERE order_id = $1`, [orderId]);
        return result.rows?.[0]?.order_data || null;
      },
      findIdentity: async (discordUserId, eosId) => {
        const result = await client.query(
          `SELECT i.economic_identity_id, i.status\n` +
          `FROM ${this.schema}.nexus_economic_identities i\n` +
          `JOIN ${this.schema}.nexus_economic_identity_links d ON d.economic_identity_id = i.economic_identity_id\n` +
          `JOIN ${this.schema}.nexus_economic_identity_links e ON e.economic_identity_id = i.economic_identity_id\n` +
          `WHERE i.status = 'verified' AND d.provider = 'discord' AND d.external_id = $1 AND d.verified_at IS NOT NULL\n` +
          `AND e.provider = 'eos' AND e.external_id = $2 AND e.verified_at IS NOT NULL`,
          [discordUserId, eosId]
        );
        return result.rows?.[0] || null;
      },
      appendOrder: async (order) => {
        await client.query(
          `INSERT INTO ${this.schema}.nexus_economy_orders\n` +
          `(order_id, request_id, economic_identity_id, discord_user_id, currency, ledger_id, order_data)\n` +
          `VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [order.orderId, order.requestId, order.economicIdentityId, order.discordUserId, order.currency, order.transactionId, JSON.stringify(order)]
        );
      },
      appendOutbox: async (record) => {
        await client.query(`INSERT INTO ${this.schema}.nexus_economy_purchase_outbox (record_id, order_id, record_digest, record_data) VALUES ($1,$2,$3,$4::jsonb)`,
          [record.recordId, record.orderId, record.recordDigest, JSON.stringify(record)]);
      },
      findLedgerByKey: async (idempotencyKey) => {
        const result = await client.query(
          `SELECT id, economic_identity_id, currency, amount, balance_after, entry_type, source, idempotency_key, metadata, created_at\n` +
          `FROM ${this.schema}.nexus_economy_ledger WHERE idempotency_key = $1`,
          [idempotencyKey]
        );
        const row = result.rows?.[0];
        if (!row) {
          const tombstone = await client.query(
            `SELECT idempotency_key, legacy_entry_id, source FROM ${this.schema}.nexus_economy_idempotency_tombstones WHERE idempotency_key = $1`,
            [idempotencyKey]
          );
          const legacy = tombstone.rows?.[0];
          if (!legacy) return null;
          return {
            id: null,
            tombstone: true,
            idempotencyKey: legacy.idempotency_key,
            legacyEntryId: legacy.legacy_entry_id,
            source: legacy.source
          };
        }
        return {
          id: row.id,
          economicIdentityId: row.economic_identity_id,
          currency: row.currency,
          amount: Number(row.amount),
          balanceAfter: Number(row.balance_after),
          type: row.entry_type,
          source: row.source,
          idempotencyKey: row.idempotency_key,
          metadata: row.metadata || {},
          at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
        };
      },
      getOrCreateWallet: async (economicIdentityId, currency) => {
        const normalizedCurrency = normalizeCurrency(currency);
        await client.query(
          `INSERT INTO ${this.schema}.nexus_economy_wallets (economic_identity_id, currency, balance)\n` +
          `SELECT $1, $2, 0 WHERE EXISTS (SELECT 1 FROM ${this.schema}.nexus_economic_identities WHERE economic_identity_id = $1 AND status = 'verified')\n` +
          `ON CONFLICT (economic_identity_id, currency) DO NOTHING`,
          [economicIdentityId, normalizedCurrency]
        );
        const result = await client.query(
          `SELECT economic_identity_id, currency, balance FROM ${this.schema}.nexus_economy_wallets\n` +
          `WHERE economic_identity_id = $1 AND currency = $2 FOR UPDATE`,
          [economicIdentityId, normalizedCurrency]
        );
        if (!result.rows?.[0]) throw new Error('Verified economic identity is required.');
        return result.rows[0];
      },
      appendLedger: async (entry) => {
        const result = await client.query(
          `INSERT INTO ${this.schema}.nexus_economy_ledger\n` +
          `(economic_identity_id, currency, amount, balance_after, entry_type, source, idempotency_key, metadata, created_at)\n` +
          `VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)\n` +
          `RETURNING id`,
          [entry.economicIdentityId, normalizeCurrency(entry.currency), entry.amount, entry.balanceAfter, entry.type, entry.source, entry.idempotencyKey, JSON.stringify(entry.metadata || {}), entry.at]
        );
        return { id: result.rows?.[0]?.id || null };
      },
      setBalance: async (economicIdentityId, currency, balance) => {
        await client.query(
          `UPDATE ${this.schema}.nexus_economy_wallets SET balance = $3, updated_at = NOW()\n` +
          `WHERE economic_identity_id = $1 AND currency = $2`,
          [economicIdentityId, normalizeCurrency(currency), balance]
        );
      }
    };
  }

  static schemaSql({ schema = DEFAULT_SCHEMA } = {}) {
    const s = sqlIdent(schema);
    return [
      `CREATE TABLE IF NOT EXISTS ${s}.nexus_economic_identities (`,
      '  economic_identity_id TEXT PRIMARY KEY,',
      "  status TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('verified','restricted','disabled')),",
      '  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
      '  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      ');',
      `CREATE TABLE IF NOT EXISTS ${s}.nexus_economic_identity_links (`,
      '  provider TEXT NOT NULL,',
      '  external_id TEXT NOT NULL,',
      `  economic_identity_id TEXT NOT NULL REFERENCES ${s}.nexus_economic_identities(economic_identity_id),`,
      '  verified_at TIMESTAMPTZ,',
      '  source TEXT NOT NULL,',
      '  PRIMARY KEY (provider, external_id)',
      ');',
      `CREATE INDEX IF NOT EXISTS nexus_economic_identity_links_identity_idx ON ${s}.nexus_economic_identity_links (economic_identity_id);`,
      `CREATE TABLE IF NOT EXISTS ${s}.nexus_economy_wallets (`,
      `  economic_identity_id TEXT NOT NULL REFERENCES ${s}.nexus_economic_identities(economic_identity_id),`,
      "  currency TEXT NOT NULL CHECK (currency IN ('NEXUS_COINS','NEXUS_POINTS','DINO_CACHE_TOKENS')),",
      '  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),',
      '  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
      '  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
      '  PRIMARY KEY (economic_identity_id, currency)',
      ');',
      `CREATE TABLE IF NOT EXISTS ${s}.nexus_economy_ledger (`,
      '  id BIGSERIAL PRIMARY KEY,',
      '  economic_identity_id TEXT NOT NULL,',
      "  currency TEXT NOT NULL CHECK (currency IN ('NEXUS_COINS','NEXUS_POINTS','DINO_CACHE_TOKENS')),",
      '  amount BIGINT NOT NULL CHECK (amount <> 0),',
      '  balance_after BIGINT NOT NULL CHECK (balance_after >= 0),',
      '  entry_type TEXT NOT NULL,',
      '  source TEXT NOT NULL,',
      '  idempotency_key TEXT NOT NULL UNIQUE,',
      "  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,",
      '  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
      `  FOREIGN KEY (economic_identity_id, currency) REFERENCES ${s}.nexus_economy_wallets(economic_identity_id, currency)`,
      ');',
      `CREATE INDEX IF NOT EXISTS nexus_economy_ledger_identity_currency_created_idx ON ${s}.nexus_economy_ledger (economic_identity_id, currency, created_at DESC);`,
      `CREATE TABLE IF NOT EXISTS ${s}.nexus_economy_idempotency_tombstones (`,
      '  idempotency_key TEXT PRIMARY KEY,',
      '  legacy_entry_id TEXT,',
      "  source TEXT NOT NULL DEFAULT 'legacy-economy-json',",
      '  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      ');',
      `CREATE TABLE IF NOT EXISTS ${s}.nexus_economy_orders (`,
      '  order_id TEXT PRIMARY KEY,',
      '  request_id TEXT NOT NULL UNIQUE,',
      `  economic_identity_id TEXT NOT NULL REFERENCES ${s}.nexus_economic_identities(economic_identity_id),`,
      '  discord_user_id TEXT NOT NULL,',
      "  currency TEXT NOT NULL CHECK (currency IN ('NEXUS_COINS','NEXUS_POINTS','DINO_CACHE_TOKENS')),",
      `  ledger_id BIGINT NOT NULL UNIQUE REFERENCES ${s}.nexus_economy_ledger(id),`,
      '  order_data JSONB NOT NULL,',
      '  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      ');',
      `CREATE TABLE IF NOT EXISTS ${s}.nexus_economy_purchase_outbox (`,
      '  record_id TEXT PRIMARY KEY,',
      `  order_id TEXT NOT NULL UNIQUE REFERENCES ${s}.nexus_economy_orders(order_id),`,
      '  record_digest TEXT NOT NULL,',
      '  record_data JSONB NOT NULL,',
      '  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      ');'
    ].join('\n');
  }
}

module.exports = {
  DEFAULT_SCHEMA,
  SUPPORTED_CURRENCIES,
  NexusEconomyPostgresRepository,
  sqlIdent,
  cleanExternalId,
  cleanProvider,
  normalizeCurrency,
  ledgerLimit
};
