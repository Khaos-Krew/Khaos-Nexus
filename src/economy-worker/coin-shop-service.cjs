'use strict';

const crypto = require('node:crypto');
const { catalogItem } = require('../shared/coin-shop-catalog.cjs');
const { coinShopFlags, purchaseCeiling } = require('../shared/coin-shop-flags.cjs');
const { purchaseKey, refundKey, coinShopLedgerIdFromRef, chicagoDayKey, ATTEMPT_WINDOW_MS, ATTEMPT_RETENTION_MS } = require('../shared/coin-shop-limits.cjs');
const { decideQuote, decidePurchase, decideRefund } = require('../shared/coin-shop-decide.cjs');
const { assertMemberAccount } = require('../shared/economy-system-accounts.cjs');
const { memberIdentityHold, quarantineDenylist } = require('../sentinel/nexus-economy-identity-hold.cjs');
const { acceptVerifiedStaff } = require('./coin-shop-staff.cjs');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class CoinShopService {
  constructor({ now = () => Date.now(), env = process.env, authorizeStaff = null } = {}) {
    this.now = now;
    this.env = env;
    this.authorizeStaff = authorizeStaff || ((input) => acceptVerifiedStaff(input));
    this.identities = new Map();
    this.coins = new Map();
    this.points = new Map();
    this.ledger = [];
    this.nextLedgerId = 1;
    this.entitlements = [];
    this.quotes = new Map();
    this.attempts = [];
    this.audit = [];
    this.inflight = new Map();
  }

  flags() {
    return coinShopFlags(this.env);
  }

  seed(input = {}) {
    const discordUserId = String(input.discordUserId || '');
    const econId = String(input.econId || '');
    if (!discordUserId || !econId) throw new Error('Seed needs a Discord id and an economic identity.');
    this.identities.set(discordUserId, {
      discordUserId,
      econId,
      status: String(input.status || 'verified'),
      holdReason: String(input.holdReason || ''),
      verifiedAt: input.verifiedAt === undefined ? '2026-01-01T00:00:00.000Z' : input.verifiedAt,
      linkSource: String(input.linkSource || ''),
      rankId: String(input.rankId || 'cipher-runner')
    });
    if (input.coins != null) this.coins.set(econId, Number(input.coins));
    if (input.points != null) this.points.set(econId, Number(input.points));
    return this.identityView(discordUserId);
  }

  seedSpend(econId, { at, amount, sku = 'thm_nebula' } = {}) {
    const price = Number(amount || 0);
    const when = Number(at || this.now());
    this.ledger.push({
      id: this.nextLedgerId,
      econId: String(econId),
      currency: 'NEXUS_COINS',
      amount: -price,
      balanceAfter: Number(this.coins.get(String(econId)) || 0),
      entryType: 'purchase',
      source: 'sink:coin-shop',
      key: `coin-shop:${econId}:${sku}:seed-${this.nextLedgerId}`,
      metadata: { sku, price, sink: 'sink:coin-shop' },
      createdAt: when
    });
    this.nextLedgerId += 1;
  }

  coinBalance(discordUserId) {
    const identity = this.identities.get(String(discordUserId || ''));
    if (!identity) return 0;
    return Number(this.coins.get(identity.econId) || 0);
  }

  pointBalance(discordUserId) {
    const identity = this.identities.get(String(discordUserId || ''));
    if (!identity) return 0;
    return Number(this.points.get(identity.econId) || 0);
  }

  identityView(discordUserId) {
    const row = this.identities.get(String(discordUserId || ''));
    if (!row) return null;
    const denylist = quarantineDenylist(this.env);
    const hold = memberIdentityHold({
      status: row.status,
      holdReason: row.holdReason,
      economicIdentityId: row.econId,
      env: this.env
    });
    return {
      econId: row.econId,
      status: row.status,
      holdReason: row.holdReason,
      verifiedAt: String(row.linkSource || '') === 'mc-link' ? null : (row.verifiedAt || null),
      rankId: row.rankId || '',
      held: Boolean(hold) || Boolean(String(row.holdReason || '').trim()),
      quarantined: denylist.has(row.econId) || String(row.status || '') === 'quarantined'
    };
  }

  #snapshot() {
    return {
      coins: clone([...this.coins.entries()]),
      points: clone([...this.points.entries()]),
      ledger: clone(this.ledger),
      nextLedgerId: this.nextLedgerId,
      entitlements: clone(this.entitlements),
      quotes: clone([...this.quotes.entries()]),
      attempts: clone(this.attempts),
      audit: clone(this.audit)
    };
  }

  #restore(snapshot) {
    this.coins = new Map(snapshot.coins);
    this.points = new Map(snapshot.points);
    this.ledger = snapshot.ledger;
    this.nextLedgerId = snapshot.nextLedgerId;
    this.entitlements = snapshot.entitlements;
    this.quotes = new Map(snapshot.quotes);
    this.attempts = snapshot.attempts;
    this.audit = snapshot.audit;
  }

  #limits() {
    return { ceiling: purchaseCeiling(this.env) };
  }

  #spentToday(econId, now) {
    const day = chicagoDayKey(now);
    let net = 0;
    for (const row of this.ledger) {
      if (row.econId !== econId || row.currency !== 'NEXUS_COINS' || row.source !== 'sink:coin-shop') continue;
      if (chicagoDayKey(row.createdAt) !== day) continue;
      net += -Number(row.amount || 0);
    }
    return net;
  }

  #attemptCount(econId, now) {
    return this.attempts.filter((row) => row.econId === econId && now - row.at < ATTEMPT_WINDOW_MS).length;
  }

  #owned(econId, sku) {
    return this.entitlements.some((row) => row.econId === econId && row.sku === sku && row.status === 'active');
  }

  #stateFor(discordUserId, sku, now) {
    const identity = this.identityView(discordUserId);
    const econId = identity?.econId || '';
    return {
      identity,
      balance: econId ? Number(this.coins.get(econId) || 0) : 0,
      pointsBalance: econId ? Number(this.points.get(econId) || 0) : 0,
      spentToday: econId ? this.#spentToday(econId, now) : 0,
      attemptCount: econId ? this.#attemptCount(econId, now) : 0,
      owned: Boolean(econId && sku && this.#owned(econId, sku))
    };
  }

  #apply(effects, pointsBefore) {
    let ledgerId = null;
    for (const effect of effects) {
      if (effect.currency && effect.currency !== 'NEXUS_COINS') {
        throw new Error('Coin shop refused a non-Coin effect.');
      }
      if (effect.type === 'attempt') {
        this.attempts.push({ econId: effect.econId, at: effect.at });
      } else if (effect.type === 'save-quote') {
        this.quotes.set(effect.nonce, { ...effect, consumed: false });
      } else if (effect.type === 'cas-debit' || effect.type === 'cas-credit') {
        const current = Number(this.coins.get(effect.econId) || 0);
        if (current !== effect.expected) return { ok: false, reason: 'balance-changed', balance: current };
        this.coins.set(effect.econId, effect.next);
      } else if (effect.type === 'ledger') {
        ledgerId = this.nextLedgerId;
        this.nextLedgerId += 1;
        this.ledger.push({
          id: ledgerId,
          econId: effect.econId,
          currency: 'NEXUS_COINS',
          amount: effect.amount,
          balanceAfter: effect.balanceAfter,
          entryType: effect.entryType,
          source: effect.source,
          key: effect.key,
          metadata: effect.metadata,
          createdAt: this.now()
        });
      } else if (effect.type === 'entitlement') {
        const existing = this.entitlements.find((row) => row.econId === effect.econId && row.sku === effect.sku);
        const row = {
          econId: effect.econId,
          discordUserId: effect.discordUserId,
          sku: effect.sku,
          price: effect.price,
          status: 'active',
          ledgerId,
          equippedAt: null,
          createdAt: this.now()
        };
        if (existing) Object.assign(existing, row);
        else this.entitlements.push(row);
      } else if (effect.type === 'consume-quote') {
        const quote = this.quotes.get(effect.nonce);
        if (quote) quote.consumed = true;
      } else if (effect.type === 'refund-entitlement') {
        const row = this.entitlements.find((item) => item.econId === effect.econId && item.sku === effect.sku && item.status === 'active');
        if (!row) return { ok: false, reason: 'revoke-failed' };
        row.status = 'refunded';
        row.equippedAt = null;
      } else if (effect.type === 'stamp-refund-ledger') {
        const row = this.entitlements.find((item) => item.econId === effect.econId && item.sku === effect.sku && item.status === 'refunded');
        if (!row || ledgerId == null) return { ok: false, reason: 'revoke-failed' };
        row.refundLedgerId = ledgerId;
      } else if (effect.type === 'audit') {
        this.audit.push({
          auditId: crypto.randomUUID(),
          action: effect.action,
          actor: effect.actor,
          reason: effect.reason,
          ledgerId: effect.ledgerId,
          sku: effect.sku || '',
          createdAt: new Date(this.now()).toISOString()
        });
      } else {
        throw new Error(`Unknown coin shop effect: ${effect.type}`);
      }
    }
    for (const [econId, balance] of this.points.entries()) {
      if (balance !== pointsBefore.get(econId)) throw new Error('Coin shop changed a Points balance.');
    }
    return { ok: true, ledgerId };
  }

  #commit(discordUserId, effects) {
    const pointsBefore = new Map(this.points);
    const snapshot = this.#snapshot();
    const applied = this.#apply(effects, pointsBefore);
    if (!applied.ok) {
      this.#restore(snapshot);
      return applied;
    }
    return applied;
  }

  #pruneQuotes(now) {
    for (const [nonce, quote] of this.quotes) {
      if (Date.parse(quote.expiresAt) <= now) this.quotes.delete(nonce);
    }
    this.attempts = this.attempts.filter((row) => now - Number(row.at) < ATTEMPT_RETENTION_MS);
  }

  #identityByEcon(econId) {
    for (const discordUserId of this.identities.keys()) {
      const view = this.identityView(discordUserId);
      if (view?.econId === econId) return view;
    }
    return null;
  }

  async quote(input = {}) {
    if (!this.flags().spendEnabled) return { ok: false, reason: 'economy-coin-shop-spend-not-enabled' };
    const now = this.now();
    this.#pruneQuotes(now);
    const sku = String(input.sku || '').trim();
    const state = this.#stateFor(input.discordUserId, sku, now);
    const nonce = crypto.randomUUID();
    const decision = decideQuote(state, input, now, this.#limits(), nonce);
    if (!decision.result.ok) return decision.result;
    const applied = this.#commit(input.discordUserId, decision.effects);
    if (!applied.ok) return applied;
    return decision.result;
  }

  purchase(input = {}) {
    const discord = String(input.discordUserId || '');
    const nonce = String(input.nonce || '');
    const econId = this.identityView(discord)?.econId || '';
    if (econId) {
      const existing = this.inflight.get(econId);
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
    if (econId) this.inflight.set(econId, box);
    const release = () => {
      if (econId && this.inflight.get(econId)?.promise === promise) this.inflight.delete(econId);
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

  async #purchaseNow(input) {
    if (!this.flags().spendEnabled) return { ok: false, reason: 'economy-coin-shop-spend-not-enabled' };
    const now = this.now();
    const sku = String(input.sku || '').trim();
    const nonce = String(input.nonce || '').trim();
    const identity = this.identityView(input.discordUserId);
    const econId = identity?.econId || '';
    const key = econId && sku && nonce ? purchaseKey(econId, sku, nonce) : '';
    const prior = key ? this.ledger.find((row) => row.key === key) : null;
    const state = this.#stateFor(input.discordUserId, sku, now);
    if (prior) {
      const item = catalogItem(prior.metadata?.sku || sku);
      state.replay = {
        ledgerId: prior.id,
        balanceAfter: prior.balanceAfter,
        ledgerRef: prior.key,
        sku: prior.metadata?.sku || sku,
        price: Number(prior.metadata?.price || item?.price || 0),
        slot: item?.slot || '',
        label: item?.label || sku,
        entitlement: this.#publicEntitlement(econId, prior.metadata?.sku || sku)
      };
    }
    const quote = this.quotes.get(nonce);
    state.quote = quote ? { ...quote } : null;
    try {
      assertMemberAccount(econId);
    } catch {
      return { ok: false, reason: 'not-eligible' };
    }
    const decision = decidePurchase(state, input, now, this.#limits());
    if (!decision.effects.length) return this.#withLedger(decision.result, prior?.id);
    const applied = this.#commit(input.discordUserId, decision.effects);
    if (!applied.ok) return applied;
    return {
      ...decision.result,
      ledgerId: applied.ledgerId,
      entitlement: this.#publicEntitlement(econId, sku)
    };
  }

  #withLedger(result, ledgerId) {
    if (!result?.ok) return result;
    return { ...result, ledgerId: result.ledgerId || ledgerId || null };
  }

  #publicEntitlement(econId, sku) {
    const row = this.entitlements.find((item) => item.econId === econId && item.sku === sku);
    if (!row) return null;
    return {
      sku: row.sku,
      status: row.status,
      ledgerId: row.ledgerId,
      price: row.price,
      equippedAt: row.equippedAt ? new Date(row.equippedAt).toISOString() : null,
      discordUserId: row.discordUserId
    };
  }

  #staffRefundsToday(actor, now) {
    const day = chicagoDayKey(now);
    return this.audit.filter((row) => {
      if (row.action !== 'refund' || String(row.actor || '') !== String(actor || '')) return false;
      const at = Date.parse(row.createdAt);
      return Number.isFinite(at) && chicagoDayKey(at) === day;
    }).length;
  }

  #refundDecision(input, auth) {
    const now = this.now();
    const purchase = this.#findPurchase(input.ledgerRef || input.ledgerId);
    try {
      if (purchase?.econId) assertMemberAccount(purchase.econId);
    } catch {
      return { decision: { result: { ok: false, reason: 'not-eligible' }, effects: [] }, purchase };
    }
    const holder = purchase ? this.#identityByEcon(purchase.econId) : null;
    const actor = String(auth.actor || input.actor || '');
    let actorEconId = '';
    let actorEconUnresolved = true;
    try {
      actorEconId = String(this.identityView(actor)?.econId || '');
      actorEconUnresolved = !actorEconId;
    } catch {
      actorEconUnresolved = true;
    }
    const state = {
      balance: purchase ? Number(this.coins.get(purchase.econId) || 0) : 0,
      purchase,
      held: Boolean(holder?.held),
      staffRefundsToday: this.#staffRefundsToday(actor, now),
      actorEconId,
      actorEconUnresolved
    };
    return {
      decision: decideRefund(state, { ...input, actor: auth.actor || input.actor }, now),
      purchase
    };
  }

  async previewRefund(input = {}) {
    if (!this.flags().spendEnabled) return { ok: false, reason: 'economy-coin-shop-spend-not-enabled' };
    const auth = await this.authorizeStaff(input);
    if (!auth?.ok) return { ok: false, reason: auth?.reason || 'staff-required' };
    return this.#refundDecision(input, auth).decision.result;
  }

  async refund(input = {}) {
    if (!this.flags().spendEnabled) return { ok: false, reason: 'economy-coin-shop-spend-not-enabled' };
    const auth = await this.authorizeStaff(input);
    if (!auth?.ok) return { ok: false, reason: auth?.reason || 'staff-required' };
    const { decision, purchase } = this.#refundDecision(input, auth);
    if (!decision.effects.length) return decision.result;
    const applied = this.#commit(purchase?.discordUserId, decision.effects);
    if (!applied.ok) return applied;
    return { ...decision.result, ledgerId: applied.ledgerId };
  }

  #findPurchase(ref) {
    const text = String(ref || '').trim();
    if (!text) return null;
    const shortId = coinShopLedgerIdFromRef(text);
    const row = this.ledger.find((item) => {
      if (item.currency !== 'NEXUS_COINS' || item.entryType !== 'purchase') return false;
      return String(item.id) === text || item.key === text || (shortId != null && item.id === shortId);
    });
    if (!row) return null;
    const sku = String(row.metadata?.sku || '');
    const entitlement = this.entitlements.find((item) => item.econId === row.econId && item.ledgerId === row.id)
      || this.entitlements.find((item) => item.econId === row.econId && item.sku === sku);
    const refundLedger = this.ledger.find((item) => item.key === refundKey(row.id));
    return {
      econId: row.econId,
      discordUserId: entitlement?.discordUserId || '',
      ledgerId: row.id,
      sku,
      price: Number(row.metadata?.price || Math.abs(row.amount)),
      currency: row.currency,
      createdAt: row.createdAt,
      equippedAt: entitlement?.equippedAt || null,
      refunded: Boolean(refundLedger) || entitlement?.status === 'refunded'
    };
  }

  async markEquipped(input = {}) {
    if (!this.flags().spendEnabled) return { ok: false, reason: 'economy-coin-shop-spend-not-enabled' };
    const identity = this.identityView(input.discordUserId);
    if (!identity) return { ok: false, reason: 'not-eligible' };
    const sku = String(input.sku || '').trim();
    const row = this.entitlements.find((item) => item.econId === identity.econId && item.sku === sku && item.status === 'active');
    if (!row) return { ok: false, reason: 'not-found' };
    if (row.equippedAt) return { ok: true, duplicate: true, sku };
    row.equippedAt = this.now();
    return { ok: true, sku, equippedAt: new Date(row.equippedAt).toISOString() };
  }

  entitlementsFor(discordUserId) {
    const identity = this.identityView(discordUserId);
    if (!identity) return { ok: true, entitlements: [] };
    return {
      ok: true,
      discordUserId: String(discordUserId),
      entitlements: this.entitlements
        .filter((row) => row.econId === identity.econId)
        .map((row) => this.#publicEntitlement(identity.econId, row.sku))
        .filter(Boolean)
    };
  }

  async lookup(input = {}) {
    const auth = await this.authorizeStaff(input);
    if (!auth?.ok) return { ok: false, reason: auth?.reason || 'staff-required' };
    const discordUserId = String(input.discordUserId || input.userId || '');
    const identity = this.identityView(discordUserId);
    this.audit.push({
      auditId: crypto.randomUUID(),
      action: 'lookup',
      actor: auth.actor || String(input.actor || ''),
      reason: 'lookup',
      ledgerId: null,
      sku: '',
      createdAt: new Date(this.now()).toISOString()
    });
    if (!identity) return { ok: true, discordUserId, found: false, balance: 0, entitlements: [], purchases: [] };
    const purchases = this.ledger
      .filter((row) => row.econId === identity.econId && row.currency === 'NEXUS_COINS' && row.source === 'sink:coin-shop')
      .map((row) => ({
        ledgerId: row.id,
        ledgerRef: row.key,
        amount: row.amount,
        sku: row.metadata?.sku || '',
        entryType: row.entryType,
        createdAt: new Date(row.createdAt).toISOString()
      }));
    return {
      ok: true,
      discordUserId,
      found: true,
      status: identity.status,
      rankId: identity.rankId,
      balance: Number(this.coins.get(identity.econId) || 0),
      entitlements: this.entitlementsFor(discordUserId).entitlements,
      purchases
    };
  }
}

module.exports = { CoinShopService };
