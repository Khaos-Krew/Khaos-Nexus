'use strict';

const crypto = require('node:crypto');
const { mcPointsFlags } = require('../shared/mc-points-flags.cjs');
const {
  MAX_BUNDLES,
  MAX_PURCHASE_NP,
  MAX_DAILY_SPEND_NP,
  MAX_DAILY_ORDERS,
  catalogItem,
  loadMcShopCatalog
} = require('../shared/mc-shop-catalog.cjs');
const { loadStarterKit, starterKitEligibility } = require('../shared/mc-starter-kit.cjs');
const { ctDayKey } = require('./mc-playtime-accounting.cjs');
const { isPremiumUuid, normalizeUuid, itemIdOk } = require('../craft/mc-rcon-text.cjs');

const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const QUOTE_TTL_MS = 120 * 1000;
const UNLINK_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const REFUND_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
const LEASE_MS = 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code || '')).digest('hex');
}

function generateLinkCode(bytes = crypto.randomBytes(6)) {
  const chars = [...bytes].map((value) => CODE_ALPHABET[value % CODE_ALPHABET.length]);
  return `${chars.slice(0, 3).join('')}-${chars.slice(3, 6).join('')}`;
}

function stackLines(itemId, total) {
  if (!itemIdOk(itemId)) throw new Error('invalid-item-id');
  const lines = [];
  let left = Number(total);
  while (left > 0) {
    const count = Math.min(64, left);
    lines.push({ itemId, count, status: 'PENDING' });
    left -= count;
  }
  return lines;
}

function dayOrders(orders, discordUserId, nowMs) {
  const day = ctDayKey(nowMs);
  return orders.filter((order) => order.source === 'mc-shop' && order.discordUserId === discordUserId && ctDayKey(Date.parse(order.createdAt)) === day && order.status !== 'REFUNDED');
}

class MemoryMcPoints {
  constructor({ now = () => Date.now(), wallet, env = process.env, catalog, kit } = {}) {
    if (!wallet) throw new Error('Minecraft points service requires a wallet.');
    this.now = now;
    this.wallet = wallet;
    this.env = env;
    this.catalog = catalog || loadMcShopCatalog(env);
    this.kit = kit || loadStarterKit(env);
    this.links = new Map();
    this.challenges = new Map();
    this.orders = new Map();
    this.grants = [];
    this.quotes = new Map();
  }

  flags() {
    return mcPointsFlags(this.env);
  }

  async challenge({ discordUserId, mcUuid, mcName } = {}) {
    const flags = this.flags();
    if (!flags.pointsEnabled) return { ok: false, reason: 'mc-points-disabled' };
    const uuid = normalizeUuid(mcUuid);
    if (!isPremiumUuid(uuid)) return { ok: false, reason: 'uuid-not-premium' };
    const discord = String(discordUserId || '').trim();
    if (!/^\d{5,32}$/.test(discord)) return { ok: false, reason: 'discord-user-required' };
    const identity = await this.wallet.resolve(discord);
    if (!identity || identity.status !== 'verified' || !identity.verifiedAt) {
      return { ok: false, reason: 'verified-identity-required' };
    }
    const blocked = this.#cooldownReason(discord, uuid, this.now());
    if (blocked) return { ok: false, reason: blocked };
    const code = generateLinkCode();
    this.challenges.set(discord, {
      discordUserId: discord,
      mcUuid: uuid,
      mcName: String(mcName || '').slice(0, 16),
      codeHash: hashCode(code),
      expiresAt: this.now() + LINK_CODE_TTL_MS,
      economicIdentityId: identity.economicIdentityId
    });
    return { ok: true, code, expiresInSec: LINK_CODE_TTL_MS / 1000, mcUuid: uuid };
  }

