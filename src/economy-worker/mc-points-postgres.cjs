'use strict';

const { sqlIdent } = require('../sentinel/nexus-economy-postgres-repository.cjs');
const { MemoryMcPoints } = require('./mc-points-service.cjs');
const { quarantineDenylist } = require('../sentinel/nexus-economy-wallet-core.cjs');

function schemaSql(schema = 'public') {
  const s = sqlIdent(schema);
  return [
    `CREATE TABLE IF NOT EXISTS ${s}.nexus_mc_links (`,
    '  mc_uuid TEXT PRIMARY KEY,',
    '  economic_identity_id TEXT NOT NULL,',
    '  discord_user_id TEXT NOT NULL,',
    '  verified_at TIMESTAMPTZ,',
    '  unlinked_at TIMESTAMPTZ,',
    '  cooldown_until TIMESTAMPTZ,',
    '  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    ');',
    `CREATE TABLE IF NOT EXISTS ${s}.nexus_mc_link_challenges (`,
    '  discord_user_id TEXT PRIMARY KEY,',
    '  mc_uuid TEXT NOT NULL,',
    '  mc_name TEXT NOT NULL,',
    '  code_hash TEXT NOT NULL,',
    '  economic_identity_id TEXT NOT NULL,',
    '  expires_at TIMESTAMPTZ NOT NULL',
    ');',
    `CREATE TABLE IF NOT EXISTS ${s}.nexus_mc_orders (`,
    '  order_id TEXT PRIMARY KEY,',
    '  order_data JSONB NOT NULL,',
    '  status TEXT NOT NULL,',
    '  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    ');',
    `CREATE TABLE IF NOT EXISTS ${s}.nexus_mc_grants (`,
    '  grant_id TEXT PRIMARY KEY,',
    "  kind TEXT NOT NULL DEFAULT 'starter_kit',",
    '  economic_identity_id TEXT NOT NULL,',
    '  mc_uuid TEXT NOT NULL,',
    '  kit_version TEXT NOT NULL,',
    '  order_id TEXT NOT NULL,',
    '  status TEXT NOT NULL,',
    '  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
    '  UNIQUE (kind, economic_identity_id),',
    '  UNIQUE (kind, mc_uuid)',
    ');'
  ].join('\n');
}

class PostgresMcPoints {
  constructor({ pool, schema = 'public', wallet, now = () => Date.now(), env = process.env } = {}) {
    if (!pool) throw new Error('Postgres pool is required.');
    if (!wallet) throw new Error('Wallet is required.');
    this.pool = pool;
    this.schema = schema;
    this.wallet = wallet;
    this.now = now;
    this.env = env;
    this.quotes = new Map();
  }

  async ensureSchema() {
    await this.pool.query(schemaSql(this.schema));
  }

  flags() {
    return new MemoryMcPoints({ wallet: this.wallet, env: this.env, now: this.now }).flags();
  }

