'use strict';

const crypto = require('node:crypto');
const { sqlIdent } = require('../sentinel/nexus-economy-postgres-repository.cjs');
const { MemoryMcPoints, orderLineHash, stackLines, leaseMsForOrder, dayOrders, STAFF_REFUND_DAILY_CAP } = require('./mc-points-service.cjs');
const { catalogItem, catalogFingerprint, loadMcShopCatalog, MAX_DAILY_SPEND_NP, MAX_DAILY_ORDERS } = require('../shared/mc-shop-catalog.cjs');
const { memberIdentityHold, linkElevationHold, quarantineDenylist } = require('../sentinel/nexus-economy-identity-hold.cjs');
const { deterministicEconomicIdentityId } = require('../sentinel/nexus-economy-json-postgres-migration.cjs');
const { guildJoinedAtMs } = require('../shared/mc-starter-kit.cjs');

const MC_SCHEMA_VERSION = 5;
const schemaState = new WeakMap();

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
    '  playtime_ms BIGINT NOT NULL DEFAULT 0,',
    '  proof JSONB,',
    '  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    ');',
    `ALTER TABLE ${s}.nexus_mc_links ADD COLUMN IF NOT EXISTS playtime_ms BIGINT NOT NULL DEFAULT 0;`,
    `ALTER TABLE ${s}.nexus_mc_links ADD COLUMN IF NOT EXISTS proof JSONB;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS nexus_mc_links_one_verified_identity ON ${s}.nexus_mc_links (economic_identity_id) WHERE verified_at IS NOT NULL;`,
    `CREATE TABLE IF NOT EXISTS ${s}.nexus_mc_link_challenges (`,
    '  discord_user_id TEXT PRIMARY KEY,',
    '  mc_uuid TEXT NOT NULL,',
    '  mc_name TEXT NOT NULL,',
    '  code_hash TEXT NOT NULL,',
    '  economic_identity_id TEXT NOT NULL,',
    '  expires_at TIMESTAMPTZ NOT NULL,',
    '  attempts INT NOT NULL DEFAULT 0,',
    '  locked BOOLEAN NOT NULL DEFAULT FALSE,',
    '  used_at TIMESTAMPTZ',
    ');',
    `ALTER TABLE ${s}.nexus_mc_link_challenges ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;`,
    `ALTER TABLE ${s}.nexus_mc_link_challenges ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE;`,
    `ALTER TABLE ${s}.nexus_mc_link_challenges ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;`,
    `CREATE TABLE IF NOT EXISTS ${s}.nexus_mc_link_requests (`,
    '  id BIGSERIAL PRIMARY KEY,',
    '  mc_uuid TEXT NOT NULL,',
    '  discord_user_id TEXT NOT NULL,',
    '  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    ');',
    `CREATE TABLE IF NOT EXISTS ${s}.nexus_mc_quotes (`,
    '  nonce TEXT PRIMARY KEY,',
    '  discord_user_id TEXT NOT NULL,',
    '  economic_identity_id TEXT NOT NULL,',
    '  mc_uuid TEXT NOT NULL,',
    '  sku TEXT NOT NULL,',
    '  bundles INT NOT NULL,',
    '  qty INT NOT NULL,',
    '  price INT NOT NULL,',
    '  item_id TEXT NOT NULL,',
    '  catalog_version TEXT NOT NULL,',
    '  catalog_hash TEXT NOT NULL,',
    '  signature TEXT NOT NULL DEFAULT \'\',',
    '  expires_at TIMESTAMPTZ NOT NULL,',
    '  consumed_at TIMESTAMPTZ',
    ');',
    `CREATE TABLE IF NOT EXISTS ${s}.nexus_mc_orders (`,
    '  order_id TEXT PRIMARY KEY,',
    '  nonce TEXT UNIQUE,',
    '  order_data JSONB NOT NULL,',
    '  status TEXT NOT NULL,',
    '  price INT NOT NULL,',
    '  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    ');',
    `CREATE TABLE IF NOT EXISTS ${s}.nexus_mc_outbox (`,
    '  outbox_id TEXT PRIMARY KEY,',
    '  order_id TEXT NOT NULL UNIQUE,',
    '  payload JSONB NOT NULL,',
    '  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    ');',
    `CREATE TABLE IF NOT EXISTS ${s}.nexus_mc_refund_audit (`,
    '  order_id TEXT PRIMARY KEY,',
    '  actor TEXT NOT NULL,',
    '  reason TEXT NOT NULL,',
    '  amount INT NOT NULL,',
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
    ');',
    `CREATE TABLE IF NOT EXISTS ${s}.nexus_mc_action_audit (`,
    '  audit_id TEXT PRIMARY KEY,',
    '  action TEXT NOT NULL,',
    '  actor TEXT NOT NULL,',
    '  reason TEXT NOT NULL,',
    '  result TEXT NOT NULL,',
    '  subject TEXT NOT NULL,',
    '  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    ');',
    `CREATE TABLE IF NOT EXISTS ${s}.nexus_mc_schema_version (`,
    '  component TEXT PRIMARY KEY,',
    '  version INT NOT NULL,',
    '  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    ');',
    `ALTER TABLE ${s}.nexus_mc_quotes ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'minecraft';`,
    `ALTER TABLE ${s}.nexus_mc_orders ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'minecraft';`,
    `ALTER TABLE ${s}.nexus_mc_outbox ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'minecraft';`,
    `ALTER TABLE ${s}.nexus_mc_refund_audit ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'minecraft';`,
    `ALTER TABLE ${s}.nexus_mc_refund_audit ADD COLUMN IF NOT EXISTS retain_until TIMESTAMPTZ;`,
    `ALTER TABLE ${s}.nexus_mc_grants ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'minecraft';`,
    `ALTER TABLE ${s}.nexus_mc_grants ADD COLUMN IF NOT EXISTS eos_id TEXT;`,
    `ALTER TABLE ${s}.nexus_mc_grants ADD COLUMN IF NOT EXISTS kit_anchor BOOLEAN NOT NULL DEFAULT FALSE;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS nexus_mc_grants_one_starter_per_eos ON ${s}.nexus_mc_grants (kind, eos_id) WHERE eos_id IS NOT NULL;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS nexus_mc_grants_one_starter_per_identity ON ${s}.nexus_mc_grants (kind, economic_identity_id) WHERE kit_anchor;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS nexus_mc_grants_kind_identity_without_eos ON ${s}.nexus_mc_grants (kind, economic_identity_id) WHERE eos_id IS NULL;`,
    `ALTER TABLE ${s}.nexus_mc_grants DROP CONSTRAINT IF EXISTS nexus_mc_grants_kind_economic_identity_id_key;`,
    `DROP INDEX IF EXISTS ${s}.nexus_mc_grants_kind_eos;`,
    `CREATE INDEX IF NOT EXISTS nexus_mc_orders_provider_status_idx ON ${s}.nexus_mc_orders (provider, status, created_at);`
  ].join('\n');
}

