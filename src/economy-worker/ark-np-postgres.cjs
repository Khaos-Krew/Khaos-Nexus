'use strict';

const crypto = require('node:crypto');
const { sqlIdent } = require('../sentinel/nexus-economy-postgres-repository.cjs');
const { ensureMinecraftSchema } = require('./mc-points-postgres.cjs');
const { arkNpFlags } = require('../shared/ark-np-flags.cjs');
const { loadArkNpCatalog, catalogItem, catalogFingerprint, assertBlueprint, KIT_KIND } = require('../shared/ark-np-catalog.cjs');
const { quarantineDenylist } = require('../sentinel/nexus-economy-wallet-core.cjs');
const { memberIdentityHold } = require('../sentinel/nexus-economy-identity-hold.cjs');
const { assertMemberAccount } = require('../shared/economy-system-accounts.cjs');
const { rollCache } = require('../sentinel/ark-dino-cache-engine.cjs');
const { saddleFor } = require('../sentinel/ark-cache-receipts.cjs');
const { blueprintRef } = require('../sentinel/rewards-ascended-delivery.cjs');
const { discordAccountCreatedMs, guildJoinedAtMs } = require('../shared/mc-starter-kit.cjs');
const { authorizeStaffRefundActor } = require('./ark-staff-auth.cjs');
const {
  STAFF_REFUND_DAILY_CAP,
  STAFF_REFUND_ALERT_AT,
  AUDIT_RETAIN_MS,
  SPEND_ALERT_24H_POINTS,
  PREPARE_LEASE_MS,
  DELIVERY_LEASE_MS,
  QUOTE_TTL_MS,
  offlineBackoffMs,
  ledgerKey,
  refundKey,
  refundDecision
} = require('../shared/ark-np-orders.cjs');

class PostgresArkShop {
  constructor({ pool, schema = 'public', now = () => Date.now(), env = process.env, catalog = null, tenureOf = null, fetchImpl = null } = {}) {
    if (!pool) throw new Error('Postgres pool is required.');
    this.pool = pool;
    this.schema = schema;
    this.now = now;
    this.env = env;
    this.catalog = catalog || loadArkNpCatalog();
    this.tenureOf = tenureOf;
    this.fetchImpl = fetchImpl;
  }

  flags() {
    return arkNpFlags(this.env);
  }

  async ensureSchema() {
    return ensureMinecraftSchema({ pool: this.pool, schema: this.schema });
  }

