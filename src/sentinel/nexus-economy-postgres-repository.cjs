'use strict';

const DEFAULT_SCHEMA = 'public';

function sqlIdent(value) {
  const id = String(value || DEFAULT_SCHEMA).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) throw new Error('Postgres schema name is invalid.');
  return `"${id}"`;
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

  async getAccount(discordUserId) {
    const result = await this.pool.query(
      `SELECT discord_user_id, balance FROM ${this.schema}.nexus_economy_accounts WHERE discord_user_id = $1`,
      [discordUserId]
    );
    return result.rows?.[0] || null;
  }

  async listLedger(discordUserId, { limit = 10 } = {}) {
    const safeLimit = ledgerLimit(limit);
    const result = await this.pool.query(
      `SELECT id, amount, balance_after, entry_type, source, created_at\n` +
      `FROM ${this.schema}.nexus_economy_ledger\n` +
      `WHERE discord_user_id = $1\n` +
      `ORDER BY created_at DESC, id DESC\n` +
      `LIMIT $2`,
      [discordUserId, safeLimit]
    );
    return (result.rows || []).map((row) => Object.freeze({
      id: row.id,
      amount: Number(row.amount),
      balanceAfter: Number(row.balance_after),
      type: row.entry_type,
      source: row.source,
      at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
    }));
  }

  async transact(discordUserId, work) {
    if (typeof work !== 'function') throw new Error('Transaction callback is required.');
    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`nexus-economy:${discordUserId}`]);
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
        const result = await client.query(`SELECT discord_user_id FROM ${this.schema}.nexus_economy_identity_links WHERE discord_user_id = $1 AND eos_id = $2`, [discordUserId, eosId]);
        return result.rows?.[0] || null;
      },
      appendOrder: async (order) => {
        await client.query(`INSERT INTO ${this.schema}.nexus_economy_orders (order_id, request_id, discord_user_id, ledger_id, order_data) VALUES ($1,$2,$3,$4,$5::jsonb)`,
          [order.orderId, order.requestId, order.discordUserId, order.transactionId, JSON.stringify(order)]);
      },
      appendOutbox: async (record) => {
        await client.query(`INSERT INTO ${this.schema}.nexus_economy_purchase_outbox (record_id, order_id, record_digest, record_data) VALUES ($1,$2,$3,$4::jsonb)`,
          [record.recordId, record.orderId, record.recordDigest, JSON.stringify(record)]);
      },
      findLedgerByKey: async (idempotencyKey) => {
        const result = await client.query(
          `SELECT id, discord_user_id, amount, balance_after, entry_type, source, idempotency_key, metadata, created_at\n` +
          `FROM ${this.schema}.nexus_economy_ledger WHERE idempotency_key = $1`,
          [idempotencyKey]
        );
        const row = result.rows?.[0];
        if (!row) return null;
        return {
          id: row.id,
          discordUserId: row.discord_user_id,
          amount: Number(row.amount),
          balanceAfter: Number(row.balance_after),
          type: row.entry_type,
          source: row.source,
          idempotencyKey: row.idempotency_key,
          metadata: row.metadata || {},
          at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
        };
      },
      getOrCreateAccount: async (discordUserId) => {
        await client.query(
          `INSERT INTO ${this.schema}.nexus_economy_accounts (discord_user_id, balance) VALUES ($1, 0) ON CONFLICT (discord_user_id) DO NOTHING`,
          [discordUserId]
        );
        const result = await client.query(
          `SELECT discord_user_id, balance FROM ${this.schema}.nexus_economy_accounts WHERE discord_user_id = $1 FOR UPDATE`,
          [discordUserId]
        );
        return result.rows?.[0] || { discord_user_id: discordUserId, balance: 0 };
      },
      appendLedger: async (entry) => {
        const result = await client.query(
          `INSERT INTO ${this.schema}.nexus_economy_ledger\n` +
          `(discord_user_id, amount, balance_after, entry_type, source, idempotency_key, metadata, created_at)\n` +
          `VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)\n` +
          `RETURNING id`,
          [entry.discordUserId, entry.amount, entry.balanceAfter, entry.type, entry.source, entry.idempotencyKey, JSON.stringify(entry.metadata || {}), entry.at]
        );
        return { id: result.rows?.[0]?.id || null };
      },
      setBalance: async (discordUserId, balance) => {
        await client.query(
          `UPDATE ${this.schema}.nexus_economy_accounts SET balance = $2, updated_at = NOW() WHERE discord_user_id = $1`,
          [discordUserId, balance]
        );
      }
    };
  }

  static schemaSql({ schema = DEFAULT_SCHEMA } = {}) {
    const s = sqlIdent(schema);
    return [
      `CREATE TABLE IF NOT EXISTS ${s}.nexus_economy_accounts (`,
      '  discord_user_id TEXT PRIMARY KEY,',
      '  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),',
      '  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
      '  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      ');',
      `CREATE TABLE IF NOT EXISTS ${s}.nexus_economy_ledger (`,
      '  id BIGSERIAL PRIMARY KEY,',
      '  discord_user_id TEXT NOT NULL REFERENCES ' + `${s}.nexus_economy_accounts(discord_user_id)` + ',',
      '  amount BIGINT NOT NULL CHECK (amount <> 0),',
      '  balance_after BIGINT NOT NULL CHECK (balance_after >= 0),',
      '  entry_type TEXT NOT NULL,',
      '  source TEXT NOT NULL,',
      '  idempotency_key TEXT NOT NULL UNIQUE,',
      "  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,",
      '  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      ');',
      `CREATE INDEX IF NOT EXISTS nexus_economy_ledger_user_created_idx ON ${s}.nexus_economy_ledger (discord_user_id, created_at DESC);`,
      `CREATE TABLE IF NOT EXISTS ${s}.nexus_economy_identity_links (`,
      '  eos_id TEXT PRIMARY KEY,',
      `  discord_user_id TEXT NOT NULL REFERENCES ${s}.nexus_economy_accounts(discord_user_id),`,
      '  verified_at TIMESTAMPTZ NOT NULL,',
      '  source TEXT NOT NULL',
      ');',
      `CREATE TABLE IF NOT EXISTS ${s}.nexus_economy_orders (`,
      '  order_id TEXT PRIMARY KEY,',
      '  request_id TEXT NOT NULL UNIQUE,',
      `  discord_user_id TEXT NOT NULL REFERENCES ${s}.nexus_economy_accounts(discord_user_id),`,
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

module.exports = { NexusEconomyPostgresRepository, sqlIdent, ledgerLimit };
