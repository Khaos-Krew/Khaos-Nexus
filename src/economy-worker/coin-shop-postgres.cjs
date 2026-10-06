'use strict';

const crypto = require('node:crypto');
const { sqlIdent } = require('../sentinel/nexus-economy-postgres-repository.cjs');
const { catalogItem } = require('../shared/coin-shop-catalog.cjs');
const { coinShopFlags, purchaseCeiling } = require('../shared/coin-shop-flags.cjs');
const { purchaseKey, refundKey, chicagoDayStart, ATTEMPT_WINDOW_MS } = require('../shared/coin-shop-limits.cjs');
const { decideQuote, decidePurchase, decideRefund } = require('../shared/coin-shop-decide.cjs');
const { memberIdentityHold, quarantineDenylist } = require('../sentinel/nexus-economy-identity-hold.cjs');
const { acceptVerifiedStaff } = require('./coin-shop-staff.cjs');

class PostgresCoinShop {
  constructor({ pool, schema = 'public', now = () => Date.now(), env = process.env, authorizeStaff = null } = {}) {
    if (!pool) throw new Error('Postgres pool is required.');
    this.pool = pool;
    this.schema = schema;
    this.now = now;
    this.env = env;
    this.ready = false;
    this.authorizeStaff = authorizeStaff || ((input) => acceptVerifiedStaff(input));
  }

  flags() {
    return coinShopFlags(this.env);
  }