function accrualColumnSql(schema = 'public') {
  const s = sqlIdent(schema);
  return [
    `ALTER TABLE ${s}.nexus_economy_accrual_state ADD COLUMN IF NOT EXISTS mc_counted_day TEXT;`,
    `ALTER TABLE ${s}.nexus_economy_accrual_state ADD COLUMN IF NOT EXISTS mc_counted_ms BIGINT NOT NULL DEFAULT 0;`,
    `ALTER TABLE ${s}.nexus_economy_accrual_state ADD COLUMN IF NOT EXISTS mc_lifetime_ms BIGINT NOT NULL DEFAULT 0;`,
    `ALTER TABLE ${s}.nexus_economy_accrual_state ADD COLUMN IF NOT EXISTS mc_online BOOLEAN NOT NULL DEFAULT FALSE;`,
    `ALTER TABLE ${s}.nexus_economy_accrual_state ADD COLUMN IF NOT EXISTS last_mc_online_at TIMESTAMPTZ;`
  ].join('\n');
}

async function ensureMinecraftSchema({ pool, schema = 'public', mark } = {}) {
  if (!pool || typeof pool.query !== 'function') return { ok: false, reason: 'mc-schema-unavailable' };
  let state = schemaState.get(pool);
  if (!state) {
    state = { ready: false, failed: false, inflight: null };
    schemaState.set(pool, state);
  }
  if (state.ready) {
    if (mark) mark.mcColumns = true;
    return { ok: true };
  }
  if (state.failed) return { ok: false, reason: 'mc-schema-unavailable' };
  if (state.inflight) return state.inflight;
  state.inflight = (async () => {
    try {
      const s = sqlIdent(schema);
      await pool.query(
        `CREATE TABLE IF NOT EXISTS ${s}.nexus_mc_schema_version (component TEXT PRIMARY KEY, version INT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
      );
      const current = await pool.query(`SELECT version FROM ${s}.nexus_mc_schema_version WHERE component = 'minecraft'`);
      if (Number(current.rows?.[0]?.version || 0) < MC_SCHEMA_VERSION) {
        await pool.query(schemaSql(schema));
        await pool.query(accrualColumnSql(schema));
        await pool.query(
          `INSERT INTO ${s}.nexus_mc_schema_version (component, version) VALUES ('minecraft', $1) ON CONFLICT (component) DO UPDATE SET version = EXCLUDED.version, applied_at = NOW()`,
          [MC_SCHEMA_VERSION]
        );
      }
      state.ready = true;
      if (mark) mark.mcColumns = true;
      return { ok: true };
    } catch (error) {
      state.failed = true;
      console.warn(`[Nexus Economy] mc_schema_unavailable ${String(error?.message || error).slice(0, 240)}`);
      return { ok: false, reason: 'mc-schema-unavailable' };
    } finally {
      state.inflight = null;
    }
  })();
  return state.inflight;
}

class PostgresMcPoints {
  constructor({ pool, schema = 'public', wallet, now = () => Date.now(), env = process.env, fetchImpl } = {}) {
    if (!pool) throw new Error('Postgres pool is required.');
    if (!wallet) throw new Error('Wallet is required.');
    this.pool = pool;
    this.schema = schema;
    this.wallet = wallet;
    this.now = now;
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.catalog = loadMcShopCatalog(env);
  }

  async ensureSchema() {
    const ready = await ensureMinecraftSchema({ pool: this.pool, schema: this.schema, mark: this });
    if (!ready.ok) return ready;
    return { ok: true };
  }

  async #ready() {
    const flags = this.flags();
    if (!flags.pointsEnabled && !flags.playtimeEnabled && !flags.shopEnabled && !flags.shopDeliveryEnabled && !flags.starterKitEnabled) {
      return { ok: false, reason: 'mc-points-disabled' };
    }
    return ensureMinecraftSchema({ pool: this.pool, schema: this.schema, mark: this });
  }

  flags() {
    return new MemoryMcPoints({ wallet: this.wallet, env: this.env, now: this.now }).flags();
  }

  async challenge(input) {
    if (!this.flags().pointsEnabled) return { ok: false, reason: 'mc-points-disabled' };
    const ready = await this.#ready();
    if (!ready.ok) return ready;
    return this.#touch((memory) => memory.challenge(input), new Set(['links', 'challenges', 'requests']));
  }
  async confirm(input) {
    if (!this.flags().pointsEnabled) return { ok: false, reason: 'mc-points-disabled' };
    const ready = await this.#ready();
    if (!ready.ok) return ready;
    return this.#confirm(input);
  }
  async unlink(input) {
    if (!this.flags().pointsEnabled) return { ok: false, reason: 'mc-points-disabled' };
    const ready = await this.#ready();
    if (!ready.ok) return ready;
    return this.#touch((memory) => memory.unlink(input), new Set(['links']));
  }
  async status(input) {
    const ready = await this.#ready();
    if (!ready.ok) return ready;
    return this.#touch((memory) => memory.status(input), new Set(['links']));
  }
  async quote(input) {
    if (!this.flags().shopEnabled) return { ok: false, reason: 'mc-shop-disabled' };
    const ready = await this.#ready();
    if (!ready.ok) return ready;
    return this.#quote(input);
  }
  async buy(input) {
    if (!this.flags().shopEnabled) return { ok: false, reason: 'mc-shop-disabled' };
    const ready = await this.#ready();
    if (!ready.ok) return ready;
    return this.#buy(input);
  }
  async claimStarterKit(input) {
    if (!this.flags().starterKitEnabled) return { ok: false, reason: 'mc-starter-kit-disabled' };
    const ready = await this.#ready();
    if (!ready.ok) return ready;
    return this.#claimKit(input);
  }
  async staffResend(input) {
    const ready = await this.#ready();
    if (!ready.ok) return ready;
    return this.#staffMutate((memory) => memory.staffResend(input), input?.orderId, 'DELIVERY_FAILED');
  }
  async staffResolve(input) {
    const ready = await this.#ready();
    if (!ready.ok) return ready;
    return this.#staffMutate((memory) => memory.staffResolve(input), input?.orderId);
  }
  async listGrants() {
    const ready = await this.#ready();
    if (!ready.ok) return [];
    return this.#readGrants();
  }
  async pendingOrders() {
    const ready = await this.#ready();
    if (!ready.ok) return [];
    return this.#pending();
  }
  async claimNext(input) {
    if (!this.flags().shopDeliveryEnabled) return null;
    const ready = await this.#ready();
    if (!ready.ok) return null;
    return this.#claimNext(input);
  }
  async markDelivery(input) {
    if (!this.flags().shopDeliveryEnabled) return { ok: false, reason: 'mc-shop-delivery-disabled' };
    const ready = await this.#ready();
    if (!ready.ok) return ready;
    return this.#mark(input);
  }
  async refund(input) {
    const ready = await this.#ready();
    if (!ready.ok) return ready;
    return this.#refund(input);
  }
  async refundPreview(input) {
    const ready = await this.#ready();
    if (!ready.ok) return ready;
    return this.#refund(input, { preview: true });
  }
  async sweepRefunds(input) {
    const ready = await this.#ready();
    if (!ready.ok) return [];
    return this.#sweep(input);
  }
  linkByUuid(mcUuid) { return this.#touch((memory) => memory.linkByUuid(mcUuid), new Set(['links'])); }
  async sweepExpiredLeases() {
    if (!this.flags().shopDeliveryEnabled) return [];
    const ready = await this.#ready();
    if (!ready.ok) return [];
    return this.#expireLeases();
  }

  async #walletView(client = null) {
    const wallet = this.wallet;
    const pool = this.pool;
    const schema = sqlIdent(this.schema);
    const rawSchema = this.schema;
    const env = this.env;
    const now = this.now;
    return {
      async resolve(discordUserId) {
        const result = await pool.query(
          `SELECT i.economic_identity_id, i.status, i.hold_reason, d.verified_at FROM ${schema}.nexus_economic_identities i ` +
          `JOIN ${schema}.nexus_economic_identity_links d ON d.economic_identity_id = i.economic_identity_id ` +
          `WHERE d.provider = 'discord' AND d.external_id = $1 LIMIT 1`,
          [String(discordUserId || '').trim()]
        );
        const row = result.rows?.[0];
        if (!row) return null;
        return {
          economicIdentityId: row.economic_identity_id,
          status: row.status,
          holdReason: String(row.hold_reason || '').trim(),
          verifiedAt: row.verified_at
        };
      },
      async ensureMinecraftMember(discordUserId, options = {}) {
        const run = (active) => ensureMinecraftMemberIdentity(active, rawSchema, env, discordUserId, { ...options, now: now() });
        if (client) return run(client);
        const own = await pool.connect();
        try {
          await own.query('BEGIN');
          const result = await run(own);
          if (result.ok || result.commitStamp) await own.query('COMMIT');
          else await own.query('ROLLBACK');
          return result;
        } catch (error) {
          try { await own.query('ROLLBACK'); } catch {}
          throw error;
        } finally {
          own.release();
        }
      },
      balance(discordUserId) { return wallet.balance(discordUserId, 'NEXUS_POINTS'); },
      spend(input) { return wallet.spend({ ...input, currency: 'NEXUS_POINTS' }); },
      credit(input) { return wallet.credit({ ...input, currency: 'NEXUS_POINTS' }); },
      async lifetimeMs(_economicIdentityId, mcUuid) {
        const result = await pool.query(`SELECT playtime_ms FROM ${schema}.nexus_mc_links WHERE mc_uuid = $1`, [mcUuid]);
        return Number(result.rows?.[0]?.playtime_ms || 0);
      },
      async quarantined(economicIdentityId) {
        return quarantineDenylist(env).has(String(economicIdentityId || ''));
      }
    };
  }

  async #load(client, memory, parts = null) {
    const s = sqlIdent(this.schema);
    const want = (name) => !parts || parts.has(name);
    if (want('links')) {
      const links = await client.query(`SELECT mc_uuid, economic_identity_id, discord_user_id, verified_at, unlinked_at, cooldown_until, playtime_ms, proof FROM ${s}.nexus_mc_links`);
      memory.links = new Map(links.rows.map((row) => [row.mc_uuid, {
        mcUuid: row.mc_uuid,
        economicIdentityId: row.economic_identity_id,
        discordUserId: row.discord_user_id,
        verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : null,
        unlinkedAt: row.unlinked_at ? new Date(row.unlinked_at).toISOString() : null,
        cooldownUntil: row.cooldown_until ? new Date(row.cooldown_until).toISOString() : null,
        playtimeMs: Number(row.playtime_ms || 0),
        proof: row.proof || null
      }]));
    }
    if (want('challenges')) {
      const challenges = await client.query(`SELECT discord_user_id, mc_uuid, mc_name, code_hash, economic_identity_id, expires_at, attempts, locked, used_at FROM ${s}.nexus_mc_link_challenges`);
      memory.challenges = new Map(challenges.rows.map((row) => [row.discord_user_id, {
        discordUserId: row.discord_user_id,
        mcUuid: row.mc_uuid,
        mcName: row.mc_name,
        codeHash: row.code_hash,
        economicIdentityId: row.economic_identity_id,
        expiresAt: Date.parse(row.expires_at),
        attempts: Number(row.attempts || 0),
        locked: row.locked === true,
        used: Boolean(row.used_at)
      }]));
    }
    if (want('requests')) {
      const requests = await client.query(`SELECT mc_uuid, discord_user_id, created_at FROM ${s}.nexus_mc_link_requests WHERE created_at > NOW() - INTERVAL '1 hour'`);
      memory.linkRequests = requests.rows.map((row) => ({ mcUuid: row.mc_uuid, discordUserId: row.discord_user_id, at: Date.parse(row.created_at) }));
    }
    if (want('orders')) {
      const orders = await client.query(`SELECT order_data FROM ${s}.nexus_mc_orders`);
      memory.orders = new Map(orders.rows.map((row) => [row.order_data.orderId, row.order_data]));
    }
    if (want('grants')) {
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
    }
    if (want('quotes')) {
      const quotes = await client.query(`SELECT * FROM ${s}.nexus_mc_quotes WHERE consumed_at IS NULL`);
      memory.quotes = new Map(quotes.rows.map((row) => [row.nonce, {
        nonce: row.nonce,
        discordUserId: row.discord_user_id,
        economicIdentityId: row.economic_identity_id,
        mcUuid: row.mc_uuid,
        sku: row.sku,
        itemId: row.item_id,
        bundles: Number(row.bundles),
        qty: Number(row.qty),
        price: Number(row.price),
        catalogVersion: row.catalog_version,
        catalogHash: row.catalog_hash,
        signature: row.signature,
        expiresAt: Date.parse(row.expires_at),
        consumed: Boolean(row.consumed_at)
      }]));
    }
    if (want('audits')) {
      const audits = await client.query(`SELECT order_id, actor, reason, amount, created_at FROM ${s}.nexus_mc_refund_audit`);
      memory.audits = audits.rows.map((row) => ({
        orderId: row.order_id,
        actor: row.actor,
        reason: row.reason,
        amount: Number(row.amount),
        createdAt: new Date(row.created_at).toISOString()
      }));
    }
  }

  async #saveLink(client, link) {
    const s = sqlIdent(this.schema);
    const saved = await client.query(
      `INSERT INTO ${s}.nexus_mc_links (mc_uuid, economic_identity_id, discord_user_id, verified_at, unlinked_at, cooldown_until, playtime_ms, proof) ` +
      `VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ` +
      `ON CONFLICT (mc_uuid) DO UPDATE SET economic_identity_id = EXCLUDED.economic_identity_id, discord_user_id = EXCLUDED.discord_user_id, ` +
      `verified_at = EXCLUDED.verified_at, unlinked_at = EXCLUDED.unlinked_at, cooldown_until = EXCLUDED.cooldown_until, playtime_ms = EXCLUDED.playtime_ms, proof = EXCLUDED.proof, updated_at = NOW() ` +
      `WHERE ${s}.nexus_mc_links.verified_at IS NULL OR ${s}.nexus_mc_links.economic_identity_id = EXCLUDED.economic_identity_id ` +
      `RETURNING mc_uuid`,
      [link.mcUuid, link.economicIdentityId, link.discordUserId, link.verifiedAt, link.unlinkedAt, link.cooldownUntil, Number(link.playtimeMs || 0), JSON.stringify(link.proof || null)]
    );
    if (!saved.rowCount) {
      const error = new Error('uuid-taken');
      error.code = 'uuid-taken';
      throw error;
    }
    await writeVerifiedMinecraftLink(client, this.schema, link);
  }

  async #confirm(input) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const memory = await this.#memory(client, new Set(['links', 'challenges', 'requests']));
      const result = await memory.confirm(input);
      if (!result.ok) {
        if (result.reason === 'uuid-taken') {
          await client.query('ROLLBACK');
          return result;
        }
        if (result.reason === 'code-mismatch' || result.reason === 'code-locked') {
          const pending = memory.challenges.get(String(input.discordUserId || '').trim());
          if (pending) await this.#saveChallenge(client, pending);
        }
        await this.#saveActionAudits(client, memory.actionAudits);
        await client.query('COMMIT');
        return result;
      }
      const link = memory.links.get(result.mcUuid);
      await this.#saveLink(client, link);
      await client.query(`DELETE FROM ${sqlIdent(this.schema)}.nexus_mc_link_challenges WHERE discord_user_id = $1`, [String(input.discordUserId || '').trim()]);
      await this.#saveActionAudits(client, memory.actionAudits);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      if (error.code === 'uuid-taken') return { ok: false, reason: 'uuid-taken' };
      throw error;
    } finally {
      client.release();
    }
  }

  async #saveChallenge(client, challenge) {
    const s = sqlIdent(this.schema);
    await client.query(
      `INSERT INTO ${s}.nexus_mc_link_challenges (discord_user_id, mc_uuid, mc_name, code_hash, economic_identity_id, expires_at, attempts, locked, used_at) ` +
      `VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ` +
      `ON CONFLICT (discord_user_id) DO UPDATE SET attempts = EXCLUDED.attempts, locked = EXCLUDED.locked, code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, mc_uuid = EXCLUDED.mc_uuid`,
      [challenge.discordUserId, challenge.mcUuid, challenge.mcName, challenge.codeHash, challenge.economicIdentityId, new Date(challenge.expiresAt).toISOString(), challenge.attempts || 0, challenge.locked === true, challenge.used ? new Date(this.now()).toISOString() : null]
    );
  }

  async #quote(input) {
    const memory = new MemoryMcPoints({ wallet: await this.#walletView(), now: this.now, env: this.env, catalog: this.catalog });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.#load(client, memory, new Set(['links']));
      const result = await memory.quote(input);
      if (result.ok) {
        const quote = result.quote;
        await client.query(
          `INSERT INTO ${sqlIdent(this.schema)}.nexus_mc_quotes (nonce, discord_user_id, economic_identity_id, mc_uuid, sku, bundles, qty, price, item_id, catalog_version, catalog_hash, signature, expires_at) ` +
          `VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [quote.nonce, quote.discordUserId, quote.economicIdentityId, quote.mcUuid, quote.sku, quote.bundles, quote.qty, quote.price, quote.itemId, quote.catalogVersion, quote.catalogHash, quote.signature || '', new Date(quote.expiresAt).toISOString()]
        );
      }
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async #buy(input) {
    const s = sqlIdent(this.schema);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const quoteRow = await client.query(`SELECT * FROM ${s}.nexus_mc_quotes WHERE nonce = $1 FOR UPDATE`, [String(input.nonce || '')]);
      const row = quoteRow.rows?.[0];
      if (!row || row.consumed_at || Date.parse(row.expires_at) <= this.now()) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'quote-expired' };
      }
      if (!this.flags().shopDryRun && !input.writesEnabled) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'economy-write-cutover-not-enabled' };
      }
      if (!this.flags().shopEnabled) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'mc-shop-disabled' };
      }
      const discord = String(input.discordUserId || '').trim();
      if (row.discord_user_id !== discord || row.sku !== input.sku || Number(row.bundles) !== Number(input.bundles)) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'quote-mismatch' };
      }
      const item = catalogItem(this.catalog, row.sku);
      const price = item ? item.price * Number(row.bundles) : null;
      if (!item || !Number.isSafeInteger(item.qty) || item.qty <= 0) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'invalid-qty' };
      }
      if (price !== Number(row.price) || item.itemId !== row.item_id || catalogFingerprint(this.catalog) !== row.catalog_hash) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'price-changed' };
      }
      const duplicate = await client.query(`SELECT order_data FROM ${s}.nexus_mc_orders WHERE nonce = $1`, [row.nonce]);
      if (duplicate.rows?.[0]) {
        await client.query('COMMIT');
        return { ok: true, duplicate: true, order: duplicate.rows[0].order_data };
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`nexus-economy:${row.economic_identity_id}:NEXUS_POINTS`]);
      const identityStatus = await client.query(
        `SELECT status, hold_reason FROM ${s}.nexus_economic_identities WHERE economic_identity_id = $1 FOR UPDATE`,
        [row.economic_identity_id]
      );
      const buyStatus = identityStatus.rows?.[0];
      const buyHold = memberIdentityHold({
        status: buyStatus?.status,
        holdReason: buyStatus?.hold_reason,
        missingRow: !buyStatus,
        economicIdentityId: row.economic_identity_id,
        env: this.env
      });
      if (buyHold) {
        await client.query('ROLLBACK');
        return buyHold;
      }
      const mcLink = await client.query(
        `SELECT 1 FROM ${s}.nexus_mc_links WHERE mc_uuid = $1 AND economic_identity_id = $2 AND verified_at IS NOT NULL AND unlinked_at IS NULL`,
        [row.mc_uuid, row.economic_identity_id]
      );
      if (!mcLink.rows?.[0]) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'verified-minecraft-link-required' };
      }
      if (this.flags().shopDryRun) {
        const wallet = await client.query(
          `SELECT balance FROM ${s}.nexus_economy_wallets WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS'`,
          [row.economic_identity_id]
        );
        const balance = Number(wallet.rows?.[0]?.balance || 0);
        await client.query('ROLLBACK');
        console.info(`[Nexus Economy] mc_shop_dry_run econ=${row.economic_identity_id} sku=${row.sku} price=${price}`);
        return {
          ok: true,
          dryRun: true,
          debited: false,
          balance,
          receipt: {
            sku: row.sku,
            bundles: Number(row.bundles),
            price,
            balance,
            balanceAfter: balance
          }
        };
      }
      const prior = await client.query(
        `SELECT order_data FROM ${s}.nexus_mc_orders WHERE status <> 'REFUNDED' AND order_data->>'economicIdentityId' = $1 AND order_data->>'source' = 'mc-shop'`,
        [row.economic_identity_id]
      );
      const today = dayOrders((prior.rows || []).map((entry) => entry.order_data || {}), row.economic_identity_id, this.now());
      if (today.length >= MAX_DAILY_ORDERS) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'daily-order-limit' };
      }
      const spentToday = today.reduce((sum, order) => sum + Number(order.price || 0), 0);
      if (spentToday + price > MAX_DAILY_SPEND_NP) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'daily-spend-limit' };
      }
      if (item.dailyLimit) {
        const skuCount = today.filter((order) => order.sku === row.sku).reduce((sum, order) => sum + Number(order.bundles || 0), 0);
        if (skuCount + Number(row.bundles) > item.dailyLimit) {
          await client.query('ROLLBACK');
          return { ok: false, reason: 'sku-daily-limit' };
        }
      }
      await client.query(
        `INSERT INTO ${s}.nexus_economy_wallets (economic_identity_id, currency, balance) VALUES ($1,'NEXUS_POINTS',0) ON CONFLICT DO NOTHING`,
        [row.economic_identity_id]
      );
      const wallet = await client.query(
        `SELECT balance FROM ${s}.nexus_economy_wallets WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS' FOR UPDATE`,
        [row.economic_identity_id]
      );
      const current = Number(wallet.rows?.[0]?.balance || 0);
      const ledgerKey = `mc-shop:${row.economic_identity_id}:${row.sku}:${row.nonce}`;
      const existingLedger = await client.query(
        `SELECT id FROM ${s}.nexus_economy_ledger WHERE idempotency_key = $1`,
        [ledgerKey]
      );
      const replay = Boolean(existingLedger.rowCount);
      if (!replay && current < price) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'insufficient-funds', balance: current };
      }
      const next = current - price;
      const lines = stackLines(item.itemId, item.qty * Number(row.bundles));
      const orderId = crypto.randomUUID();
      if (!replay) {
        const insertedLedger = await client.query(
          `INSERT INTO ${s}.nexus_economy_ledger (economic_identity_id, currency, amount, balance_after, entry_type, source, idempotency_key, metadata, created_at) ` +
          `VALUES ($1,'NEXUS_POINTS',$2,$3,'purchase','sink:mc-shop',$4,$5::jsonb,NOW()) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
          [row.economic_identity_id, -price, next, ledgerKey, JSON.stringify({ sku: row.sku, price, catalogVersion: row.catalog_version })]
        );
        if (!insertedLedger.rowCount) {
          await client.query('ROLLBACK');
          return { ok: false, reason: 'duplicate-ledger' };
        }
        await client.query(
          `UPDATE ${s}.nexus_economy_wallets SET balance = $2, updated_at = NOW() WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS'`,
          [row.economic_identity_id, next]
        );
      }
      const nowIso = new Date(this.now()).toISOString();
      const order = {
        orderId,
        discordUserId: discord,
        economicIdentityId: row.economic_identity_id,
        mcUuid: row.mc_uuid,
        sku: row.sku,
        bundles: Number(row.bundles),
        price,
        source: 'mc-shop',
        nonce: row.nonce,
        ledgerKey,
        status: 'PAID',
        lines,
        catalogVersion: row.catalog_version,
        catalogHash: orderLineHash(row.catalog_version, lines),
        createdAt: nowIso,
        updatedAt: nowIso,
        leaseToken: null,
        leaseOwner: null,
        leaseUntil: null,
        refunded: false,
        balance: replay ? current : next
      };
      await client.query(
        `INSERT INTO ${s}.nexus_mc_orders (order_id, nonce, order_data, status, price, created_at) VALUES ($1,$2,$3::jsonb,$4,$5,$6)`,
        [orderId, row.nonce, JSON.stringify(order), 'PAID', price, nowIso]
      );
      await client.query(
        `INSERT INTO ${s}.nexus_mc_outbox (outbox_id, order_id, payload) VALUES ($1,$2,$3::jsonb)`,
        [orderId, orderId, JSON.stringify({ orderId, sku: order.sku, price })]
      );
      await client.query(`UPDATE ${s}.nexus_mc_quotes SET consumed_at = NOW() WHERE nonce = $1`, [row.nonce]);
      await client.query('COMMIT');
      return { ok: true, order, balance: replay ? current : next, ledgerKey, replayed: replay };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      if (error.code === '23505') return { ok: false, reason: 'duplicate-order-id' };
      throw error;
    } finally {
      client.release();
    }
  }

  async #claimNext({ owner = 'nexus-craft' } = {}) {
    if (!this.flags().shopDeliveryEnabled) return null;
    await this.#expireLeases();
    const s = sqlIdent(this.schema);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const picked = await client.query(
        `SELECT order_id, order_data FROM ${s}.nexus_mc_orders ` +
        `WHERE provider = 'minecraft' AND status IN ('PAID','PLAYER_OFFLINE') AND (order_data->>'leaseUntil' IS NULL OR (order_data->>'leaseUntil')::timestamptz <= NOW()) ` +
        `ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1`
      );
      const row = picked.rows?.[0];
      if (!row) {
        await client.query('COMMIT');
        return null;
      }
      const order = row.order_data;
      order.status = 'DELIVERY_IN_PROGRESS';
      order.leaseToken = crypto.randomUUID();
      order.leaseOwner = String(owner || 'nexus-craft');
      order.leaseUntil = new Date(this.now() + leaseMsForOrder(order)).toISOString();
      order.updatedAt = order.leaseUntil;
      const updated = await client.query(
        `UPDATE ${s}.nexus_mc_orders SET status = 'DELIVERY_IN_PROGRESS', order_data = $2::jsonb ` +
        `WHERE order_id = $1 AND status = ANY($3::text[]) RETURNING order_id`,
        [order.orderId, JSON.stringify(order), ['PAID', 'PLAYER_OFFLINE']]
      );
      if (!updated.rowCount) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query('COMMIT');
      return order;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async #expireLeases() {
    const s = sqlIdent(this.schema);
    const result = await this.pool.query(
      `UPDATE ${s}.nexus_mc_orders SET status = 'SENT_UNCONFIRMED', ` +
      `order_data = jsonb_set(jsonb_set(order_data, '{status}', '"SENT_UNCONFIRMED"'), '{leaseToken}', 'null') ` +
      `WHERE provider = 'minecraft' AND status = 'DELIVERY_IN_PROGRESS' AND (order_data->>'leaseUntil')::timestamptz <= NOW() RETURNING order_id`
    );
    for (const row of result.rows || []) console.warn(`[Nexus Economy] mc_lease_expired order=${row.order_id} status=SENT_UNCONFIRMED`);
    return (result.rows || []).map((row) => row.order_id);
  }

  async #mark(input) {
    if (!this.flags().shopDeliveryEnabled) return { ok: false, reason: 'mc-shop-delivery-disabled' };
    const memory = new MemoryMcPoints({ wallet: await this.#walletView(), now: this.now, env: this.env });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT order_data FROM ${sqlIdent(this.schema)}.nexus_mc_orders WHERE order_id = $1 FOR UPDATE`,
        [String(input.orderId || '')]
      );
      const order = found.rows?.[0]?.order_data;
      if (!order) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'order-not-found' };
      }
      memory.orders.set(order.orderId, order);
      const result = memory.markDelivery(input);
      if (!result.ok) {
        await client.query('ROLLBACK');
        return result;
      }
      const saved = await client.query(
        `UPDATE ${sqlIdent(this.schema)}.nexus_mc_orders SET status = $2, order_data = $3::jsonb ` +
        `WHERE order_id = $1 AND status = $4 AND order_data->>'leaseToken' = $5 RETURNING order_id`,
        [order.orderId, result.order.status, JSON.stringify(result.order), input.expectedStatus, input.leaseToken]
      );
      if (!saved.rowCount) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'lease-lost' };
      }
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async #lockedOrder(client, orderId) {
    const s = sqlIdent(this.schema);
    const locked = await client.query(
      `SELECT order_data FROM ${s}.nexus_mc_orders WHERE order_id = $1 FOR UPDATE`,
      [String(orderId || '')]
    );
    return locked.rows?.[0]?.order_data || null;
  }

  async #withinStaffWindow(client, orderId) {
    const window = await client.query(
      `SELECT (created_at >= NOW() - INTERVAL '24 hours') AS within_window FROM ${sqlIdent(this.schema)}.nexus_mc_orders WHERE order_id = $1`,
      [String(orderId || '')]
    );
    return window.rows?.[0]?.within_window === true;
  }

  async #discordEconomicIdentity(client, discordUserId) {
    const found = await client.query(
      `SELECT economic_identity_id FROM ${sqlIdent(this.schema)}.nexus_economic_identity_links WHERE provider = 'discord' AND external_id = $1`,
      [String(discordUserId || '')]
    );
    return String(found.rows?.[0]?.economic_identity_id || '');
  }

  async #staffRefundsToday(client, actor) {
    const result = await client.query(
      `SELECT COUNT(*)::bigint AS n
       FROM ${sqlIdent(this.schema)}.nexus_mc_refund_audit
       WHERE actor = $1 AND provider = 'minecraft'
         AND (created_at AT TIME ZONE 'America/Chicago')::date = (NOW() AT TIME ZONE 'America/Chicago')::date`,
      [actor]
    );
    return Number(result.rows?.[0]?.n || 0);
  }

  async #lockedIdentityHold(client, identityId) {
    if (!identityId) {
      return memberIdentityHold({ missingRow: true, economicIdentityId: '', env: this.env });
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`nexus-economy:${identityId}:NEXUS_POINTS`]);
    const identityStatus = await client.query(
      `SELECT status, hold_reason FROM ${sqlIdent(this.schema)}.nexus_economic_identities WHERE economic_identity_id = $1 FOR UPDATE`,
      [identityId]
    );
    const refundStatus = identityStatus.rows?.[0];
    return memberIdentityHold({
      status: refundStatus?.status,
      holdReason: refundStatus?.hold_reason,
      missingRow: !refundStatus,
      economicIdentityId: identityId,
      env: this.env
    });
  }

  async #refund(input, options = {}) {
    const preview = options.preview === true || input?.preview === true;
    const client = await this.pool.connect();
    const s = sqlIdent(this.schema);
    try {
      await client.query('BEGIN');
      const before = await this.#lockedOrder(client, input.orderId);
      if (!before) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'order-not-found' };
      }
      if (before.status === 'REFUNDED' || before.refunded) {
        await client.query(preview ? 'ROLLBACK' : 'COMMIT');
        return { ok: true, duplicate: true, order: before, ...(preview ? { preview: true } : {}) };
      }
      if (before.status === 'DELIVERED') {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'final-status', order: before };
      }
      const actor = String(input.actor || '').trim();
      const auto = input.reason === 'auto-14d';
      const actorIdentity = !auto && actor ? await this.#discordEconomicIdentity(client, actor) : '';
      const self = Boolean(actor && (actor === before.discordUserId || (actorIdentity && actorIdentity === before.economicIdentityId)));
      if (!auto && self) {
        const selfHold = await this.#lockedIdentityHold(client, before.economicIdentityId);
        await client.query('ROLLBACK');
        if (selfHold) return { ...selfHold, order: before };
        return { ok: false, reason: 'staff-not-authorized', order: before };
      }
      const staff = !auto;
      if (staff) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`mc-shop-refund-actor:${actor}`]);
        const refundsToday = await this.#staffRefundsToday(client, actor);
        if (refundsToday >= STAFF_REFUND_DAILY_CAP) {
          await client.query('ROLLBACK');
          return { ok: false, reason: 'staff-refund-cap', order: before };
        }
        const refundHold = await this.#lockedIdentityHold(client, before.economicIdentityId);
        if (refundHold) {
          await client.query('ROLLBACK');
          return { ...refundHold, order: before };
        }
        if (!await this.#withinStaffWindow(client, before.orderId || input.orderId)) {
          await client.query('ROLLBACK');
          return { ok: false, reason: 'refund-window', order: before };
        }
      }
      const memory = await this.#memory(client, new Set(['orders', 'grants', 'audits']));
      const loaded = memory.orders.get(String(input.orderId || ''));
      const previous = loaded?.status || before.status;
      const result = await memory.refund({
        ...input,
        applyWallet: false,
        deferHold: true,
        preview,
        windowChecked: staff,
        capChecked: staff
      });
      if (preview) {
        await client.query('ROLLBACK');
        return result;
      }
      if (result.duplicate) {
        await client.query('COMMIT');
        return result;
      }
      let refundHold = null;
      if (!staff) {
        const identityId = before.economicIdentityId || result.order?.economicIdentityId;
        if (identityId) refundHold = await this.#lockedIdentityHold(client, identityId);
        if (refundHold && (self || auto)) {
          await client.query('ROLLBACK');
          return { ...refundHold, order: before };
        }
      }
      if (!result.ok) {
        await client.query('ROLLBACK');
        return result;
      }
      const auditReason = String(input.reason || '');
      const flipped = await client.query(
        `UPDATE ${s}.nexus_mc_orders SET status = 'REFUNDED', order_data = $2::jsonb WHERE order_id = $1 AND status = $3 AND status <> 'REFUNDED' AND status <> 'DELIVERED' RETURNING order_id`,
        [result.order.orderId, JSON.stringify(result.order), previous]
      );
      if (!flipped.rowCount) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'illegal-transition' };
      }
      if (Number(result.order.price) > 0) {
        const key = `mc-shop-refund:${result.order.orderId}`;
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`nexus-economy:${result.order.economicIdentityId}:NEXUS_POINTS`]);
        const wallet = await client.query(
          `SELECT balance FROM ${s}.nexus_economy_wallets WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS' FOR UPDATE`,
          [result.order.economicIdentityId]
        );
        const next = Number(wallet.rows?.[0]?.balance || 0) + Number(result.order.price);
        const ledger = await client.query(
          `INSERT INTO ${s}.nexus_economy_ledger (economic_identity_id, currency, amount, balance_after, entry_type, source, idempotency_key, metadata, created_at) ` +
          `VALUES ($1,'NEXUS_POINTS',$2,$3,'reversal','mc-shop',$4,$5::jsonb,NOW()) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
          [result.order.economicIdentityId, Number(result.order.price), next, key, JSON.stringify({ orderId: result.order.orderId, reason: auditReason, actor: input.actor, ...(input.force === true ? { force: true } : {}) })]
        );
        if (ledger.rowCount) {
          await client.query(
            `UPDATE ${s}.nexus_economy_wallets SET balance = $2, updated_at = NOW() WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS'`,
            [result.order.economicIdentityId, next]
          );
        }
      }
      await client.query(
        `INSERT INTO ${s}.nexus_mc_refund_audit (order_id, actor, reason, amount) VALUES ($1,$2,$3,$4) ON CONFLICT (order_id) DO NOTHING`,
        [result.order.orderId, String(input.actor || 'auto'), auditReason, Number(result.order.price || 0)]
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async #sweep(input = {}) {
    await this.#expireLeases();
    const ids = await this.pool.query(
      `SELECT order_id FROM ${sqlIdent(this.schema)}.nexus_mc_orders WHERE status IN ('PAID','PLAYER_OFFLINE')`
    );
    const results = [];
    for (const row of ids.rows || []) {
      results.push(await this.#refund({
        orderId: row.order_id,
        reason: 'auto-14d',
        actor: 'auto',
        writesEnabled: input.writesEnabled,
        now: input.now
      }));
    }
    return results.filter((result) => result.ok);
  }

  async #claimKit(input) {
    const client = await this.pool.connect();
    const s = sqlIdent(this.schema);
    try {
      await client.query('BEGIN');
      const memory = await this.#memory(client, new Set(['links', 'grants', 'orders']));
      const result = await memory.claimStarterKit(input);
      if (!result.ok || result.duplicate) {
        await this.#saveActionAudits(client, memory.actionAudits);
        await client.query('COMMIT');
        return result;
      }
      const order = result.order;
      await client.query(
        `INSERT INTO ${s}.nexus_mc_orders (order_id, nonce, order_data, status, price, created_at) VALUES ($1,$2,$3::jsonb,'PAID',$4,$5)`,
        [order.orderId, null, JSON.stringify(order), 0, order.createdAt]
      );
      await client.query(
        `INSERT INTO ${s}.nexus_mc_outbox (outbox_id, order_id, payload) VALUES ($1,$2,$3::jsonb)`,
        [order.orderId, order.orderId, JSON.stringify({ orderId: order.orderId, source: 'starter-kit' })]
      );
      const grant = result.grant;
      const inserted = await client.query(
        `INSERT INTO ${s}.nexus_mc_grants (grant_id, kind, economic_identity_id, mc_uuid, kit_version, order_id, status, claimed_at) ` +
        `VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING grant_id`,
        [`${grant.kind}:${grant.economicIdentityId}`, grant.kind, grant.economicIdentityId, grant.mcUuid, grant.kitVersion, grant.orderId, grant.status, grant.claimedAt]
      );
      await this.#saveActionAudits(client, memory.actionAudits);
      if (!inserted.rowCount) {
        await client.query('ROLLBACK');
        const existing = await this.pool.query(
          `SELECT order_id FROM ${s}.nexus_mc_grants WHERE kind = 'starter_kit' AND (economic_identity_id = $1 OR mc_uuid = $2) LIMIT 1`,
          [grant.economicIdentityId, grant.mcUuid]
        );
        const priorId = existing.rows?.[0]?.order_id;
        const prior = priorId ? await this.pool.query(`SELECT order_data FROM ${s}.nexus_mc_orders WHERE order_id = $1`, [priorId]) : null;
        return { ok: true, duplicate: true, order: prior?.rows?.[0]?.order_data || null, grant };
      }
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      if (error.code === '23505') return { ok: false, reason: 'duplicate-order-id' };
      throw error;
    } finally {
      client.release();
    }
  }

  async #saveActionAudits(client, rows) {
    const s = sqlIdent(this.schema);
    for (const row of rows || []) {
      await client.query(
        `INSERT INTO ${s}.nexus_mc_action_audit (audit_id, action, actor, reason, result, subject, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (audit_id) DO NOTHING`,
        [row.auditId, row.action, row.actor, row.reason, row.result, row.subject, row.createdAt]
      );
    }
  }

  async #staffMutate(fn, orderId, expectedStatus = '') {
    const client = await this.pool.connect();
    const s = sqlIdent(this.schema);
    try {
      await client.query('BEGIN');
      const memory = await this.#memory(client, new Set(['orders']));
      const result = await fn(memory);
      if (result.ok && result.order) {
        const params = [result.order.orderId, result.order.status, JSON.stringify(result.order)];
        const updated = expectedStatus
          ? await client.query(
            `UPDATE ${s}.nexus_mc_orders SET status = $2, order_data = $3::jsonb WHERE order_id = $1 AND status = $4 RETURNING order_id`,
            [...params, expectedStatus]
          )
          : await client.query(
            `UPDATE ${s}.nexus_mc_orders SET status = $2, order_data = $3::jsonb WHERE order_id = $1 AND status <> 'REFUNDED' AND status <> 'DELIVERED' RETURNING order_id`,
            params
          );
        if (!updated.rowCount) {
          await client.query('ROLLBACK');
          return { ok: false, reason: 'illegal-transition' };
        }
      }
      await this.#saveActionAudits(client, memory.actionAudits);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async #memory(client, parts) {
    const memory = new MemoryMcPoints({
      wallet: await this.#walletView(client),
      now: this.now,
      env: this.env,
      catalog: this.catalog,
      tenureOf: (discordUserId) => guildJoinedAtMs(discordUserId, this.env, this.fetchImpl),
      fetchImpl: this.fetchImpl
    });
    await this.#load(client, memory, parts);
    return memory;
  }

  async #touch(fn, parts) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const memory = await this.#memory(client, parts);
      const beforeLinks = new Map([...memory.links.entries()].map(([key, value]) => [key, JSON.stringify(value)]));
      const result = await fn(memory);
      for (const link of memory.links.values()) {
        if (beforeLinks.get(link.mcUuid) !== JSON.stringify(link)) await this.#saveLink(client, link);
      }
      for (const challenge of memory.challenges.values()) await this.#saveChallenge(client, challenge);
      for (const request of memory.linkRequests) {
        await client.query(
          `INSERT INTO ${sqlIdent(this.schema)}.nexus_mc_link_requests (mc_uuid, discord_user_id, created_at) ` +
          `SELECT $1,$2,$3 WHERE NOT EXISTS (SELECT 1 FROM ${sqlIdent(this.schema)}.nexus_mc_link_requests WHERE mc_uuid = $1 AND discord_user_id = $2 AND created_at = $3)`,
          [request.mcUuid, request.discordUserId, new Date(request.at).toISOString()]
        );
      }
      await this.#saveActionAudits(client, memory.actionAudits);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      if (error.code === 'uuid-taken') return { ok: false, reason: 'uuid-taken' };
      throw error;
    } finally {
      client.release();
    }
  }

  async #readGrants() {
    const result = await this.pool.query(`SELECT kind, economic_identity_id, mc_uuid, kit_version, order_id, status, claimed_at FROM ${sqlIdent(this.schema)}.nexus_mc_grants`);
    return result.rows.map((row) => ({
      kind: row.kind,
      economicIdentityId: row.economic_identity_id,
      mcUuid: row.mc_uuid,
      kitVersion: row.kit_version,
      orderId: row.order_id,
      status: row.status,
      claimedAt: new Date(row.claimed_at).toISOString()
    }));
  }

  async #pending() {
    const result = await this.pool.query(
      `SELECT order_data FROM ${sqlIdent(this.schema)}.nexus_mc_orders WHERE provider = 'minecraft' AND status IN ('PAID','PLAYER_OFFLINE','DELIVERY_IN_PROGRESS') ORDER BY created_at ASC`
    );
    return result.rows.map((row) => row.order_data);
  }
}

