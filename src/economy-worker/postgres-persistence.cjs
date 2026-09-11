'use strict';
const { Pool } = require('pg');
const { NexusEconomyStore } = require('../sentinel/nexus-economy-worker.cjs');
const { ShopOrderStore } = require('../sentinel/cluster-shop-service.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const empty = () => ({ wallet: new NexusEconomyStore().empty(), shop: new ShopOrderStore().empty() });

// One locked Postgres row is a deliberate small-cluster transaction boundary.
// Wallet, dedupe receipts and orders commit together; no local disk cache is authoritative.
class PostgresEconomyPersistence {
  constructor({ pool, connectionString } = {}) {
    this.pool = pool || new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000 });
    this.pool.on?.('error', error => console.error('[Nexus Economy] idle database connection failed:', error.code || 'database-error'));
    this.tail = Promise.resolve();
    this.active = null;
    this.kind = 'postgres';
    this.walletStore = this.store('wallet');
    this.shopStore = this.store('shop');
  }
  store(key) {
    return {
      read: () => {
        if (!this.active) throw new Error('Economy state requires an active database transaction.');
        return clone(this.active[key]);
      },
      write: value => {
        if (!this.active) throw new Error('Economy state requires an active database transaction.');
        this.active[key] = clone(value);
        return value;
      }
    };
  }
  async initialize() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS nexus_economy_state (
      id INTEGER PRIMARY KEY CHECK (id=1), schema_version INTEGER NOT NULL CHECK (schema_version=1),
      state JSONB NOT NULL, revision BIGINT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await this.pool.query('INSERT INTO nexus_economy_state (id,schema_version,state) VALUES (1,1,$1::jsonb) ON CONFLICT (id) DO NOTHING', [JSON.stringify(empty())]);
  }
  transaction(fn) {
    const result = this.tail.catch(() => {}).then(async () => {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '15s'");
        const { rows } = await client.query('SELECT schema_version,state FROM nexus_economy_state WHERE id=1 FOR UPDATE');
        const state = rows[0]?.state;
        if (rows[0]?.schema_version !== 1 || !state?.wallet?.accounts || !state?.shop?.orders) throw new Error('Economy database state is invalid.');
        this.active = clone(state);
        const before = JSON.stringify(this.active);
        const value = await fn();
        const after = JSON.stringify(this.active);
        if (after !== before) await client.query('UPDATE nexus_economy_state SET state=$1::jsonb,revision=revision+1,updated_at=now() WHERE id=1', [after]);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { this.active = null; client.release(); }
    });
    this.tail = result;
    return result;
  }
  async close() { await this.tail.catch(() => {}); await this.pool.end(); }
}

module.exports = { PostgresEconomyPersistence };