  async ensureSchema() {
    const s = sqlIdent(this.schema);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${s}.nexus_coin_shop_quotes (
        nonce TEXT PRIMARY KEY,
        discord_user_id TEXT NOT NULL,
        economic_identity_id TEXT NOT NULL,
        sku TEXT NOT NULL,
        price BIGINT NOT NULL,
        expected_balance BIGINT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS ${s}.nexus_coin_shop_entitlements (
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
      CREATE TABLE IF NOT EXISTS ${s}.nexus_coin_shop_attempts (
        id BIGSERIAL PRIMARY KEY,
        economic_identity_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS nexus_coin_shop_attempts_identity_created_idx
        ON ${s}.nexus_coin_shop_attempts (economic_identity_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS ${s}.nexus_coin_shop_audit (
        audit_id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        reason TEXT NOT NULL,
        ledger_id BIGINT,
        sku TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    this.ready = true;
    return { ok: true };
  }

  async quote(input = {}) {
    if (!this.flags().spendEnabled) return { ok: false, reason: 'economy-coin-shop-spend-not-enabled' };
    if (!this.ready) return { ok: false, reason: 'coin-shop-unavailable' };
    return this.#transact(async (client) => {
      const now = this.now();
      await this.#pruneQuotes(client, now);
      const state = await this.#loadBuyer(client, input.discordUserId, String(input.sku || ''), now, { forUpdate: true });
      const nonce = crypto.randomUUID();
      const decision = decideQuote(state, input, now, { ceiling: purchaseCeiling(this.env) }, nonce);
      if (!decision.result.ok) return decision.result;
      await this.#apply(client, decision.effects, null);
      return decision.result;
    });
  }

  purchase(input = {}) {
    if (!this.flags().spendEnabled) return Promise.resolve({ ok: false, reason: 'economy-coin-shop-spend-not-enabled' });
    if (!this.ready) return Promise.resolve({ ok: false, reason: 'coin-shop-unavailable' });
    const discord = String(input.discordUserId || '');
    const nonce = String(input.nonce || '');
    this.inflight ||= new Map();
    if (discord) {
      const existing = this.inflight.get(discord);
      if (existing) {
        if (existing.nonce === nonce) return existing.promise;
        return Promise.resolve({ ok: false, reason: 'in-flight' });
      }
    }
    const box = {};
    const promise = new Promise((resolve, reject) => {
      box.resolve = resolve;
      box.reject = reject;
    });
    box.promise = promise;
    box.nonce = nonce;
    if (discord) this.inflight.set(discord, box);
    const release = () => {
      if (discord && this.inflight.get(discord)?.promise === promise) this.inflight.delete(discord);
    };
    this.#purchaseNow(input).then((result) => {
      release();
      box.resolve(result);
    }, (error) => {
      release();
      box.reject(error);
    });
    return promise;
  }

  async #purchaseNow(input = {}) {
    return this.#transact(async (client) => {
      const now = this.now();
      const sku = String(input.sku || '').trim();
      const nonce = String(input.nonce || '').trim();
      const state = await this.#loadBuyer(client, input.discordUserId, sku, now);
      if (state.identity?.econId) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`coin-shop:${state.identity.econId}`]);
      }
      const locked = await this.#loadBuyer(client, input.discordUserId, sku, now, { forUpdate: true, nonce });
      const decision = decidePurchase(locked, input, now, { ceiling: purchaseCeiling(this.env) });
      if (!decision.effects.length) return decision.result;
      const applied = await this.#apply(client, decision.effects, locked.identity.econId);
      if (!applied.ok) return applied;
      return {
        ...decision.result,
        ledgerId: applied.ledgerId,
        entitlement: await this.#entitlement(client, locked.identity.econId, sku)
      };
    });
  }

  async refund(input = {}) {
    if (!this.flags().spendEnabled) return { ok: false, reason: 'economy-coin-shop-spend-not-enabled' };
    if (!this.ready) return { ok: false, reason: 'coin-shop-unavailable' };
    const auth = await this.authorizeStaff(input);
    if (!auth?.ok) return { ok: false, reason: auth?.reason || 'staff-required' };
    return this.#transact(async (client) => {
      const now = this.now();
      const purchase = await this.#findPurchase(client, input.ledgerRef || input.ledgerId);
      if (purchase?.econId) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`coin-shop:${purchase.econId}`]);
      }
      const fresh = purchase ? await this.#findPurchase(client, input.ledgerRef || input.ledgerId) : null;
      let held = false;
      if (fresh?.econId) {
        const locked = await this.#lockIdentity(client, fresh.econId);
        held = locked.held;
      }
      const balance = fresh ? await this.#coinBalance(client, fresh.econId, true) : 0;
      const decision = decideRefund({ balance, purchase: fresh, held }, { ...input, actor: auth.actor || input.actor }, now);
      if (!decision.effects.length) return decision.result;
      const applied = await this.#apply(client, decision.effects, fresh.econId);
      if (!applied.ok) return applied;
      return { ...decision.result, ledgerId: applied.ledgerId };
    });
  }

  async markEquipped(input = {}) {
    if (!this.flags().spendEnabled) return { ok: false, reason: 'economy-coin-shop-spend-not-enabled' };
    if (!this.ready) return { ok: false, reason: 'coin-shop-unavailable' };
    const s = sqlIdent(this.schema);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const identity = await this.#identity(client, input.discordUserId);
      if (!identity) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'not-found' };
      }
      const updated = await client.query(
        `UPDATE ${s}.nexus_coin_shop_entitlements
         SET equipped_at = COALESCE(equipped_at, NOW()), updated_at = NOW()
         WHERE economic_identity_id = $1 AND sku = $2 AND status = 'active'
         RETURNING equipped_at, (xmax = 0) AS inserted`,
        [identity.econId, String(input.sku || '')]
      );
      if (!updated.rowCount) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'not-found' };
      }
      await client.query('COMMIT');
      return { ok: true, sku: String(input.sku || ''), equippedAt: new Date(updated.rows[0].equipped_at).toISOString() };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async entitlementsFor(discordUserId) {
    if (!this.ready) return { ok: false, reason: 'coin-shop-unavailable', entitlements: [] };
    const s = sqlIdent(this.schema);
    const client = await this.pool.connect();
    try {
      const identity = await this.#identity(client, discordUserId);
      if (!identity) return { ok: true, discordUserId: String(discordUserId || ''), entitlements: [] };
      const rows = await client.query(
        `SELECT sku, status, ledger_id, price, equipped_at, discord_user_id
         FROM ${s}.nexus_coin_shop_entitlements WHERE economic_identity_id = $1`,
        [identity.econId]
      );
      return {
        ok: true,
        discordUserId: String(discordUserId),
        entitlements: (rows.rows || []).map((row) => ({
          sku: row.sku,
          status: row.status,
          ledgerId: row.ledger_id == null ? null : Number(row.ledger_id),
          price: Number(row.price),
          equippedAt: row.equipped_at ? new Date(row.equipped_at).toISOString() : null,
          discordUserId: row.discord_user_id
        }))
      };
    } finally {
      client.release();
    }
  }

  async lookup(input = {}) {
    const auth = await this.authorizeStaff(input);
    if (!auth?.ok) return { ok: false, reason: auth?.reason || 'staff-required' };
    if (!this.ready) return { ok: false, reason: 'coin-shop-unavailable' };
    const s = sqlIdent(this.schema);
    const discordUserId = String(input.discordUserId || input.userId || '');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO ${s}.nexus_coin_shop_audit (audit_id, action, actor, reason, sku) VALUES ($1, 'lookup', $2, 'lookup', '')`,
        [crypto.randomUUID(), auth.actor || String(input.actor || '')]
      );
      const identity = await this.#identity(client, discordUserId);
      if (!identity) {
        await client.query('COMMIT');
        return { ok: true, discordUserId, found: false, balance: 0, entitlements: [], purchases: [] };
      }
      const balance = await this.#coinBalance(client, identity.econId, false);
      const entitlements = await this.entitlementsFor(discordUserId);
      const purchases = await client.query(
        `SELECT id, idempotency_key, amount, entry_type, metadata, created_at
         FROM ${s}.nexus_economy_ledger
         WHERE economic_identity_id = $1 AND currency = 'NEXUS_COINS' AND source = 'sink:coin-shop'
         ORDER BY created_at DESC LIMIT 20`,
        [identity.econId]
      );
      await client.query('COMMIT');
      return {
        ok: true,
        discordUserId,
        found: true,
        status: identity.status,
        rankId: identity.rankId,
        balance,
        entitlements: entitlements.entitlements || [],
        purchases: (purchases.rows || []).map((row) => ({
          ledgerId: Number(row.id),
          ledgerRef: row.idempotency_key,
          amount: Number(row.amount),
          sku: row.metadata?.sku || '',
          entryType: row.entry_type,
          createdAt: new Date(row.created_at).toISOString()
        }))
      };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async #transact(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      if (error?.reason === 'balance-changed') return { ok: false, reason: 'balance-changed' };
      if (error?.reason === 'duplicate-order') return { ok: false, reason: 'in-flight' };
      throw error;
    } finally {
      client.release();
    }
  }

  async #apply(client, effects, econId) {
    const s = sqlIdent(this.schema);
    let ledgerId = null;
    for (const effect of effects) {
      if (effect.currency && effect.currency !== 'NEXUS_COINS') throw new Error('Coin shop refused a non-Coin effect.');
      if (effect.type === 'attempt') {
        await client.query(
          `INSERT INTO ${s}.nexus_coin_shop_attempts (economic_identity_id, created_at) VALUES ($1, $2)`,
          [effect.econId, new Date(effect.at).toISOString()]
        );
      } else if (effect.type === 'save-quote') {
        await client.query(
          `INSERT INTO ${s}.nexus_coin_shop_quotes
           (nonce, discord_user_id, economic_identity_id, sku, price, expected_balance, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [effect.nonce, effect.discordUserId, effect.econId, effect.sku, effect.price, effect.expectedBalance, effect.expiresAt]
        );
      } else if (effect.type === 'cas-debit' || effect.type === 'cas-credit') {
        await client.query(
          `INSERT INTO ${s}.nexus_economy_wallets (economic_identity_id, currency, balance)
           VALUES ($1, 'NEXUS_COINS', 0) ON CONFLICT DO NOTHING`,
          [effect.econId]
        );
        const updated = await client.query(
          `UPDATE ${s}.nexus_economy_wallets SET balance = $2, updated_at = NOW()
           WHERE economic_identity_id = $1 AND currency = 'NEXUS_COINS' AND balance = $3`,
          [effect.econId, effect.next, effect.expected]
        );
        if (!updated.rowCount) {
          const error = new Error('balance-changed');
          error.reason = 'balance-changed';
          throw error;
        }
      } else if (effect.type === 'ledger') {
        const inserted = await client.query(
          `INSERT INTO ${s}.nexus_economy_ledger
           (economic_identity_id, currency, amount, balance_after, entry_type, source, idempotency_key, metadata, created_at)
           VALUES ($1, 'NEXUS_COINS', $2, $3, $4, 'sink:coin-shop', $5, $6::jsonb, NOW())
           ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
          [effect.econId, effect.amount, effect.balanceAfter, effect.entryType, effect.key, JSON.stringify(effect.metadata || {})]
        );
        if (!inserted.rowCount) {
          const error = new Error('duplicate-order');
          error.reason = 'duplicate-order';
          throw error;
        }
        ledgerId = Number(inserted.rows[0].id);
      } else if (effect.type === 'entitlement') {
        await client.query(
          `INSERT INTO ${s}.nexus_coin_shop_entitlements
           (economic_identity_id, sku, discord_user_id, ledger_id, price, status)
           VALUES ($1,$2,$3,$4,$5,'active')
           ON CONFLICT (economic_identity_id, sku) DO UPDATE SET
             discord_user_id = EXCLUDED.discord_user_id,
             ledger_id = EXCLUDED.ledger_id,
             price = EXCLUDED.price,
             status = 'active',
             equipped_at = NULL,
             refund_ledger_id = NULL,
             updated_at = NOW()
           WHERE ${s}.nexus_coin_shop_entitlements.status = 'refunded'`,
          [effect.econId, effect.sku, effect.discordUserId, ledgerId, effect.price]
        );
      } else if (effect.type === 'consume-quote') {
        await client.query(`UPDATE ${s}.nexus_coin_shop_quotes SET consumed_at = NOW() WHERE nonce = $1`, [effect.nonce]);
      } else if (effect.type === 'refund-entitlement') {
        await client.query(
          `UPDATE ${s}.nexus_coin_shop_entitlements
           SET status = 'refunded', refund_ledger_id = $3, equipped_at = NULL, updated_at = NOW()
           WHERE economic_identity_id = $1 AND sku = $2`,
          [effect.econId, effect.sku, ledgerId]
        );
      } else if (effect.type === 'audit') {
        await client.query(
          `INSERT INTO ${s}.nexus_coin_shop_audit (audit_id, action, actor, reason, ledger_id, sku)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [crypto.randomUUID(), effect.action, effect.actor, effect.reason, effect.ledgerId, effect.sku || '']
        );
      }
    }
    return { ok: true, ledgerId, econId };
  }

  async #loadBuyer(client, discordUserId, sku, now, { forUpdate = false, nonce = '' } = {}) {
    const identity = await this.#identity(client, discordUserId, { forUpdate });
    const econId = identity?.econId || '';
    const balance = econId ? await this.#coinBalance(client, econId, forUpdate) : 0;
    const spentToday = econId ? await this.#spentToday(client, econId, now) : 0;
    const attemptCount = econId ? await this.#attemptCount(client, econId, now) : 0;
    const owned = Boolean(econId && sku && await this.#owns(client, econId, sku));
    const state = { identity, balance, spentToday, attemptCount, owned, quote: null, replay: null };
    if (nonce && econId) {
      const key = purchaseKey(econId, sku, nonce);
      const prior = await client.query(
        `SELECT id, idempotency_key, balance_after, metadata FROM ${sqlIdent(this.schema)}.nexus_economy_ledger WHERE idempotency_key = $1`,
        [key]
      );
      const row = prior.rows?.[0];
      if (row) {
        const item = catalogItem(row.metadata?.sku || sku);
        state.replay = {
          ledgerId: Number(row.id),
          balanceAfter: Number(row.balance_after),
          ledgerRef: row.idempotency_key,
          sku: row.metadata?.sku || sku,
          price: Number(row.metadata?.price || item?.price || 0),
          slot: item?.slot || '',
          label: item?.label || sku,
          entitlement: await this.#entitlement(client, econId, row.metadata?.sku || sku)
        };
      }
      const quote = await client.query(
        `SELECT nonce, discord_user_id, economic_identity_id, sku, price, expected_balance, expires_at, consumed_at
         FROM ${sqlIdent(this.schema)}.nexus_coin_shop_quotes WHERE nonce = $1 ${forUpdate ? 'FOR UPDATE' : ''}`,
        [nonce]
      );
      const quoteRow = quote.rows?.[0];
      if (quoteRow) {
        state.quote = {
          nonce: quoteRow.nonce,
          discordUserId: quoteRow.discord_user_id,
          econId: quoteRow.economic_identity_id,
          sku: quoteRow.sku,
          price: Number(quoteRow.price),
          expectedBalance: Number(quoteRow.expected_balance),
          expiresAt: new Date(quoteRow.expires_at).toISOString(),
          consumed: Boolean(quoteRow.consumed_at)
        };
      }
    }
    return state;
  }

  async #pruneQuotes(client, now) {
    await client.query(
      `DELETE FROM ${sqlIdent(this.schema)}.nexus_coin_shop_quotes WHERE expires_at <= $1`,
      [new Date(now).toISOString()]
    );
  }

  async #lockIdentity(client, econId) {
    const locked = await client.query(
      `SELECT status, hold_reason FROM ${sqlIdent(this.schema)}.nexus_economic_identities WHERE economic_identity_id = $1 FOR UPDATE`,
      [econId]
    );
    return this.#identityView(locked.rows?.[0] || null, econId);
  }

  #identityView(row, econId) {
    const status = String(row?.status || '');
    const holdReason = String(row?.hold_reason || '');
    const hold = memberIdentityHold({
      status,
      holdReason,
      missingRow: !row,
      economicIdentityId: econId,
      env: this.env
    });
    return {
      status,
      holdReason,
      held: Boolean(hold) || Boolean(holdReason.trim()),
      quarantined: quarantineDenylist(this.env).has(String(econId || '')) || status === 'quarantined'
    };
  }

  async #identity(client, discordUserId, { forUpdate = false } = {}) {
    const s = sqlIdent(this.schema);
    const identity = await client.query(
      `SELECT i.economic_identity_id, i.status, i.hold_reason, d.verified_at
       FROM ${s}.nexus_economic_identity_links d
       JOIN ${s}.nexus_economic_identities i ON i.economic_identity_id = d.economic_identity_id
       WHERE d.provider = 'discord' AND d.external_id = $1
       LIMIT 1`,
      [String(discordUserId || '')]
    );
    const linked = identity.rows?.[0];
    if (!linked) return null;
    let row = linked;
    if (forUpdate) {
      const locked = await this.#lockIdentity(client, linked.economic_identity_id);
      row = {
        ...linked,
        status: locked.status,
        hold_reason: locked.holdReason
      };
    }
    const viewed = this.#identityView(row, row.economic_identity_id);
    let rankId = '';
    const rankTable = await client.query('SELECT to_regclass($1) AS rel', [`${this.schema}.nexus_economy_accrual_state`]);
    if (rankTable.rows?.[0]?.rel) {
      const rank = await client.query(
        `SELECT rank_id FROM ${s}.nexus_economy_accrual_state WHERE economic_identity_id = $1`,
        [row.economic_identity_id]
      );
      rankId = String(rank.rows?.[0]?.rank_id || '');
    }
    return {
      econId: row.economic_identity_id,
      status: viewed.status,
      holdReason: viewed.holdReason,
      verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : null,
      rankId,
      held: viewed.held,
      quarantined: viewed.quarantined
    };
  }

  async #coinBalance(client, econId, forUpdate) {
    const result = await client.query(
      `SELECT balance FROM ${sqlIdent(this.schema)}.nexus_economy_wallets
       WHERE economic_identity_id = $1 AND currency = 'NEXUS_COINS' ${forUpdate ? 'FOR UPDATE' : ''}`,
      [econId]
    );
    return Number(result.rows?.[0]?.balance || 0);
  }

  async #spentToday(client, econId, now) {
    const result = await client.query(
      `SELECT COALESCE(SUM(-amount), 0)::bigint AS spent
       FROM ${sqlIdent(this.schema)}.nexus_economy_ledger
       WHERE economic_identity_id = $1 AND currency = 'NEXUS_COINS' AND source = 'sink:coin-shop'
         AND created_at >= $2`,
      [econId, new Date(chicagoDayStart(now)).toISOString()]
    );
    return Number(result.rows?.[0]?.spent || 0);
  }

  async #attemptCount(client, econId, now) {
    const result = await client.query(
      `SELECT COUNT(*)::bigint AS attempts FROM ${sqlIdent(this.schema)}.nexus_coin_shop_attempts
       WHERE economic_identity_id = $1 AND created_at >= $2`,
      [econId, new Date(now - ATTEMPT_WINDOW_MS).toISOString()]
    );
    return Number(result.rows?.[0]?.attempts || 0);
  }

  async #owns(client, econId, sku) {
    const result = await client.query(
      `SELECT 1 FROM ${sqlIdent(this.schema)}.nexus_coin_shop_entitlements
       WHERE economic_identity_id = $1 AND sku = $2 AND status = 'active' LIMIT 1`,
      [econId, sku]
    );
    return Boolean(result.rowCount);
  }

  async #entitlement(client, econId, sku) {
    const result = await client.query(
      `SELECT sku, status, ledger_id, price, equipped_at, discord_user_id
       FROM ${sqlIdent(this.schema)}.nexus_coin_shop_entitlements
       WHERE economic_identity_id = $1 AND sku = $2`,
      [econId, sku]
    );
    const row = result.rows?.[0];
    if (!row) return null;
    return {
      sku: row.sku,
      status: row.status,
      ledgerId: row.ledger_id == null ? null : Number(row.ledger_id),
      price: Number(row.price),
      equippedAt: row.equipped_at ? new Date(row.equipped_at).toISOString() : null,
      discordUserId: row.discord_user_id
    };
  }

  async #findPurchase(client, ref) {
    const text = String(ref || '').trim();
    if (!text) return null;
    const s = sqlIdent(this.schema);
    const result = await client.query(
      `SELECT id, economic_identity_id, currency, amount, entry_type, metadata, created_at
       FROM ${s}.nexus_economy_ledger
       WHERE currency = 'NEXUS_COINS' AND entry_type = 'purchase' AND source = 'sink:coin-shop'
         AND (idempotency_key = $1 OR id::text = $1)
       LIMIT 1`,
      [text]
    );
    const row = result.rows?.[0];
    if (!row) return null;
    const sku = String(row.metadata?.sku || '');
    const entitlement = await client.query(
      `SELECT discord_user_id, status, equipped_at FROM ${s}.nexus_coin_shop_entitlements
       WHERE economic_identity_id = $1 AND (ledger_id = $2 OR sku = $3)
       ORDER BY CASE WHEN ledger_id = $2 THEN 0 ELSE 1 END LIMIT 1`,
      [row.economic_identity_id, row.id, sku]
    );
    const ent = entitlement.rows?.[0];
    // Refund idempotency key is coin-shop-refund:<originalLedgerId>.
    const refund = await client.query(
      `SELECT 1 FROM ${s}.nexus_economy_ledger WHERE idempotency_key = $1 LIMIT 1`,
      [refundKey(row.id)]
    );
    return {
      econId: row.economic_identity_id,
      discordUserId: ent?.discord_user_id || '',
      ledgerId: Number(row.id),
      sku,
      price: Number(row.metadata?.price || Math.abs(Number(row.amount))),
      currency: row.currency,
      createdAt: new Date(row.created_at).getTime(),
      equippedAt: ent?.equipped_at ? new Date(ent.equipped_at).getTime() : null,
      refunded: Boolean(refund.rowCount) || ent?.status === 'refunded'
    };
  }
}

module.exports = { PostgresCoinShop };