async function writeVerifiedMinecraftLink(client, schema, link) {
  const s = sqlIdent(schema);
  if (!link?.verifiedAt) {
    await client.query(
      `UPDATE ${s}.nexus_economic_identity_links SET verified_at = NULL WHERE provider = 'minecraft' AND external_id = $1 AND economic_identity_id = $2`,
      [link.mcUuid, link.economicIdentityId]
    );
    return { ok: true, unlinked: true };
  }
  const linked = await client.query(
    `INSERT INTO ${s}.nexus_economic_identity_links (provider, external_id, economic_identity_id, verified_at, source) ` +
    `VALUES ('minecraft', $1, $2, $3, 'mc-link') ON CONFLICT (provider, external_id) DO NOTHING`,
    [link.mcUuid, link.economicIdentityId, link.verifiedAt]
  );
  if (linked.rowCount) return { ok: true, inserted: true };
  const current = await client.query(
    `SELECT economic_identity_id, verified_at FROM ${s}.nexus_economic_identity_links WHERE provider = 'minecraft' AND external_id = $1`,
    [link.mcUuid]
  );
  const row = current.rows?.[0];
  if (row && row.economic_identity_id === link.economicIdentityId) {
    await client.query(
      `UPDATE ${s}.nexus_economic_identity_links SET verified_at = $3, source = 'mc-link' WHERE provider = 'minecraft' AND external_id = $1 AND economic_identity_id = $2`,
      [link.mcUuid, link.economicIdentityId, link.verifiedAt]
    );
    return { ok: true, relinked: true };
  }
  const error = new Error('uuid-taken');
  error.code = 'uuid-taken';
  throw error;
}

