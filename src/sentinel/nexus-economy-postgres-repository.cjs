'use strict';

const DEFAULT_SCHEMA = 'public';

function sqlIdent(value) {
  const id = String(value || DEFAULT_SCHEMA).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) throw new Error('Postgres schema name is invalid.');
  return `"${id}"`;
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
      `CREATE INDEX IF NOT EXISTS nexus_economy_ledger_user_created_idx ON ${s}.nexus_economy_ledger (discord_user_id, created_at DESC);`
    ].join('\n');
  }
}

module.exports = { NexusEconomyPostgresRepository, sqlIdent };