  async challenge(input) { return this.#mutate((memory) => memory.challenge(input)); }
  async confirm(input) { return this.#mutate((memory) => memory.confirm(input)); }
  async unlink(input) { return this.#mutate((memory) => memory.unlink(input)); }
  async status(input) { return this.#read((memory) => memory.status(input)); }
  async quote(input) { return this.#read((memory) => memory.quote(input)); }
  async buy(input) { return this.#mutate((memory) => memory.buy(input)); }
  async claimStarterKit(input) { return this.#mutate((memory) => memory.claimStarterKit(input)); }
  listGrants() { return this.#read((memory) => memory.listGrants()); }
  pendingOrders() { return this.#read((memory) => memory.pendingOrders()); }
  claimNext() { return this.#mutate((memory) => memory.claimNext(this.now())); }
  markDelivery(input) { return this.#mutate((memory) => memory.markDelivery(input)); }
  refund(input) { return this.#mutate((memory) => memory.refund(input)); }
  sweepRefunds(input) { return this.#mutate((memory) => memory.sweepRefunds(input)); }
  linkByUuid(mcUuid) { return this.#read((memory) => memory.linkByUuid(mcUuid)); }

  async #walletView() {
    const wallet = this.wallet;
    const pool = this.pool;
    const schema = sqlIdent(this.schema);
    const env = this.env;
    return {
      async resolve(discordUserId) {
        const result = await pool.query(
          `SELECT i.economic_identity_id, i.status, d.verified_at FROM ${schema}.nexus_economic_identities i ` +
          `JOIN ${schema}.nexus_economic_identity_links d ON d.economic_identity_id = i.economic_identity_id ` +
          `WHERE d.provider = 'discord' AND d.external_id = $1 LIMIT 1`,
          [String(discordUserId || '').trim()]
        );
        const row = result.rows?.[0];
        if (!row) return null;
        return {
          economicIdentityId: row.economic_identity_id,
          status: row.status,
          verifiedAt: row.verified_at
        };
      },
      balance(discordUserId) { return wallet.balance(discordUserId, 'NEXUS_POINTS'); },
      spend(input) { return wallet.spend({ ...input, currency: 'NEXUS_POINTS' }); },
      credit(input) { return wallet.credit({ ...input, currency: 'NEXUS_POINTS' }); },
      async lifetimeMs(economicIdentityId) {
        const result = await pool.query(
          `SELECT mc_lifetime_ms FROM ${schema}.nexus_economy_accrual_state WHERE economic_identity_id = $1`,
          [economicIdentityId]
        );
        return Number(result.rows?.[0]?.mc_lifetime_ms || 0);
      },
      async quarantined(economicIdentityId) {
        return quarantineDenylist(env).has(String(economicIdentityId || ''));
      }
    };
  }

  async #hydrate(client, memory) {
    const s = sqlIdent(this.schema);
    const links = await client.query(`SELECT mc_uuid, economic_identity_id, discord_user_id, verified_at, unlinked_at, cooldown_until FROM ${s}.nexus_mc_links`);
    memory.links = new Map(links.rows.map((row) => [row.mc_uuid, {
      mcUuid: row.mc_uuid,
      economicIdentityId: row.economic_identity_id,
      discordUserId: row.discord_user_id,
      verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : null,
      unlinkedAt: row.unlinked_at ? new Date(row.unlinked_at).toISOString() : null,
      cooldownUntil: row.cooldown_until ? new Date(row.cooldown_until).toISOString() : null
    }]));
    const challenges = await client.query(`SELECT discord_user_id, mc_uuid, mc_name, code_hash, economic_identity_id, expires_at FROM ${s}.nexus_mc_link_challenges`);
    memory.challenges = new Map(challenges.rows.map((row) => [row.discord_user_id, {
      discordUserId: row.discord_user_id,
      mcUuid: row.mc_uuid,
      mcName: row.mc_name,
      codeHash: row.code_hash,
      economicIdentityId: row.economic_identity_id,
      expiresAt: Date.parse(row.expires_at)
    }]));
    const orders = await client.query(`SELECT order_data FROM ${s}.nexus_mc_orders`);
    memory.orders = new Map(orders.rows.map((row) => {
      const order = row.order_data;
      return [order.orderId, order];
    }));
    const grants = await client.query(`SELECT kind, economic_identity_id, mc_uuid, kit_version, order_id, status, claimed_at FROM ${s}.nexus_mc_grants`);
    memory.grants = grants.rows.map((row) => ({
      kind: row.kind,
      economicIdentityId: row.economic_identity_id,
      mcUuid: row.mc_uuid,
      kitVersion: row.kit_version,
      orderId: row.order_id,
      status: row.status,
      claimedAt: new Date(row.claimed_at).toISOString()
    }));
    memory.quotes = this.quotes;
  }

  async #flush(client, memory) {
    const s = sqlIdent(this.schema);
    await client.query(`DELETE FROM ${s}.nexus_mc_links`);
    for (const link of memory.links.values()) {
      await client.query(
        `INSERT INTO ${s}.nexus_mc_links (mc_uuid, economic_identity_id, discord_user_id, verified_at, unlinked_at, cooldown_until) VALUES ($1,$2,$3,$4,$5,$6)`,
        [link.mcUuid, link.economicIdentityId, link.discordUserId, link.verifiedAt, link.unlinkedAt, link.cooldownUntil]
      );
      if (link.verifiedAt) {
        await client.query(
          `INSERT INTO ${s}.nexus_economic_identity_links (provider, external_id, economic_identity_id, verified_at, source) ` +
          `VALUES ('minecraft', $1, $2, $3, 'mc-link') ` +
          `ON CONFLICT (provider, external_id) DO UPDATE SET economic_identity_id = EXCLUDED.economic_identity_id, verified_at = EXCLUDED.verified_at, source = EXCLUDED.source ` +
          `WHERE ${s}.nexus_economic_identity_links.verified_at IS NULL OR ${s}.nexus_economic_identity_links.economic_identity_id = EXCLUDED.economic_identity_id`,
          [link.mcUuid, link.economicIdentityId, link.verifiedAt]
        );
      } else {
        await client.query(
          `UPDATE ${s}.nexus_economic_identity_links SET verified_at = NULL WHERE provider = 'minecraft' AND external_id = $1`,
          [link.mcUuid]
        );
      }
    }
    await client.query(`DELETE FROM ${s}.nexus_mc_link_challenges`);
    for (const challenge of memory.challenges.values()) {
      await client.query(
        `INSERT INTO ${s}.nexus_mc_link_challenges (discord_user_id, mc_uuid, mc_name, code_hash, economic_identity_id, expires_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [challenge.discordUserId, challenge.mcUuid, challenge.mcName, challenge.codeHash, challenge.economicIdentityId, new Date(challenge.expiresAt).toISOString()]
      );
    }
    await client.query(`DELETE FROM ${s}.nexus_mc_orders`);
    for (const order of memory.orders.values()) {
      await client.query(
        `INSERT INTO ${s}.nexus_mc_orders (order_id, order_data, status, created_at) VALUES ($1,$2::jsonb,$3,$4)`,
        [order.orderId, JSON.stringify(order), order.status, order.createdAt]
      );
    }
    await client.query(`DELETE FROM ${s}.nexus_mc_grants`);
    for (const grant of memory.grants) {
      await client.query(
        `INSERT INTO ${s}.nexus_mc_grants (grant_id, kind, economic_identity_id, mc_uuid, kit_version, order_id, status, claimed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [`${grant.kind}:${grant.economicIdentityId}`, grant.kind, grant.economicIdentityId, grant.mcUuid, grant.kitVersion, grant.orderId, grant.status, grant.claimedAt]
      );
    }
  }

  async #session(write) {
    const wallet = await this.#walletView();
    const memory = new MemoryMcPoints({ wallet, now: this.now, env: this.env });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`LOCK TABLE ${sqlIdent(this.schema)}.nexus_mc_links IN SHARE ROW EXCLUSIVE MODE`);
      await this.#hydrate(client, memory);
      const result = await write(memory);
      await this.#flush(client, memory);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  #mutate(fn) { return this.#session(fn); }
  #read(fn) { return this.#session(fn); }
}

module.exports = { schemaSql, PostgresMcPoints };