// A Minecraft link code opens Minecraft Points only.
// Reuse the discord link's economic id so an ARK member and a Minecraft member share one wallet.
// Never insert an EOS link or a Coin ledger row, and never write identity status or the Discord link's verified_at.
async function ensureMinecraftMemberIdentity(client, schema, env, discordUserId) {
  const s = sqlIdent(schema);
  const discord = String(discordUserId || '').trim();
  if (!/^\d{5,32}$/.test(discord)) return { ok: false, reason: 'discord-user-required' };
  await client.query(`LOCK TABLE ${s}.nexus_economic_identity_links IN SHARE ROW EXCLUSIVE MODE`);
  const existing = await client.query(
    `SELECT economic_identity_id, verified_at, source FROM ${s}.nexus_economic_identity_links WHERE provider = 'discord' AND external_id = $1 FOR UPDATE`,
    [discord]
  );
  const economicIdentityId = existing.rows[0]?.economic_identity_id || deterministicEconomicIdentityId(discord);
  await client.query(
    `INSERT INTO ${s}.nexus_economic_identities (economic_identity_id, status) VALUES ($1, 'restricted') ON CONFLICT DO NOTHING RETURNING economic_identity_id`,
    [economicIdentityId]
  );
  const identity = await client.query(
    `SELECT status, hold_reason, held_by FROM ${s}.nexus_economic_identities WHERE economic_identity_id = $1 FOR UPDATE`,
    [economicIdentityId]
  );
  const priorStatus = String(identity.rows[0]?.status || '');
  let holdReason = identity.rows[0]?.hold_reason || '';
  let stamped = false;
  if (quarantineDenylist(env).has(economicIdentityId) && !String(holdReason || '').trim()) {
    await client.query(
      `UPDATE ${s}.nexus_economic_identities SET hold_reason = 'quarantine', updated_at = NOW() WHERE economic_identity_id = $1 AND (hold_reason IS NULL OR btrim(hold_reason) = '')`,
      [economicIdentityId]
    );
    holdReason = 'quarantine';
    stamped = true;
  }
  const held = linkElevationHold({
    status: priorStatus,
    holdReason,
    economicIdentityId,
    missingRow: !identity.rows[0],
    env
  });
  if (held) {
    return {
      ...held,
      commitStamp: stamped,
      status: priorStatus || null,
      holdReason: holdReason || null,
      economicIdentityId
    };
  }
  await client.query(
    `INSERT INTO ${s}.nexus_economic_identity_links (provider, external_id, economic_identity_id, verified_at, source) ` +
    `VALUES ('discord', $1, $2, NULL, 'mc-link') ` +
    `ON CONFLICT (provider, external_id) DO NOTHING`,
    [discord, economicIdentityId]
  );
  await client.query(
    `INSERT INTO ${s}.nexus_economy_wallets (economic_identity_id, currency, balance) VALUES ($1, 'NEXUS_POINTS', 0) ON CONFLICT (economic_identity_id, currency) DO NOTHING`,
    [economicIdentityId]
  );
  const after = await client.query(
    `SELECT i.status, i.hold_reason, d.verified_at FROM ${s}.nexus_economic_identities i ` +
    `JOIN ${s}.nexus_economic_identity_links d ON d.economic_identity_id = i.economic_identity_id ` +
    `WHERE d.provider = 'discord' AND d.external_id = $1`,
    [discord]
  );
  const row = after.rows?.[0];
  const status = String(row?.status || priorStatus || '');
  return {
    ok: true,
    identity: {
      economicIdentityId,
      status,
      holdReason: String(row?.hold_reason || '').trim(),
      verifiedAt: status === 'verified' ? (row?.verified_at || null) : (row?.verified_at || null)
    }
  };
}

module.exports = {
  schemaSql,
  accrualColumnSql,
  MC_SCHEMA_VERSION,
  ensureMinecraftSchema,
  writeVerifiedMinecraftLink,
  ensureMinecraftMemberIdentity,
  PostgresMcPoints
};