  async quote(input) {
    if (!this.flags().shopEnabled) return { ok: false, reason: 'ark-shop-disabled' };
    const ready = await this.ensureSchema();
    if (!ready.ok) return ready;
    const sku = String(input?.sku || '').trim();
    const item = catalogItem(this.catalog, sku);
    if (!item) return { ok: false, reason: 'unknown-item' };
    const discord = String(input?.discordUserId || '').trim();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const identity = await this.#identity(client, discord);
      if (!identity.ok) {
        await client.query('ROLLBACK');
        return identity;
      }
      const balance = await this.#balance(client, identity.econId);
      const nonce = crypto.randomUUID();
      const expiresAt = new Date(this.now() + QUOTE_TTL_MS).toISOString();
      const fingerprint = catalogFingerprint(this.catalog);
      await client.query(
        `INSERT INTO ${sqlIdent(this.schema)}.nexus_mc_quotes
         (nonce, discord_user_id, economic_identity_id, mc_uuid, sku, bundles, qty, price, item_id, catalog_version, catalog_hash, signature, expires_at, provider)
         VALUES ($1,$2,$3,$4,$5,1,1,$6,$7,$8,$9,'',$10,'ark')`,
        [nonce, discord, identity.econId, identity.eosIds[0], sku, item.price, sku, this.catalog.version, fingerprint, expiresAt]
      );
      await client.query('COMMIT');
      return {
        ok: true,
        quote: {
          nonce,
          discordUserId: discord,
          economicIdentityId: identity.econId,
          sku,
          name: item.name,
          price: item.price,
          balance,
          balanceAfter: balance - item.price,
          catalogVersion: this.catalog.version,
          catalogHash: fingerprint,
          expiresAt
        }
      };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async buy(input) {
    if (!this.flags().shopEnabled) return { ok: false, reason: 'ark-shop-disabled' };
    const ready = await this.ensureSchema();
    if (!ready.ok) return ready;
    const s = sqlIdent(this.schema);
    const nonce = String(input?.nonce || '').trim();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const peek = await client.query(
        `SELECT economic_identity_id FROM ${s}.nexus_mc_quotes WHERE nonce = $1 AND provider = 'ark'`,
        [nonce]
      );
      const peekedId = peek.rows?.[0]?.economic_identity_id;
      if (!peekedId) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'quote-expired' };
      }
      // LEDGER R2-1: every buy check runs after the identity lock, in this transaction.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`nexus-economy:${peekedId}:NEXUS_POINTS`]);
      const quoteRow = await client.query(
        `SELECT * FROM ${s}.nexus_mc_quotes WHERE nonce = $1 AND provider = 'ark' FOR UPDATE`,
        [nonce]
      );
      const row = quoteRow.rows?.[0];
      if (!row || row.consumed_at || Date.parse(row.expires_at) <= this.now()) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'quote-expired' };
      }
      const discord = String(input?.discordUserId || '').trim();
      if (row.discord_user_id !== discord || row.sku !== input?.sku) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'quote-mismatch' };
      }
      const identity = await this.#identity(client, discord);
      if (!identity.ok) {
        await client.query('ROLLBACK');
        return identity;
      }
      if (identity.econId !== row.economic_identity_id || quarantineDenylist(this.env).has(identity.econId)) {
        await client.query('ROLLBACK');
        return { ok: false, reason: identity.econId !== row.economic_identity_id ? 'quote-mismatch' : 'quarantined' };
      }
      const marker = await this.#lockedMarker(client, identity.econId);
      if (!marker.ok) {
        await client.query('ROLLBACK');
        return marker;
      }
      const item = catalogItem(this.catalog, row.sku);
      if (!item || item.price !== Number(row.price) || catalogFingerprint(this.catalog) !== row.catalog_hash) {
        await client.query('ROLLBACK');
        return { ok: false, reason: item ? 'price-changed' : 'unknown-item' };
      }
      const duplicate = await client.query(`SELECT order_data FROM ${s}.nexus_mc_orders WHERE nonce = $1 AND provider = 'ark'`, [row.nonce]);
      if (duplicate.rows?.[0]) {
        await client.query('COMMIT');
        return { ok: true, duplicate: true, order: duplicate.rows[0].order_data };
      }
      let roll;
      try {
        roll = this.#roll(row.sku);
      } catch (error) {
        await client.query('ROLLBACK');
        console.warn(`[Nexus Economy] ark_catalog_rejected sku=${row.sku} ${String(error?.message || error).slice(0, 160)}`);
        return { ok: false, reason: 'unknown-item' };
      }
      const wallet = await client.query(
        `SELECT balance FROM ${s}.nexus_economy_wallets WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS' FOR UPDATE`,
        [identity.econId]
      );
      const balance = Number(wallet.rows?.[0]?.balance || 0);
      if (!this.flags().npShopWritesEnabled) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'economy-np-shop-writes-not-enabled', balance };
      }
      if (this.flags().dryRun) {
        await client.query('ROLLBACK');
        console.info(`[Nexus Economy] ark_shop_dry_run econ=${identity.econId} sku=${row.sku} price=${item.price}`);
        return { ok: false, reason: 'ark-shop-dry-run', balance, price: item.price };
      }
      if (balance < item.price) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'insufficient-funds', balance };
      }
      const next = balance - item.price;
      const key = ledgerKey(identity.econId, row.sku, row.nonce);
      const inserted = await client.query(
        `INSERT INTO ${s}.nexus_economy_ledger
         (economic_identity_id, currency, amount, balance_after, entry_type, source, idempotency_key, metadata, created_at)
         VALUES ($1,'NEXUS_POINTS',$2,$3,'purchase','ark-shop',$4,$5::jsonb,NOW())
         ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
        [identity.econId, -item.price, next, key, JSON.stringify({ sku: row.sku, price: item.price, catalogVersion: row.catalog_version, provider: 'ark' })]
      );
      if (!inserted.rowCount) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'duplicate-order' };
      }
      await client.query(
        `UPDATE ${s}.nexus_economy_wallets SET balance = $2, updated_at = NOW()
         WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS'`,
        [identity.econId, next]
      );
      const spent = await client.query(
        `SELECT COALESCE(SUM(price), 0)::bigint AS spent FROM ${s}.nexus_mc_orders
         WHERE provider = 'ark' AND status <> 'REFUNDED' AND order_data->>'economicIdentityId' = $1
           AND order_data->>'source' = 'ark-shop' AND created_at >= NOW() - INTERVAL '24 hours'`,
        [identity.econId]
      );
      if (Number(spent.rows?.[0]?.spent || 0) + item.price > SPEND_ALERT_24H_POINTS) {
        console.warn(`[Nexus Economy] ark_spend_alert econ=${identity.econId} window=24h`);
      }
      const nowIso = new Date(this.now()).toISOString();
      const order = this.#order({
        discord, econId: identity.econId, eosIds: identity.eosIds, sku: row.sku, price: item.price,
        nonce: row.nonce, key, nowIso, source: 'ark-shop', roll, balance: next
      });
      await client.query(
        `INSERT INTO ${s}.nexus_mc_orders (order_id, nonce, order_data, status, price, created_at, provider)
         VALUES ($1,$2,$3::jsonb,'PAID',$4,$5,'ark')`,
        [order.orderId, row.nonce, JSON.stringify(order), item.price, nowIso]
      );
      await client.query(
        `INSERT INTO ${s}.nexus_mc_outbox (outbox_id, order_id, payload, provider) VALUES ($1,$2,$3::jsonb,'ark')`,
        [order.orderId, order.orderId, JSON.stringify({ orderId: order.orderId, sku: order.sku, price: item.price, provider: 'ark' })]
      );
      await client.query(`UPDATE ${s}.nexus_mc_quotes SET consumed_at = NOW() WHERE nonce = $1`, [row.nonce]);
      await client.query('COMMIT');
      return { ok: true, order, balance: next, ledgerKey: key };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      if (error.code === '23505') return { ok: false, reason: 'duplicate-order' };
      throw error;
    } finally {
      client.release();
    }
  }

  async claimStarterKit(input) {
    if (!this.flags().starterKitEnabled) return { ok: false, reason: 'ark-starter-kit-disabled' };
    if (this.flags().dryRun) return { ok: false, reason: 'ark-shop-dry-run' };
    const ready = await this.ensureSchema();
    if (!ready.ok) return ready;
    const discord = String(input?.discordUserId || '').trim();
    const s = sqlIdent(this.schema);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const identity = await this.#identity(client, discord);
      if (!identity.ok) {
        await client.query('ROLLBACK');
        return identity;
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`nexus-economy:${identity.econId}:NEXUS_POINTS`]);
      const locked = await this.#identity(client, discord);
      if (!locked.ok) {
        await client.query('ROLLBACK');
        return locked;
      }
      const marker = await this.#lockedMarker(client, locked.econId);
      if (!marker.ok) {
        await client.query('ROLLBACK');
        return marker;
      }
      const existing = await client.query(
        `SELECT order_id, economic_identity_id, eos_id FROM ${s}.nexus_mc_grants
         WHERE kind = $1 AND (economic_identity_id = $2 OR eos_id = ANY($3::text[])) LIMIT 1`,
        [KIT_KIND, locked.econId, locked.eosIds]
      );
      if (existing.rows?.[0]) {
        const prior = await client.query(`SELECT order_data FROM ${s}.nexus_mc_orders WHERE order_id = $1`, [existing.rows[0].order_id]);
        await client.query('COMMIT');
        return { ok: true, duplicate: true, order: prior.rows?.[0]?.order_data || null, reason: 'already-claimed' };
      }
      // Recorded for the audit trail only. The owner did not ask for an age or tenure gate, so these dates are not enforced.
      const accountCreatedAt = discordAccountCreatedMs(discord);
      const joinedAt = this.tenureOf ? await this.tenureOf(discord) : await guildJoinedAtMs(discord, this.env);
      const nowIso = new Date(this.now()).toISOString();
      const order = this.#order({
        discord,
        econId: locked.econId,
        eosIds: locked.eosIds,
        sku: 'ark-starter-kit',
        price: 0,
        nonce: null,
        key: '',
        nowIso,
        source: 'ark-starter-kit',
        roll: null,
        balance: await this.#balance(client, locked.econId)
      });
      order.metadata = {
        notionalNp: this.catalog.kit.notionalPoints,
        accountCreatedAt: Number.isFinite(accountCreatedAt) ? new Date(accountCreatedAt).toISOString() : null,
        joinedAt: Number.isFinite(joinedAt) ? new Date(joinedAt).toISOString() : null
      };
      order.lines = this.catalog.kit.items.map((item) => ({ blueprint: item.blueprint, count: item.amount, status: 'PENDING' }));
      await client.query(
        `INSERT INTO ${s}.nexus_mc_orders (order_id, nonce, order_data, status, price, created_at, provider)
         VALUES ($1, NULL, $2::jsonb, 'PAID', 0, $3, 'ark')`,
        [order.orderId, JSON.stringify(order), nowIso]
      );
      await client.query(
        `INSERT INTO ${s}.nexus_mc_outbox (outbox_id, order_id, payload, provider) VALUES ($1,$2,$3::jsonb,'ark')`,
        [order.orderId, order.orderId, JSON.stringify({ orderId: order.orderId, source: 'ark-starter-kit', provider: 'ark' })]
      );
      const grantedEos = [];
      for (const eosId of locked.eosIds) {
        const anchor = grantedEos.length === 0;
        const grant = await client.query(
          `INSERT INTO ${s}.nexus_mc_grants
           (grant_id, kind, economic_identity_id, mc_uuid, eos_id, kit_version, order_id, status, claimed_at, provider, kit_anchor)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'PAID',$8,'ark',$9)
           ON CONFLICT DO NOTHING RETURNING grant_id`,
          [anchor ? `${KIT_KIND}:${locked.econId}` : `${KIT_KIND}:${locked.econId}:${eosId}`, KIT_KIND, locked.econId, eosId, eosId, this.catalog.kit.version, order.orderId, nowIso, anchor]
        );
        if (!grant.rowCount) {
          await client.query('ROLLBACK');
          return { ok: true, duplicate: true, reason: 'already-claimed' };
        }
        grantedEos.push(eosId);
      }
      await client.query('COMMIT');
      return { ok: true, order, grant: { kind: KIT_KIND, economicIdentityId: locked.econId, eosIds: grantedEos, orderId: order.orderId } };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      if (error.code === '23505') return { ok: true, duplicate: true, reason: 'already-claimed' };
      throw error;
    } finally {
      client.release();
    }
  }

  async prepareDelivery({ owner = 'sentinal-ark' } = {}) {
    if (!this.flags().shopDeliveryEnabled || this.flags().dryRun) return null;
    await this.#expireLeases();
    const s = sqlIdent(this.schema);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const picked = await client.query(
        `SELECT order_id, order_data FROM ${s}.nexus_mc_orders
         WHERE provider = 'ark' AND status IN ('PAID','PLAYER_OFFLINE')
           AND (order_data->>'leaseUntil' IS NULL OR (order_data->>'leaseUntil')::timestamptz <= NOW())
           AND (order_data->>'nextAttemptAt' IS NULL OR (order_data->>'nextAttemptAt')::timestamptz <= NOW())
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED LIMIT 1`
      );
      const row = picked.rows?.[0];
      if (!row) {
        await client.query('COMMIT');
        return null;
      }
      const order = row.order_data;
      order.leaseToken = crypto.randomUUID();
      order.leaseOwner = owner;
      order.leaseUntil = new Date(this.now() + PREPARE_LEASE_MS).toISOString();
      order.preparing = true;
      order.updatedAt = order.leaseUntil;
      await client.query(
        `UPDATE ${s}.nexus_mc_orders SET order_data = $2::jsonb WHERE order_id = $1 AND status = $3`,
        [order.orderId, JSON.stringify(order), order.status]
      );
      await client.query('COMMIT');
      return order;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async markOffline(order, { attempts = 1, multi = false } = {}) {
    const next = { ...order };
    next.status = 'PLAYER_OFFLINE';
    next.preparing = false;
    next.leaseToken = null;
    next.leaseUntil = null;
    next.offlineAttempts = Math.max(1, Number(attempts) || Number(order.offlineAttempts || 0) + 1);
    next.nextAttemptAt = new Date(this.now() + offlineBackoffMs(next.offlineAttempts)).toISOString();
    next.updatedAt = new Date(this.now()).toISOString();
    if (multi) console.warn(`[Nexus Economy] ark_multi_map_hold order=${order.orderId}`);
    return this.#saveStatus(next, ['PAID', 'PLAYER_OFFLINE'], order.leaseToken);
  }

  async markInProgress(order) {
    if (!this.flags().shopDeliveryEnabled) return { ok: false, reason: 'ark-shop-delivery-disabled' };
    const next = { ...order, status: 'DELIVERY_IN_PROGRESS', preparing: false };
    next.leaseToken = crypto.randomUUID();
    next.leaseUntil = new Date(this.now() + DELIVERY_LEASE_MS).toISOString();
    next.updatedAt = next.leaseUntil;
    const saved = await this.#saveStatus(next, ['PAID', 'PLAYER_OFFLINE'], order.leaseToken);
    return saved.ok ? { ok: true, order: next } : saved;
  }

  async markPreSendFailure(order, details = '') {
    const next = {
      ...order,
      status: 'DELIVERY_FAILED',
      preparing: false,
      leaseToken: null,
      leaseUntil: null,
      failureClass: 'RELOAD_FAILED',
      details: String(details || '').slice(0, 400),
      updatedAt: new Date(this.now()).toISOString()
    };
    const saved = await this.#saveStatus(next, ['PAID', 'PLAYER_OFFLINE'], order.leaseToken);
    if (saved.ok) await this.#refundFailed(order.orderId);
    return saved;
  }

  async applyDeliveryUpdate(input = {}) {
    const action = String(input.action || 'result');
    if (action === 'result') return this.markDelivery(input);
    if (!this.flags().shopDeliveryEnabled) return { ok: false, reason: 'ark-shop-delivery-disabled' };
    const order = await this.#loadOrder(input.orderId);
    if (!order) return { ok: false, reason: 'order-not-found' };
    if (!input.leaseToken || order.leaseToken !== input.leaseToken) return { ok: false, reason: 'lease-lost' };
    if (action === 'offline') return this.markOffline(order, { multi: input.multi === true });
    if (action === 'pre-send-failed') return this.markPreSendFailure(order, input.details || '');
    if (action === 'in-progress') return this.markInProgress(order);
    return { ok: false, reason: 'illegal-transition' };
  }

  async markDelivery({ orderId, leaseToken, status, failureClass = '', details = '' } = {}) {
    if (!this.flags().shopDeliveryEnabled) return { ok: false, reason: 'ark-shop-delivery-disabled' };
    if (!['DELIVERED', 'DELIVERY_FAILED', 'SENT_UNCONFIRMED', 'PLAYER_OFFLINE'].includes(status)) {
      return { ok: false, reason: 'illegal-transition' };
    }
    const s = sqlIdent(this.schema);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT order_data FROM ${s}.nexus_mc_orders WHERE order_id = $1 AND provider = 'ark' FOR UPDATE`,
        [orderId]
      );
      const order = found.rows?.[0]?.order_data;
      if (!order || order.leaseToken !== leaseToken || order.status !== 'DELIVERY_IN_PROGRESS') {
        await client.query('ROLLBACK');
        return { ok: false, reason: order ? 'lease-lost' : 'order-not-found' };
      }
      order.status = status;
      order.leaseToken = null;
      order.leaseUntil = null;
      order.failureClass = failureClass;
      order.details = String(details || '').slice(0, 400);
      order.updatedAt = new Date(this.now()).toISOString();
      const saved = await client.query(
        `UPDATE ${s}.nexus_mc_orders SET status = $2, order_data = $3::jsonb
         WHERE order_id = $1 AND provider = 'ark' AND status = 'DELIVERY_IN_PROGRESS' RETURNING order_id`,
        [orderId, status, JSON.stringify(order)]
      );
      if (!saved.rowCount) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'lease-lost' };
      }
      await client.query('COMMIT');
      if (status === 'DELIVERY_FAILED' && failureClass === 'REWARDS_ASCENDED_REJECTED') await this.#refundFailed(orderId);
      return { ok: true, order };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async #refundFailed(orderId) {
    try {
      await this.refund({ orderId, reason: 'delivery-failed', actor: 'auto', staff: false });
    } catch (error) {
      console.warn(`[Nexus Economy] ark_refund_after_failure ${String(error?.message || error).slice(0, 160)}`);
    }
  }

  async #loadOrder(orderId) {
    const found = await this.pool.query(
      `SELECT order_data FROM ${sqlIdent(this.schema)}.nexus_mc_orders WHERE order_id = $1 AND provider = 'ark'`,
      [String(orderId || '')]
    );
    return found.rows?.[0]?.order_data || null;
  }

  async refund(input = {}) {
    if (input.staff === true) {
      const allowed = await this.#authorizeStaff(input.actor);
      if (!allowed.ok) return allowed;
    }
    const ready = await this.ensureSchema();
    if (!ready.ok) return ready;
    const s = sqlIdent(this.schema);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT order_data, status FROM ${s}.nexus_mc_orders WHERE order_id = $1 AND provider = 'ark' FOR UPDATE`,
        [String(input.orderId || '')]
      );
      const order = found.rows?.[0]?.order_data;
      if (!order) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'order-not-found' };
      }
      const decision = refundDecision(order, {
        now: this.now(),
        staff: input.staff === true,
        actor: input.actor,
        reason: input.reason
      });
      if (!decision.ok || decision.duplicate) {
        await client.query(decision.ok ? 'COMMIT' : 'ROLLBACK');
        return decision;
      }
      let refundHold = null;
      if (order.economicIdentityId) {
        const marker = await this.#lockedMarker(client, order.economicIdentityId);
        const held = marker.reason === 'account-hold' || marker.reason === 'quarantined' || marker.reason === 'not-eligible';
        if (marker.reason === 'not-eligible' || (held && (input.staff !== true || !marker.rowPresent))) {
          await client.query('ROLLBACK');
          return marker;
        }
        if (held && input.staff === true && marker.rowPresent) {
          refundHold = marker;
          console.log(`[Nexus Economy] ark_staff_refund_while_held order=${order.orderId} actor=${input.actor}`);
        }
      }
      if (input.staff === true) {
        const cap = await this.#staffCap(client, input.actor);
        if (!cap.ok) {
          await client.query('ROLLBACK');
          return cap;
        }
      }
      if (!this.flags().npShopWritesEnabled) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'economy-np-shop-writes-not-enabled' };
      }
      const previous = order.status;
      order.status = 'REFUNDED';
      order.refunded = true;
      order.refundReason = refundHold
        ? `${String(input.reason || '').slice(0, 260)} [account-hold]`
        : String(input.reason || '');
      order.refundActor = String(input.actor || 'auto');
      order.updatedAt = new Date(this.now()).toISOString();
      const flipped = await client.query(
        `UPDATE ${s}.nexus_mc_orders SET status = 'REFUNDED', order_data = $2::jsonb
         WHERE order_id = $1 AND provider = 'ark' AND status = $3 AND status <> 'REFUNDED' AND status <> 'DELIVERED'
         RETURNING order_id`,
        [order.orderId, JSON.stringify(order), previous]
      );
      if (!flipped.rowCount) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'illegal-transition' };
      }
      if (Number(order.price) > 0) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`nexus-economy:${order.economicIdentityId}:NEXUS_POINTS`]);
        const wallet = await client.query(
          `SELECT balance FROM ${s}.nexus_economy_wallets WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS' FOR UPDATE`,
          [order.economicIdentityId]
        );
        const next = Number(wallet.rows?.[0]?.balance || 0) + Number(order.price);
        const ledger = await client.query(
          `INSERT INTO ${s}.nexus_economy_ledger
           (economic_identity_id, currency, amount, balance_after, entry_type, source, idempotency_key, metadata, created_at)
           VALUES ($1,'NEXUS_POINTS',$2,$3,'reversal','ark-shop',$4,$5::jsonb,NOW())
           ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
          [order.economicIdentityId, Number(order.price), next, refundKey(order.orderId), JSON.stringify({ orderId: order.orderId, reason: input.reason, actor: input.actor })]
        );
        if (ledger.rowCount) {
          await client.query(
            `UPDATE ${s}.nexus_economy_wallets SET balance = $2, updated_at = NOW()
             WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS'`,
            [order.economicIdentityId, next]
          );
        }
      }
      await client.query(
        `INSERT INTO ${s}.nexus_mc_refund_audit (order_id, actor, reason, amount, provider, created_at, retain_until)
         VALUES ($1,$2,$3,$4,'ark', NOW(), NOW() + ($5::bigint * INTERVAL '1 millisecond'))
         ON CONFLICT (order_id) DO NOTHING`,
        [order.orderId, String(input.actor || 'auto'), order.refundReason, Number(order.price || 0), AUDIT_RETAIN_MS]
      );
      await client.query('COMMIT');
      return { ok: true, order };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async sweepRefunds() {
    await this.#expireLeases();
    const ids = await this.pool.query(
      `SELECT order_id FROM ${sqlIdent(this.schema)}.nexus_mc_orders
       WHERE provider = 'ark' AND status IN ('PAID','PLAYER_OFFLINE','DELIVERY_FAILED')`
    );
    const results = [];
    for (const row of ids.rows || []) {
      results.push(await this.refund({ orderId: row.order_id, reason: 'auto-14d', actor: 'auto', staff: false }));
    }
    return results.filter((result) => result.ok && !result.duplicate);
  }

  async staffResolve(input = {}) {
    const allowed = await this.#authorizeStaff(input.actor);
    if (!allowed.ok) return allowed;
    const action = String(input.action || '');
    if (action === 'refund') {
      return this.refund({ ...input, staff: true, reason: input.reason, actor: input.actor });
    }
    if (action !== 'delivered') return { ok: false, reason: 'illegal-transition' };
    if (!String(input.reason || '').trim() || !String(input.actor || '').trim()) {
      return { ok: false, reason: 'reason-required' };
    }
    return this.#staffMarkDelivered(input);
  }

  async #staffMarkDelivered(input) {
    const s = sqlIdent(this.schema);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT order_data FROM ${s}.nexus_mc_orders WHERE order_id = $1 AND provider = 'ark' FOR UPDATE`,
        [String(input.orderId || '')]
      );
      const order = found.rows?.[0]?.order_data;
      if (!order) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'order-not-found' };
      }
      if (order.status === 'DELIVERED') {
        await client.query('COMMIT');
        return { ok: true, duplicate: true, order };
      }
      if (order.status !== 'SENT_UNCONFIRMED' && order.status !== 'DELIVERY_FAILED') {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'illegal-transition' };
      }
      if (String(input.actor) === String(order.discordUserId || '')) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'self-refund' };
      }
      const previous = order.status;
      order.status = 'DELIVERED';
      order.leaseToken = null;
      order.leaseUntil = null;
      order.details = String(input.reason).slice(0, 400);
      order.staffActor = String(input.actor);
      order.updatedAt = new Date(this.now()).toISOString();
      const saved = await client.query(
        `UPDATE ${s}.nexus_mc_orders SET status = 'DELIVERED', order_data = $2::jsonb
         WHERE order_id = $1 AND provider = 'ark' AND status = $3 RETURNING order_id`,
        [order.orderId, JSON.stringify(order), previous]
      );
      if (!saved.rowCount) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'illegal-transition' };
      }
      await client.query(
        `INSERT INTO ${s}.nexus_mc_action_audit (audit_id, action, actor, reason, result, subject, created_at)
         VALUES ($1, 'ark_staff_delivered', $2, $3, 'delivered', $4, NOW())`,
        [crypto.randomUUID(), String(input.actor), String(input.reason).slice(0, 400), order.orderId]
      );
      await client.query('COMMIT');
      return { ok: true, order };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async activity(discordUserId) {
    const s = sqlIdent(this.schema);
    const discord = String(discordUserId || '').trim();
    const client = await this.pool.connect();
    try {
      const identity = await this.#identity(client, discord);
      if (!identity.ok) return { ok: true, balance: 0, entries: [], orders: [], linked: false, reason: identity.reason };
      const balance = await this.#readBalance(client, identity.econId);
      const ledger = await client.query(
        `SELECT amount, entry_type, source, created_at FROM ${s}.nexus_economy_ledger
         WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS'
         ORDER BY created_at DESC LIMIT 10`,
        [identity.econId]
      );
      let orders = [];
      try {
        const orderRows = await client.query(
          `SELECT order_data FROM ${s}.nexus_mc_orders
           WHERE provider = 'ark' AND order_data->>'discordUserId' = $1
             AND status IN ('PAID','PLAYER_OFFLINE','DELIVERY_IN_PROGRESS','SENT_UNCONFIRMED','DELIVERY_FAILED')
           ORDER BY created_at DESC LIMIT 10`,
          [discord]
        );
        orders = (orderRows.rows || []).map((row) => row.order_data);
      } catch (error) {
        if (error.code !== '42P01') throw error;
      }
      return {
        ok: true,
        linked: true,
        balance,
        entries: (ledger.rows || []).map((row) => ({
          amount: Number(row.amount),
          entryType: row.entry_type,
          source: row.source,
          createdAt: new Date(row.created_at).toISOString()
        })),
        orders
      };
    } catch (error) {
      if (error.code === '42P01') {
        return { ok: true, balance: 0, entries: [], orders: [], linked: false, reason: 'schema-missing' };
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async #authorizeStaff(actor) {
    return authorizeStaffRefundActor({
      actor,
      env: this.env,
      fetchImpl: this.fetchImpl || globalThis.fetch
    });
  }

  async pendingOrders() {
    const ready = await this.ensureSchema();
    if (!ready.ok) return [];
    const result = await this.pool.query(
      `SELECT order_data FROM ${sqlIdent(this.schema)}.nexus_mc_orders
       WHERE provider = 'ark' AND status IN ('PAID','PLAYER_OFFLINE','DELIVERY_IN_PROGRESS')
       ORDER BY created_at ASC`
    );
    return result.rows.map((row) => row.order_data);
  }

  async listGrants() {
    const ready = await this.ensureSchema();
    if (!ready.ok) return [];
    const result = await this.pool.query(
      `SELECT kind, economic_identity_id, eos_id, order_id, status, claimed_at
       FROM ${sqlIdent(this.schema)}.nexus_mc_grants WHERE provider = 'ark' OR kind = $1`,
      [KIT_KIND]
    );
    return result.rows.map((row) => ({
      kind: row.kind,
      economicIdentityId: row.economic_identity_id,
      eosId: row.eos_id,
      orderId: row.order_id,
      status: row.status,
      claimedAt: new Date(row.claimed_at).toISOString()
    }));
  }

  async #identity(client, discordUserId) {
    const s = sqlIdent(this.schema);
    const identity = await client.query(
      `SELECT i.economic_identity_id, i.status, i.hold_reason
       FROM ${s}.nexus_economic_identity_links d
       JOIN ${s}.nexus_economic_identities i ON i.economic_identity_id = d.economic_identity_id
       WHERE d.provider = 'discord' AND d.external_id = $1 AND d.verified_at IS NOT NULL
       LIMIT 1`,
      [discordUserId]
    );
    const row = identity.rows?.[0];
    if (!row) {
      if (await this.#minecraftLinked(client, discordUserId, '')) return { ok: false, reason: 'minecraft-only' };
      return { ok: false, reason: 'verified-identity-required' };
    }
    const hold = memberIdentityHold({
      status: row.status,
      holdReason: row.hold_reason,
      economicIdentityId: row.economic_identity_id,
      env: this.env
    });
    if (hold) return hold;
    if (row.status === 'restricted') return { ok: false, reason: 'restricted' };
    if (row.status === 'disabled') return { ok: false, reason: 'disabled' };
    if (row.status !== 'verified') return { ok: false, reason: 'verified-identity-required' };
    if (quarantineDenylist(this.env).has(String(row.economic_identity_id))) return { ok: false, reason: 'quarantined' };
    const eos = await client.query(
      `SELECT external_id FROM ${s}.nexus_economic_identity_links
       WHERE economic_identity_id = $1 AND provider = 'eos' AND verified_at IS NOT NULL
       ORDER BY external_id`,
      [row.economic_identity_id]
    );
    const eosIds = (eos.rows || []).map((item) => String(item.external_id)).filter((id) => /^[A-Za-z0-9_-]{8,96}$/.test(id));
    if (!eosIds.length) {
      if (await this.#minecraftLinked(client, discordUserId, row.economic_identity_id)) return { ok: false, reason: 'minecraft-only' };
      return { ok: false, reason: 'verified-eos-required' };
    }
    return { ok: true, econId: row.economic_identity_id, eosIds };
  }

  async #lockedMarker(client, economicIdentityId) {
    try {
      assertMemberAccount(economicIdentityId);
    } catch {
      return { ok: false, reason: 'not-eligible', rowPresent: false };
    }
    const locked = await client.query(
      `SELECT status, hold_reason FROM ${sqlIdent(this.schema)}.nexus_economic_identities WHERE economic_identity_id = $1 FOR UPDATE`,
      [economicIdentityId]
    );
    const row = locked.rows?.[0];
    const hold = memberIdentityHold({
      status: row?.status,
      holdReason: row?.hold_reason,
      missingRow: !row,
      economicIdentityId,
      env: this.env
    });
    if (hold) return { ...hold, rowPresent: Boolean(row), status: row?.status || '' };
    const status = String(row?.status || '').trim().toLowerCase();
    if (status !== 'verified') {
      if (status === 'restricted') return { ok: false, reason: 'restricted', rowPresent: true, status };
      if (status === 'disabled') return { ok: false, reason: 'disabled', rowPresent: true, status };
      return { ok: false, reason: 'verified-identity-required', rowPresent: Boolean(row), status };
    }
    return { ok: true, rowPresent: true, status, holdReason: String(row?.hold_reason || '') };
  }

  async #minecraftLinked(client, discordUserId, econId) {
    const s = sqlIdent(this.schema);
    try {
      const byDiscord = await client.query(
        `SELECT 1 FROM ${s}.nexus_mc_links
         WHERE discord_user_id = $1 AND verified_at IS NOT NULL AND unlinked_at IS NULL LIMIT 1`,
        [discordUserId]
      );
      if (byDiscord.rows?.length) return true;
      if (econId) {
        const byIdentity = await client.query(
          `SELECT 1 FROM ${s}.nexus_economic_identity_links
           WHERE economic_identity_id = $1 AND provider = 'minecraft' AND verified_at IS NOT NULL LIMIT 1`,
          [econId]
        );
        if (byIdentity.rows?.length) return true;
      }
    } catch (error) {
      if (error.code !== '42P01') throw error;
    }
    return false;
  }

  async #readBalance(client, econId) {
    const wallet = await client.query(
      `SELECT balance FROM ${sqlIdent(this.schema)}.nexus_economy_wallets
       WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS'`,
      [econId]
    );
    return Number(wallet.rows?.[0]?.balance || 0);
  }

  async #balance(client, econId) {
    const s = sqlIdent(this.schema);
    await client.query(
      `INSERT INTO ${s}.nexus_economy_wallets (economic_identity_id, currency, balance)
       VALUES ($1,'NEXUS_POINTS',0) ON CONFLICT DO NOTHING`,
      [econId]
    );
    const wallet = await client.query(
      `SELECT balance FROM ${s}.nexus_economy_wallets WHERE economic_identity_id = $1 AND currency = 'NEXUS_POINTS'`,
      [econId]
    );
    return Number(wallet.rows?.[0]?.balance || 0);
  }

  #roll(sku) {
    const roll = rollCache(sku, () => crypto.randomInt(0, 1_000_000_000) / 1_000_000_000);
    if (roll.shiny !== false) throw new Error('shiny-disabled');
    if (!Number.isInteger(roll.level) || roll.level < 200 || roll.level > 300) throw new Error('level-out-of-range');
    blueprintRef(roll.blueprint);
    const saddle = saddleFor(roll.species) || '';
    if (saddle) blueprintRef(saddle);
    assertBlueprint(roll.blueprint);
    const sex = crypto.randomInt(0, 2) === 0 ? 'male' : 'female';
    return { ...roll, sex, saddle };
  }

  #order({ discord, econId, eosIds, sku, price, nonce, key, nowIso, source, roll, balance }) {
    return {
      orderId: crypto.randomUUID(),
      provider: 'ark',
      discordUserId: discord,
      economicIdentityId: econId,
      eosIds,
      sku,
      price,
      source,
      nonce,
      ledgerKey: key,
      status: 'PAID',
      roll,
      catalogVersion: this.catalog.version,
      createdAt: nowIso,
      paidAt: nowIso,
      updatedAt: nowIso,
      leaseToken: null,
      leaseUntil: null,
      nextAttemptAt: null,
      offlineAttempts: 0,
      refunded: false,
      balance
    };
  }

  async #saveStatus(order, allowed, leaseToken) {
    const s = sqlIdent(this.schema);
    const saved = await this.pool.query(
      `UPDATE ${s}.nexus_mc_orders SET status = $2, order_data = $3::jsonb
       WHERE order_id = $1 AND provider = 'ark' AND status = ANY($4::text[])
         AND order_data->>'leaseToken' = $5
       RETURNING order_id`,
      [order.orderId, order.status, JSON.stringify(order), allowed, leaseToken]
    );
    if (!saved.rowCount) return { ok: false, reason: 'lease-lost' };
    return { ok: true, order };
  }

  async #expireLeases() {
    const s = sqlIdent(this.schema);
    await this.pool.query(
      `UPDATE ${s}.nexus_mc_orders SET status = 'SENT_UNCONFIRMED',
       order_data = jsonb_set(jsonb_set(order_data, '{status}', '"SENT_UNCONFIRMED"'), '{leaseToken}', 'null')
       WHERE provider = 'ark' AND status = 'DELIVERY_IN_PROGRESS' AND (order_data->>'leaseUntil')::timestamptz <= NOW()`
    );
  }

  async #staffCap(client, actor) {
    const staffActor = String(actor || '');
    const s = sqlIdent(this.schema);
    const day = await client.query(`SELECT to_char(now() AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD') AS day`);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`ark-staff-refund:${staffActor}:${day.rows?.[0]?.day || ''}`]);
    const rows = await client.query(
      `SELECT created_at FROM ${s}.nexus_mc_refund_audit
       WHERE provider = 'ark' AND actor = $1
         AND (created_at AT TIME ZONE 'America/Chicago')::date = (now() AT TIME ZONE 'America/Chicago')::date
       FOR UPDATE`,
      [staffActor]
    );
    const todayCount = rows.rowCount || 0;
    if (todayCount >= STAFF_REFUND_ALERT_AT) console.warn(`[Nexus Economy] ark_staff_refund_alert actor=${actor} count=${todayCount}`);
    if (todayCount >= STAFF_REFUND_DAILY_CAP) return { ok: false, reason: 'staff-refund-cap' };
    await client.query(
      `DELETE FROM ${sqlIdent(this.schema)}.nexus_mc_refund_audit WHERE provider = 'ark' AND retain_until IS NOT NULL AND retain_until < NOW()`
    );
    return { ok: true };
  }
}

module.exports = { PostgresArkShop };