  async confirm({ discordUserId, code } = {}) {
    const flags = this.flags();
    if (!flags.pointsEnabled) return { ok: false, reason: 'mc-points-disabled' };
    const discord = String(discordUserId || '').trim();
    const pending = this.challenges.get(discord);
    const now = this.now();
    if (!pending || pending.expiresAt <= now) return { ok: false, reason: 'code-expired' };
    const supplied = hashCode(String(code || '').trim().toUpperCase());
    const expected = Buffer.from(pending.codeHash);
    const actual = Buffer.from(supplied);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      return { ok: false, reason: 'code-mismatch' };
    }
    const identity = await this.wallet.resolve(discord);
    if (!identity || identity.status !== 'verified' || identity.economicIdentityId !== pending.economicIdentityId) {
      return { ok: false, reason: 'verified-identity-required' };
    }
    const blocked = this.#cooldownReason(discord, pending.mcUuid, now);
    if (blocked) return { ok: false, reason: blocked };
    const taken = [...this.links.values()].find((link) => link.mcUuid === pending.mcUuid && link.verifiedAt && link.discordUserId !== discord);
    if (taken) return { ok: false, reason: 'uuid-taken' };
    const own = [...this.links.values()].find((link) => link.discordUserId === discord && link.verifiedAt && link.mcUuid !== pending.mcUuid);
    if (own) return { ok: false, reason: 'already-linked' };
    this.links.set(pending.mcUuid, {
      mcUuid: pending.mcUuid,
      discordUserId: discord,
      economicIdentityId: identity.economicIdentityId,
      verifiedAt: new Date(now).toISOString(),
      unlinkedAt: null,
      cooldownUntil: null
    });
    this.challenges.delete(discord);
    return { ok: true, mcUuid: pending.mcUuid, economicIdentityId: identity.economicIdentityId };
  }

  async unlink({ discordUserId } = {}) {
    if (!this.flags().pointsEnabled) return { ok: false, reason: 'mc-points-disabled' };
    const discord = String(discordUserId || '').trim();
    const link = [...this.links.values()].find((row) => row.discordUserId === discord && row.verifiedAt);
    if (!link) return { ok: false, reason: 'not-linked' };
    const now = this.now();
    link.verifiedAt = null;
    link.unlinkedAt = new Date(now).toISOString();
    link.cooldownUntil = new Date(now + UNLINK_COOLDOWN_MS).toISOString();
    return { ok: true, cooldownUntil: link.cooldownUntil, mcUuid: link.mcUuid };
  }

  async status({ discordUserId } = {}) {
    const discord = String(discordUserId || '').trim();
    const link = [...this.links.values()].find((row) => row.discordUserId === discord && row.verifiedAt);
    const cooling = [...this.links.values()].find((row) => row.discordUserId === discord && row.cooldownUntil && Date.parse(row.cooldownUntil) > this.now());
    return {
      ok: true,
      linked: Boolean(link),
      mcUuid: link?.mcUuid || '',
      cooldownUntil: cooling?.cooldownUntil || null
    };
  }

  linkByUuid(mcUuid) {
    const link = this.links.get(normalizeUuid(mcUuid));
    if (!link?.verifiedAt) return null;
    return link;
  }

  async quote({ discordUserId, sku, bundles = 1 } = {}) {
    if (!this.flags().shopEnabled) return { ok: false, reason: 'mc-shop-disabled' };
    const discord = String(discordUserId || '').trim();
    const identity = await this.wallet.resolve(discord);
    if (!identity || identity.status !== 'verified') return { ok: false, reason: 'verified-identity-required' };
    const link = [...this.links.values()].find((row) => row.discordUserId === discord && row.verifiedAt);
    if (!link) return { ok: false, reason: 'verified-minecraft-link-required' };
    const item = catalogItem(this.catalog, String(sku || ''));
    if (!item) return { ok: false, reason: 'unknown-sku' };
    const count = Number(bundles);
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_BUNDLES) return { ok: false, reason: 'bundle-limit' };
    const price = item.price * count;
    if (price <= 0 || price > MAX_PURCHASE_NP) return { ok: false, reason: 'price-limit' };
    const balance = Number(await this.wallet.balance(discord));
    const nonce = crypto.randomBytes(8).toString('hex');
    const quote = {
      nonce,
      discordUserId: discord,
      economicIdentityId: identity.economicIdentityId,
      mcUuid: link.mcUuid,
      sku: item.sku,
      itemId: item.itemId,
      bundles: count,
      qty: item.qty * count,
      price,
      catalogVersion: this.catalog.version,
      expiresAt: this.now() + QUOTE_TTL_MS,
      balance,
      balanceAfter: balance - price
    };
    this.quotes.set(nonce, quote);
    return { ok: true, quote };
  }

  async buy({ discordUserId, sku, bundles = 1, nonce, writesEnabled = false } = {}) {
    if (!writesEnabled) return { ok: false, reason: 'economy-write-cutover-not-enabled' };
    if (!this.flags().shopEnabled) return { ok: false, reason: 'mc-shop-disabled' };
    const pending = this.quotes.get(String(nonce || ''));
    const now = this.now();
    if (!pending || pending.expiresAt <= now) return { ok: false, reason: 'quote-expired' };
    if (pending.discordUserId !== String(discordUserId || '').trim()) return { ok: false, reason: 'subject-mismatch' };
    if (pending.sku !== sku || pending.bundles !== Number(bundles)) return { ok: false, reason: 'quote-mismatch' };
    const existing = [...this.orders.values()].find((order) => order.nonce === pending.nonce);
    if (existing) return { ok: true, duplicate: true, order: existing };
    const today = dayOrders([...this.orders.values()], pending.discordUserId, now);
    if (today.length >= MAX_DAILY_ORDERS) return { ok: false, reason: 'daily-order-limit' };
    const spentToday = today.reduce((sum, order) => sum + Number(order.price || 0), 0);
    if (spentToday + pending.price > MAX_DAILY_SPEND_NP) return { ok: false, reason: 'daily-spend-limit' };
    const item = catalogItem(this.catalog, pending.sku);
    if (item?.dailyLimit) {
      const skuCount = today.filter((order) => order.sku === pending.sku).reduce((sum, order) => sum + Number(order.bundles || 0), 0);
      if (skuCount + pending.bundles > item.dailyLimit) return { ok: false, reason: 'sku-daily-limit' };
    }
    const ledgerKey = `mc-shop:${pending.economicIdentityId}:${pending.sku}:${pending.nonce}`;
    const spent = await this.wallet.spend({
      discordUserId: pending.discordUserId,
      amount: pending.price,
      orderId: ledgerKey,
      idempotencyKey: ledgerKey,
      source: 'sink:mc-shop',
      metadata: { sku: pending.sku, qty: pending.qty, catalogVersion: pending.catalogVersion }
    });
    if (!spent?.ok) return { ok: false, reason: spent?.reason || 'spend-failed', balance: spent?.balance };
    const order = this.#newOrder({
      discordUserId: pending.discordUserId,
      economicIdentityId: pending.economicIdentityId,
      mcUuid: pending.mcUuid,
      sku: pending.sku,
      price: pending.price,
      source: 'mc-shop',
      nonce: pending.nonce,
      ledgerKey,
      lines: stackLines(pending.itemId, pending.qty),
      balance: spent.balance
    });
    return { ok: true, order, balance: spent.balance, ledgerKey };
  }

  async claimStarterKit({ discordUserId, accountCreatedAt, joinedAt } = {}) {
    if (!this.flags().starterKitEnabled) return { ok: false, reason: 'mc-starter-kit-disabled' };
    const discord = String(discordUserId || '').trim();
    const identity = await this.wallet.resolve(discord);
    const link = [...this.links.values()].find((row) => row.discordUserId === discord && row.verifiedAt);
    const lifetimeMs = identity ? Number(await this.wallet.lifetimeMs(identity.economicIdentityId)) : 0;
    const decision = starterKitEligibility({
      identityVerified: identity?.status === 'verified' && Boolean(identity?.verifiedAt),
      linkVerified: Boolean(link),
      premiumUuid: isPremiumUuid(link?.mcUuid),
      quarantined: Boolean(identity && await this.wallet.quarantined?.(identity.economicIdentityId)),
      disabled: identity?.status === 'disabled',
      accountCreatedAt,
      joinedAt,
      lifetimeMs,
      alreadyClaimedByIdentity: this.grants.some((grant) => grant.kind === 'starter_kit' && grant.economicIdentityId === identity?.economicIdentityId),
      alreadyClaimedByUuid: this.grants.some((grant) => grant.kind === 'starter_kit' && grant.mcUuid === link?.mcUuid),
      now: this.now()
    });
    if (!decision.ok) return decision;
    const lines = this.kit.items.flatMap((item) => stackLines(item.itemId, item.qty));
    const order = this.#newOrder({
      discordUserId: discord,
      economicIdentityId: identity.economicIdentityId,
      mcUuid: link.mcUuid,
      sku: 'starter_kit',
      price: 0,
      source: 'starter-kit',
      nonce: '',
      ledgerKey: '',
      lines
    });
    const grant = {
      kind: 'starter_kit',
      economicIdentityId: identity.economicIdentityId,
      mcUuid: link.mcUuid,
      kitVersion: this.kit.version,
      orderId: order.orderId,
      status: order.status,
      claimedAt: order.createdAt
    };
    this.grants.push(grant);
    return { ok: true, grant, order };
  }

  listGrants() {
    return this.grants.map((grant) => ({ ...grant, status: this.orders.get(grant.orderId)?.status || grant.status }));
  }

  claimNext(now = this.now()) {
    const order = [...this.orders.values()]
      .filter((row) => (row.status === 'PAID' || row.status === 'PLAYER_OFFLINE') && (!row.leaseUntil || Date.parse(row.leaseUntil) <= now))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
    if (!order) return null;
    order.leaseUntil = new Date(now + LEASE_MS).toISOString();
    return order;
  }

  pendingOrders() {
    return [...this.orders.values()].filter((order) => order.status === 'PAID' || order.status === 'PLAYER_OFFLINE');
  }

  markDelivery({ orderId, status, lineIndex = null, lineStatus = '', note = '' } = {}) {
    const order = this.orders.get(String(orderId || ''));
    if (!order) return { ok: false, reason: 'order-not-found' };
    if (order.status === 'SENT_UNCONFIRMED' && status !== 'DELIVERED') {
      return { ok: false, reason: 'unconfirmed-no-retry', order };
    }
    if (status === 'DELIVERED' && order.status === 'SENT_UNCONFIRMED') {
      order.status = 'DELIVERED';
      order.updatedAt = new Date(this.now()).toISOString();
      return { ok: true, order };
    }
    if (status === 'RESEND') {
      if (order.status !== 'DELIVERY_FAILED') return { ok: false, reason: 'resend-not-allowed', order };
      if (order.lines.some((line) => line.status === 'SENT_UNCONFIRMED')) return { ok: false, reason: 'unconfirmed-no-retry', order };
      order.status = 'PAID';
      order.leaseUntil = null;
      for (const line of order.lines) if (line.status === 'DELIVERY_FAILED') line.status = 'PENDING';
      return { ok: true, order };
    }
    const allowed = new Set(['PLAYER_OFFLINE', 'DELIVERY_IN_PROGRESS', 'DELIVERED', 'DELIVERY_FAILED', 'SENT_UNCONFIRMED']);
    if (!allowed.has(status)) return { ok: false, reason: 'invalid-status' };
    if (lineIndex != null) {
      const line = order.lines[lineIndex];
      if (!line) return { ok: false, reason: 'line-not-found' };
      if (line.status === 'DELIVERED' || line.status === 'SENT_UNCONFIRMED') return { ok: false, reason: 'line-frozen', order };
      line.status = lineStatus || status;
    }
    order.status = status;
    if (note) order.note = String(note).slice(0, 300);
    order.updatedAt = new Date(this.now()).toISOString();
    const grant = this.grants.find((row) => row.orderId === order.orderId);
    if (grant) grant.status = order.status;
    return { ok: true, order };
  }

  async refund({ orderId, reason = 'staff', actor = 'staff', writesEnabled = false, now = this.now() } = {}) {
    const order = this.orders.get(String(orderId || ''));
    if (!order) return { ok: false, reason: 'order-not-found' };
    if (order.status === 'REFUNDED' || order.refunded) return { ok: true, duplicate: true, order };
    const auto = reason === 'auto-14d' || reason === 'delivery-failed';
    if (auto && !this.#autoRefundable(order, reason, now)) return { ok: false, reason: 'refund-not-due', order };
    if (!auto && reason !== 'staff') return { ok: false, reason: 'refund-not-allowed' };
    if (Number(order.price) > 0) {
      if (!writesEnabled) return { ok: false, reason: 'economy-write-cutover-not-enabled' };
      const key = `mc-shop-refund:${order.orderId}`;
      const credited = await this.wallet.credit({
        discordUserId: order.discordUserId,
        amount: order.price,
        idempotencyKey: key,
        type: 'reversal',
        source: 'mc-shop',
        metadata: { reason, actor, orderId: order.orderId, sku: order.sku }
      });
      if (!credited?.ok) return { ok: false, reason: credited?.reason || 'refund-failed', order };
      order.ledgerRefundKey = key;
      order.balance = credited.balance;
    }
    order.refunded = true;
    order.status = 'REFUNDED';
    order.updatedAt = new Date(now).toISOString();
    const grant = this.grants.find((row) => row.orderId === order.orderId);
    if (grant) grant.status = 'REFUNDED';
    return { ok: true, order };
  }

  async sweepRefunds({ writesEnabled = false, now = this.now() } = {}) {
    const results = [];
    for (const order of this.orders.values()) {
      if (!this.#autoRefundable(order, 'auto-14d', now) && !(order.status === 'DELIVERY_FAILED' && this.#autoRefundable(order, 'delivery-failed', now))) continue;
      const reason = order.status === 'DELIVERY_FAILED' ? 'delivery-failed' : 'auto-14d';
      results.push(await this.refund({ orderId: order.orderId, reason, actor: 'auto', writesEnabled, now }));
    }
    return results;
  }

  #autoRefundable(order, reason, now) {
    if (order.refunded || order.status === 'REFUNDED' || order.status === 'DELIVERED' || order.status === 'SENT_UNCONFIRMED') return false;
    const sent = order.lines.some((line) => line.status === 'DELIVERED' || line.status === 'SENT_UNCONFIRMED');
    if (sent) return false;
    if (reason === 'delivery-failed') return order.status === 'DELIVERY_FAILED';
    if (reason === 'auto-14d') {
      return (order.status === 'PAID' || order.status === 'PLAYER_OFFLINE') && now - Date.parse(order.createdAt) >= REFUND_AFTER_MS;
    }
    return false;
  }

  #cooldownReason(discordUserId, mcUuid, now) {
    for (const link of this.links.values()) {
      const until = Date.parse(link.cooldownUntil || '');
      if (!Number.isFinite(until) || until <= now) continue;
      if (link.discordUserId === discordUserId || link.mcUuid === mcUuid) return 'unlink-cooldown';
    }
    return '';
  }

  #newOrder(input) {
    const now = new Date(this.now()).toISOString();
    const order = {
      orderId: `MC-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      discordUserId: input.discordUserId,
      economicIdentityId: input.economicIdentityId,
      mcUuid: input.mcUuid,
      sku: input.sku,
      price: input.price,
      source: input.source,
      nonce: input.nonce || '',
      ledgerKey: input.ledgerKey || '',
      status: 'PAID',
      lines: input.lines,
      createdAt: now,
      updatedAt: now,
      leaseUntil: null,
      refunded: false,
      balance: input.balance
    };
    this.orders.set(order.orderId, order);
    return order;
  }
}

module.exports = {
  LINK_CODE_TTL_MS,
  QUOTE_TTL_MS,
  UNLINK_COOLDOWN_MS,
  REFUND_AFTER_MS,
  LEASE_MS,
  hashCode,
  generateLinkCode,
  stackLines,
  MemoryMcPoints
};
