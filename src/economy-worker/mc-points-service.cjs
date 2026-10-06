'use strict';

const crypto = require('node:crypto');
const { mcPointsFlags } = require('../shared/mc-points-flags.cjs');
const { memberIdentityHold, linkElevationHold } = require('../sentinel/nexus-economy-identity-hold.cjs');
const {
  MAX_BUNDLES,
  MAX_PURCHASE_NP,
  MAX_DAILY_SPEND_NP,
  MAX_DAILY_ORDERS,
  catalogItem,
  catalogFingerprint,
  loadMcShopCatalog
} = require('../shared/mc-shop-catalog.cjs');
const { loadStarterKit, starterKitEligibility, discordAccountCreatedMs, guildJoinedAtMs } = require('../shared/mc-starter-kit.cjs');
const { refundStaffIds } = require('./mc-refund-auth.cjs');
const { ctDayKey } = require('./mc-playtime-accounting.cjs');
const { isPremiumUuid, normalizeUuid, itemIdOk } = require('../craft/mc-rcon-text.cjs');
const { withIdentityProof } = require('../sentinel/nexus-economy-identity-proof.cjs');

const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const QUOTE_TTL_MS = 120 * 1000;
const UNLINK_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const REFUND_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
const STAFF_REFUND_WINDOW_MS = 24 * 60 * 60 * 1000;
const LEASE_MS = 60 * 1000;
const LEASE_MAX_MS = 10 * 60 * 1000;
const OFFLINE_BACKOFF_MS = 30 * 1000;
const OFFLINE_BACKOFF_MAX_MS = 5 * 60 * 1000;
const CODE_ATTEMPT_LIMIT = 5;
const LINK_REQUESTS_PER_HOUR = 3;
const LINK_REQUEST_WINDOW_MS = 60 * 60 * 1000;
const STAFF_REFUND_DAILY_CAP = 10;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const FINAL_STATUSES = new Set(['REFUNDED', 'DELIVERED']);

const metrics = { dryRun: 0, buy: 0, refund: 0, claim: 0, leaseExpired: 0, giveUnconfirmed: 0, linkLocked: 0 };

function bumpMcMetric(name) {
  metrics[name] = Number(metrics[name] || 0) + 1;
}

function mcMetrics() {
  return { ...metrics };
}

function linkCodeSecret(env = process.env) {
  return String(env.MC_LINK_CODE_SECRET || '');
}

function hashCode(code, secret = linkCodeSecret()) {
  const key = String(secret || '');
  if (key.length < 32) return '';
  const normalized = String(code || '').trim().toUpperCase();
  return crypto.createHmac('sha256', key).update(normalized).digest('hex');
}

function generateLinkCode() {
  let raw = '';
  for (let index = 0; index < 6; index += 1) raw += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  return `${raw.slice(0, 3)}-${raw.slice(3)}`;
}

function verifiedDiscordIdentity(identity) {
  return Boolean(identity && identity.status === 'verified' && identity.verifiedAt);
}

function linkCandidate(identity) {
  if (verifiedDiscordIdentity(identity)) return true;
  if (!identity?.economicIdentityId) return false;
  const status = String(identity.status || '').trim().toLowerCase();
  return status === 'restricted' && !String(identity.holdReason || '').trim();
}

function mcFeatureIdentity(identity) {
  if (!identity) return false;
  const status = String(identity.status || '').trim().toLowerCase();
  if (status !== 'verified' && status !== 'restricted') return false;
  return !String(identity.holdReason || '').trim();
}

function activeMcLink(link) {
  return Boolean(link?.verifiedAt) && !link?.unlinkedAt;
}

function mcEarnEligible(identity, link) {
  // A verified Minecraft link that is still linked. Identity status stays where it was.
  return mcFeatureIdentity(identity) && activeMcLink(link) && isPremiumUuid(link.mcUuid);
}

function mcPlaytimeEligible(identity, link) {
  return mcEarnEligible(identity, link);
}

function quoteIdentityHold(identity, env) {
  if (!identity || !String(identity.status || '').trim()) {
    return memberIdentityHold({
      missingRow: true,
      economicIdentityId: identity?.economicIdentityId,
      env
    });
  }
  return memberIdentityHold({
    status: identity.status,
    holdReason: identity.holdReason,
    economicIdentityId: identity.economicIdentityId,
    env
  });
}

function leaseMsForOrder(order) {
  const remaining = (order?.lines || []).filter((line) => line.status !== 'DELIVERED' && line.status !== 'SENT_UNCONFIRMED').length;
  return Math.min(Math.max(1, remaining) * LEASE_MS, LEASE_MAX_MS);
}

function offlineBackoffMs(attempts) {
  const step = Math.max(1, Number(attempts) || 1);
  return Math.min(OFFLINE_BACKOFF_MS * step, OFFLINE_BACKOFF_MAX_MS);
}

function isMinecraftShopOrder(order) {
  if (!order || typeof order !== 'object') return false;
  const source = String(order.source || '');
  if (source === 'mc-shop' || source === 'starter-kit' || source === 'sink:mc-shop') return true;
  if (order.provider === 'minecraft' || order.game === 'minecraft') return true;
  if (order.mcUuid) return true;
  return false;
}

function stackLines(itemId, total) {
  if (!itemIdOk(itemId)) throw new Error('invalid-item-id');
  const lines = [];
  let left = Number(total);
  if (!Number.isSafeInteger(left) || left <= 0) throw new Error('invalid-qty');
  while (left > 0) {
    const count = Math.min(64, left);
    lines.push({ itemId, count, status: 'PENDING' });
    left -= count;
  }
  return lines;
}

function orderLineHash(version, lines) {
  const body = [version, ...(lines || []).map((line) => `${line.itemId}:${line.count}`)].join('\n');
  return crypto.createHash('sha256').update(body).digest('hex');
}

function quotePayload(quote) {
  return JSON.stringify([
    'mc-quote-v1',
    quote.discordUserId,
    quote.sku,
    quote.bundles,
    quote.price,
    quote.nonce,
    quote.catalogVersion,
    quote.catalogHash,
    quote.itemId,
    quote.expiresAt
  ]);
}

function signQuote(quote, secret) {
  if (typeof secret !== 'string' || secret.length < 32) return '';
  return crypto.createHmac('sha256', secret).update(quotePayload(quote)).digest('hex');
}

function quoteSignatureOk(quote, secret) {
  const expected = signQuote(quote, secret);
  if (!expected) return true;
  const actual = String(quote?.signature || '');
  if (!/^[a-f0-9]{64}$/.test(actual)) return false;
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function dayOrders(orders, economicIdentityId, nowMs) {
  const day = ctDayKey(nowMs);
  const identity = String(economicIdentityId || '');
  return orders.filter((order) => order.source === 'mc-shop' && order.economicIdentityId === identity && ctDayKey(Date.parse(order.createdAt)) === day && order.status !== 'REFUNDED');
}

function linesSent(order) {
  return (order?.lines || []).some((line) => line.status === 'DELIVERED' || line.status === 'SENT_UNCONFIRMED');
}

function quoteSecret(env = process.env) {
  return String(env.NEXUS_ECONOMY_IDENTITY_PROOF_SECRET || env.MC_SHOP_QUOTE_SECRET || '');
}

function assertMcLinkCodeSecret(env = process.env) {
  if (!mcPointsFlags(env).pointsEnabled) return { ok: true };
  if (String(env.MC_LINK_CODE_SECRET || '').length >= 32) return { ok: true };
  const message = 'MC_LINK_CODE_SECRET must be at least 32 characters when Minecraft Points are enabled.';
  console.error(`[Nexus Economy Worker] ${message} Minecraft routes are disabled. The rest of the worker, including /wallet/credit, stays up.`);
  return { ok: false, code: 'link-code-secret-missing' };
}

class MemoryMcPoints {
  constructor({ now = () => Date.now(), wallet, env = process.env, catalog, kit, createOrderId, tenureOf, fetchImpl } = {}) {
    if (!wallet) throw new Error('Minecraft points service requires a wallet.');
    this.now = now;
    this.wallet = wallet;
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.catalog = catalog || loadMcShopCatalog(env);
    this.kit = kit || loadStarterKit(env);
    this.createOrderId = createOrderId || (() => crypto.randomUUID());
    this.tenureOf = tenureOf || null;
    this.links = new Map();
    this.challenges = new Map();
    this.orders = new Map();
    this.grants = [];
    this.quotes = new Map();
    this.outbox = new Map();
    this.audits = [];
    this.actionAudits = [];
    this.linkRequests = [];
    this.crashAt = '';
  }

  #audit({ action, actor, reason, result, subject } = {}) {
    const reasonText = String(reason ?? '')
      .replace(/[A-Z0-9]{3}-[A-Z0-9]{3}/g, '')
      .replace(/\b[a-f0-9]{16,}\b/g, '')
      .slice(0, 120);
    const row = {
      auditId: crypto.randomUUID(),
      action: String(action || '').slice(0, 40),
      actor: String(actor || '').replace(/\s/g, '').slice(0, 32),
      reason: reasonText,
      result: String(result || '').slice(0, 64),
      subject: String(subject || '').slice(0, 64),
      createdAt: new Date(this.now()).toISOString()
    };
    this.actionAudits.push(row);
    return row;
  }

  flags() {
    return mcPointsFlags(this.env);
  }

  async challenge({ discordUserId, mcUuid, mcName, requesterName } = {}) {
    if (!this.flags().pointsEnabled) return { ok: false, reason: 'mc-points-disabled' };
    if (linkCodeSecret(this.env).length < 32) return { ok: false, reason: 'link-code-secret-missing' };
    const uuid = normalizeUuid(mcUuid);
    if (!isPremiumUuid(uuid)) return { ok: false, reason: 'uuid-not-premium' };
    const discord = String(discordUserId || '').trim();
    if (!/^\d{5,32}$/.test(discord)) return { ok: false, reason: 'discord-user-required' };
    const prepared = await this.#identityForLink(discord);
    if (!prepared.ok) return { ok: false, reason: prepared.reason, message: prepared.message };
    const identity = prepared.identity;
    const opensLink = typeof this.wallet.ensureMinecraftMember === 'function' ? linkCandidate(identity) : verifiedDiscordIdentity(identity);
    if (!opensLink) return { ok: false, reason: 'verified-identity-required' };
    const now = this.now();
    const blocked = this.#cooldownReason(discord, uuid, now);
    if (blocked) return { ok: false, reason: blocked };
    const pending = this.challenges.get(discord);
    if (pending?.locked && pending.expiresAt > now) {
      bumpMcMetric('linkLocked');
      return { ok: false, reason: 'code-locked' };
    }
    const recentUuid = this.linkRequests.filter((row) => row.mcUuid === uuid && now - row.at < LINK_REQUEST_WINDOW_MS);
    const recentDiscord = this.linkRequests.filter((row) => row.discordUserId === discord && now - row.at < LINK_REQUEST_WINDOW_MS);
    if (recentUuid.length >= LINK_REQUESTS_PER_HOUR || recentDiscord.length >= LINK_REQUESTS_PER_HOUR) return { ok: false, reason: 'link-rate-limited' };
    const code = generateLinkCode();
    this.linkRequests.push({ mcUuid: uuid, discordUserId: discord, at: now });
    this.challenges.set(discord, {
      discordUserId: discord,
      mcUuid: uuid,
      mcName: String(mcName || '').slice(0, 16),
      requesterName: String(requesterName || discord).slice(0, 32),
      codeHash: hashCode(code, linkCodeSecret(this.env)),
      expiresAt: now + LINK_CODE_TTL_MS,
      economicIdentityId: identity.economicIdentityId,
      attempts: 0,
      locked: false,
      used: false
    });
    return { ok: true, code, expiresInSec: LINK_CODE_TTL_MS / 1000, mcUuid: uuid, requesterName: String(requesterName || discord).slice(0, 32) };
  }

  async confirm({ discordUserId, code } = {}) {
    if (!this.flags().pointsEnabled) return { ok: false, reason: 'mc-points-disabled' };
    const discord = String(discordUserId || '').trim();
    const pending = this.challenges.get(discord);
    const now = this.now();
    if (!pending || pending.used || pending.expiresAt <= now) return { ok: false, reason: 'code-expired' };
    if (linkCodeSecret(this.env).length < 32) return { ok: false, reason: 'link-code-secret-missing' };
    if (pending.locked || pending.attempts >= CODE_ATTEMPT_LIMIT) {
      pending.locked = true;
      bumpMcMetric('linkLocked');
      this.#audit({ action: 'link', actor: discord, reason: 'confirm', result: 'code-locked', subject: pending.mcUuid });
      return { ok: false, reason: 'code-locked' };
    }
    const supplied = hashCode(code, linkCodeSecret(this.env));
    const expected = Buffer.from(String(pending.codeHash || ''));
    const actual = Buffer.from(supplied);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      pending.attempts += 1;
      if (pending.attempts >= CODE_ATTEMPT_LIMIT) {
        pending.locked = true;
        bumpMcMetric('linkLocked');
        this.#audit({ action: 'link', actor: discord, reason: 'confirm', result: 'code-locked', subject: pending.mcUuid });
        return { ok: false, reason: 'code-locked' };
      }
      this.#audit({ action: 'link', actor: discord, reason: 'confirm', result: 'code-mismatch', subject: pending.mcUuid });
      return { ok: false, reason: 'code-mismatch' };
    }
    const prepared = await this.#identityForLink(discord);
    if (!prepared.ok || prepared.identity.economicIdentityId !== pending.economicIdentityId) {
      const reason = prepared.ok ? 'verified-identity-required' : prepared.reason;
      this.#audit({ action: 'link', actor: discord, reason: 'confirm', result: reason, subject: pending.mcUuid });
      return { ok: false, reason, message: prepared.message, commitStamp: prepared.commitStamp === true };
    }
    const opensLink = typeof this.wallet.ensureMinecraftMember === 'function' ? linkCandidate(prepared.identity) : verifiedDiscordIdentity(prepared.identity);
    if (!opensLink) {
      this.#audit({ action: 'link', actor: discord, reason: 'confirm', result: 'verified-identity-required', subject: pending.mcUuid });
      return { ok: false, reason: 'verified-identity-required' };
    }
    const blocked = this.#cooldownReason(discord, pending.mcUuid, now);
    if (blocked) {
      this.#audit({ action: 'link', actor: discord, reason: 'confirm', result: blocked, subject: pending.mcUuid });
      return { ok: false, reason: blocked };
    }
    const taken = [...this.links.values()].find((link) => link.mcUuid === pending.mcUuid && activeMcLink(link) && link.discordUserId !== discord);
    if (taken) {
      this.#audit({ action: 'link', actor: discord, reason: 'confirm', result: 'uuid-taken', subject: pending.mcUuid });
      return { ok: false, reason: 'uuid-taken' };
    }
    const own = [...this.links.values()].find((link) => link.economicIdentityId === prepared.identity.economicIdentityId && activeMcLink(link) && link.mcUuid !== pending.mcUuid);
    if (own) {
      this.#audit({ action: 'link', actor: discord, reason: 'confirm', result: 'already-linked', subject: pending.mcUuid });
      return { ok: false, reason: 'already-linked' };
    }
    const identity = prepared.identity;
    const verifiedAt = new Date(now).toISOString();
    const link = {
      mcUuid: pending.mcUuid,
      discordUserId: discord,
      economicIdentityId: identity.economicIdentityId,
      verifiedAt,
      unlinkedAt: null,
      cooldownUntil: null,
      playtimeMs: this.links.get(pending.mcUuid)?.playtimeMs || 0,
      proof: null
    };
    const secret = quoteSecret(this.env);
    if (secret.length >= 32) {
      const signed = withIdentityProof(
        { discordUserId: discord, eosId: pending.mcUuid },
        { verifiedAt },
        { secret, now }
      );
      link.proof = {
        discordUserId: signed.discordUserId,
        eosId: signed.eosId,
        verifiedAt: signed.verifiedAt,
        issuedAt: signed.issuedAt,
        proof: signed.proof
      };
    }
    const wrote = this.#putLink(link);
    if (!wrote) return { ok: false, reason: 'uuid-taken' };
    pending.used = true;
    this.challenges.delete(discord);
    this.#audit({ action: 'link', actor: discord, reason: 'confirm', result: 'ok', subject: pending.mcUuid });
    return { ok: true, mcUuid: pending.mcUuid, economicIdentityId: identity.economicIdentityId, proof: link.proof };
  }

  #putLink(link) {
    const existing = this.links.get(link.mcUuid);
    if (activeMcLink(existing) && existing.economicIdentityId !== link.economicIdentityId) return false;
    if (activeMcLink(existing) && existing.discordUserId !== link.discordUserId) return false;
    this.links.set(link.mcUuid, link);
    return true;
  }

  async unlink({ discordUserId, actor = '', reason = '' } = {}) {
    if (!this.flags().pointsEnabled) return { ok: false, reason: 'mc-points-disabled' };
    const discord = String(discordUserId || '').trim();
    const staffActor = String(actor || '').trim();
    const staffRevoke = Boolean(staffActor) && staffActor !== discord;
    const link = [...this.links.values()].find((row) => row.discordUserId === discord && activeMcLink(row));
    if (staffRevoke && !this.#staffAllowed(staffActor, { discordUserId: discord })) {
      this.#audit({ action: 'staff-revoke', actor: staffActor, reason: 'staff-revoke', result: 'staff-not-authorized', subject: link?.mcUuid || discord });
      return { ok: false, reason: 'staff-not-authorized' };
    }
    if (!link) {
      this.#audit({ action: staffRevoke ? 'staff-revoke' : 'unlink', actor: staffRevoke ? staffActor : discord, reason: staffRevoke ? 'staff-revoke' : 'unlink', result: 'not-linked', subject: discord });
      return { ok: false, reason: 'not-linked' };
    }
    const now = this.now();
    link.verifiedAt = null;
    link.unlinkedAt = new Date(now).toISOString();
    link.cooldownUntil = new Date(now + UNLINK_COOLDOWN_MS).toISOString();
    link.proof = null;
    this.#audit({
      action: staffRevoke ? 'staff-revoke' : 'unlink',
      actor: staffRevoke ? staffActor : discord,
      reason: staffRevoke ? (String(reason || 'staff-revoke').trim() || 'staff-revoke') : 'unlink',
      result: 'ok',
      subject: link.mcUuid
    });
    return { ok: true, cooldownUntil: link.cooldownUntil, mcUuid: link.mcUuid };
  }

  async status({ discordUserId } = {}) {
    const discord = String(discordUserId || '').trim();
    const link = [...this.links.values()].find((row) => row.discordUserId === discord && activeMcLink(row));
    const cooling = [...this.links.values()].find((row) => (row.discordUserId === discord || row.mcUuid === link?.mcUuid) && row.cooldownUntil && Date.parse(row.cooldownUntil) > this.now());
    return { ok: true, linked: Boolean(link), mcUuid: link?.mcUuid || '', cooldownUntil: cooling?.cooldownUntil || null };
  }

  linkByUuid(mcUuid) {
    const link = this.links.get(normalizeUuid(mcUuid));
    if (!activeMcLink(link)) return null;
    return link;
  }

  async quote({ discordUserId, sku, bundles = 1 } = {}) {
    if (!this.flags().shopEnabled) return { ok: false, reason: 'mc-shop-disabled' };
    const discord = String(discordUserId || '').trim();
    const identity = await this.wallet.resolve(discord);
    const held = quoteIdentityHold(identity, this.env);
    if (held) return held;
    const link = [...this.links.values()].find((row) => row.discordUserId === discord && activeMcLink(row));
    if (!mcEarnEligible(identity, link)) {
      return { ok: false, reason: verifiedDiscordIdentity(identity) ? 'verified-minecraft-link-required' : 'verified-identity-required' };
    }
    if (await this.wallet.quarantined?.(identity.economicIdentityId)) return { ok: false, reason: 'quarantined' };
    const item = catalogItem(this.catalog, String(sku || ''));
    if (!item) return { ok: false, reason: 'unknown-sku' };
    if (!Number.isSafeInteger(item.qty) || item.qty <= 0) return { ok: false, reason: 'invalid-qty' };
    const count = Number(bundles);
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_BUNDLES) return { ok: false, reason: 'bundle-limit' };
    const price = item.price * count;
    if (price <= 0 || price > MAX_PURCHASE_NP) return { ok: false, reason: 'price-limit' };
    const balance = Number(await this.wallet.balance(discord));
    const nonce = crypto.randomBytes(16).toString('hex');
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
      catalogHash: catalogFingerprint(this.catalog),
      expiresAt: this.now() + QUOTE_TTL_MS,
      balance,
      balanceAfter: balance - price,
      consumed: false
    };
    quote.signature = signQuote(quote, quoteSecret(this.env));
    this.quotes.set(nonce, quote);
    return { ok: true, quote: { ...quote, dryRun: this.flags().shopDryRun } };
  }

  async buy({ discordUserId, sku, bundles = 1, nonce, writesEnabled = false } = {}) {
    if (!this.flags().shopDryRun && !writesEnabled) return { ok: false, reason: 'economy-write-cutover-not-enabled' };
    if (!this.flags().shopEnabled) return { ok: false, reason: 'mc-shop-disabled' };
    const pending = this.quotes.get(String(nonce || ''));
    const now = this.now();
    if (!pending || pending.expiresAt <= now) return { ok: false, reason: 'quote-expired' };
    if (!quoteSignatureOk(pending, quoteSecret(this.env))) return { ok: false, reason: 'quote-invalid' };
    const discord = String(discordUserId || '').trim();
    if (pending.discordUserId !== discord) return { ok: false, reason: 'subject-mismatch' };
    if (pending.sku !== sku || pending.bundles !== Number(bundles)) return { ok: false, reason: 'quote-mismatch' };
    const existing = [...this.orders.values()].find((order) => order.nonce === pending.nonce);
    if (existing) return { ok: true, duplicate: true, order: existing };
    const item = catalogItem(this.catalog, pending.sku);
    if (!item) return { ok: false, reason: 'unknown-sku' };
    if (!Number.isSafeInteger(item.qty) || item.qty <= 0) return { ok: false, reason: 'invalid-qty' };
    const price = item.price * pending.bundles;
    if (price !== pending.price || item.itemId !== pending.itemId) return { ok: false, reason: 'price-changed' };
    if (await this.wallet.quarantined?.(pending.economicIdentityId)) return { ok: false, reason: 'quarantined' };
    if (this.flags().shopDryRun) {
      const identity = await this.wallet.resolve(discord);
      const hold = memberIdentityHold({
        status: identity?.status,
        holdReason: identity?.holdReason,
        missingRow: !identity || !String(identity.status || '').trim(),
        economicIdentityId: identity?.economicIdentityId || pending.economicIdentityId,
        env: this.env
      });
      if (hold) return hold;
      const balance = Number(await this.wallet.balance(discord));
      console.info(`[Nexus Economy] mc_shop_dry_run discord=${discord} sku=${pending.sku} price=${price}`);
      return {
        ok: true,
        dryRun: true,
        debited: false,
        balance,
        receipt: {
          sku: pending.sku,
          bundles: pending.bundles,
          price,
          balance,
          balanceAfter: balance
        }
      };
    }
    const today = dayOrders([...this.orders.values()], pending.economicIdentityId, now);
    if (today.length >= MAX_DAILY_ORDERS) return { ok: false, reason: 'daily-order-limit' };
    const spentToday = today.reduce((sum, order) => sum + Number(order.price || 0), 0);
    if (spentToday + price > MAX_DAILY_SPEND_NP) return { ok: false, reason: 'daily-spend-limit' };
    if (item.dailyLimit) {
      const skuCount = today.filter((order) => order.sku === pending.sku).reduce((sum, order) => sum + Number(order.bundles || 0), 0);
      if (skuCount + pending.bundles > item.dailyLimit) return { ok: false, reason: 'sku-daily-limit' };
    }
    const ledgerKey = `mc-shop:${pending.economicIdentityId}:${pending.sku}:${pending.nonce}`;
    const lines = stackLines(item.itemId, item.qty * pending.bundles);
    const orderId = this.createOrderId();
    const balanceMark = this.wallet.balanceValue;
    const callMark = Array.isArray(this.wallet.calls) ? this.wallet.calls.length : null;
    const spendInput = {
      discordUserId: pending.discordUserId,
      amount: price,
      orderId: ledgerKey,
      idempotencyKey: ledgerKey,
      source: 'sink:mc-shop',
      metadata: { sku: pending.sku, qty: lines.reduce((sum, line) => sum + line.count, 0), catalogVersion: pending.catalogVersion, price }
    };
    const spent = typeof this.wallet.spendMinecraftShop === 'function'
      ? await this.wallet.spendMinecraftShop(spendInput)
      : await this.wallet.spend(spendInput);
    if (!spent?.ok) return { ok: false, reason: spent?.reason || 'spend-failed', message: spent?.message, balance: spent?.balance };
    const replay = spent.duplicate === true;
    try {
      if (!replay && this.crashAt === 'after-ledger') {
        this.crashAt = '';
        const error = new Error('crash');
        error.code = 'mc-buy-crash';
        throw error;
      }
      if (this.orders.has(orderId) || this.outbox.has(orderId)) {
        const error = new Error('duplicate-order-id');
        error.code = 'duplicate-order-id';
        throw error;
      }
      const order = this.#insertOrder({
        orderId,
        discordUserId: pending.discordUserId,
        economicIdentityId: pending.economicIdentityId,
        mcUuid: pending.mcUuid,
        sku: pending.sku,
        bundles: pending.bundles,
        price,
        source: 'mc-shop',
        nonce: pending.nonce,
        ledgerKey,
        lines,
        balance: spent.balance,
        catalogVersion: pending.catalogVersion,
        catalogHash: orderLineHash(pending.catalogVersion, lines)
      });
      this.outbox.set(order.orderId, { outboxId: order.orderId, orderId: order.orderId, createdAt: order.createdAt });
      pending.consumed = true;
      bumpMcMetric('buy');
      return { ok: true, order, balance: spent.balance, ledgerKey, replayed: replay };
    } catch (error) {
      if (replay) {
        if (error.code === 'duplicate-order-id') return { ok: false, reason: 'duplicate-order-id' };
        throw error;
      }
      await this.wallet.credit?.({
        discordUserId: pending.discordUserId,
        amount: price,
        idempotencyKey: `${ledgerKey}:rollback`,
        type: 'reversal',
        source: 'mc-shop',
        metadata: { reason: 'purchase-rollback', orderId }
      }, { minecraftPurchaseRollback: true });
      if (typeof balanceMark === 'number') this.wallet.balanceValue = balanceMark;
      if (callMark != null && Array.isArray(this.wallet.calls)) this.wallet.calls.length = callMark;
      if (error.code === 'duplicate-order-id') return { ok: false, reason: 'duplicate-order-id' };
      if (error.code === 'mc-buy-crash') return { ok: false, reason: 'rolled-back' };
      throw error;
    }
  }

  async claimStarterKit({ discordUserId, tenureOf: tenureOverride } = {}) {
    if (!this.flags().starterKitEnabled) return { ok: false, reason: 'mc-starter-kit-disabled' };
    const discord = String(discordUserId || '').trim();
    const identity = await this.wallet.resolve(discord);
    const held = quoteIdentityHold(identity, this.env);
    if (held) return held;
    const link = [...this.links.values()].find((row) => row.discordUserId === discord && activeMcLink(row));
    if (!mcEarnEligible(identity, link)) {
      return { ok: false, reason: verifiedDiscordIdentity(identity) ? 'verified-minecraft-link-required' : 'verified-identity-required' };
    }
    const existing = this.grants.find((grant) => grant.kind === 'starter_kit' && (grant.economicIdentityId === identity.economicIdentityId || grant.mcUuid === link.mcUuid));
    if (existing) {
      this.#audit({ action: 'kit-claim', actor: discord, reason: 'starter-kit', result: 'duplicate', subject: link.mcUuid });
      return { ok: true, duplicate: true, grant: existing, order: this.orders.get(existing.orderId) || null };
    }
    const accountCreatedAt = discordAccountCreatedMs(discord);
    const lookup = typeof tenureOverride === 'function' ? tenureOverride : this.tenureOf;
    const tenureAt = typeof lookup === 'function'
      ? Number(await lookup(discord))
      : Number(await guildJoinedAtMs(discord, this.env, this.fetchImpl));
    const lifetimeMs = Number(link.playtimeMs || 0);
    const decision = starterKitEligibility({
      identityVerified: true,
      linkVerified: true,
      premiumUuid: true,
      quarantined: Boolean(await this.wallet.quarantined?.(identity.economicIdentityId)),
      disabled: identity.status === 'disabled',
      accountCreatedAt,
      joinedAt: tenureAt,
      lifetimeMs,
      alreadyClaimedByIdentity: false,
      alreadyClaimedByUuid: false,
      now: this.now()
    });
    if (!decision.ok) {
      this.#audit({ action: 'kit-claim', actor: discord, reason: 'starter-kit', result: decision.reason, subject: link.mcUuid });
      return decision;
    }
    const lines = this.kit.items.flatMap((item) => stackLines(item.itemId, item.qty));
    const order = this.#insertOrder({
      discordUserId: discord,
      economicIdentityId: identity.economicIdentityId,
      mcUuid: link.mcUuid,
      sku: 'starter_kit',
      price: 0,
      source: 'starter-kit',
      nonce: '',
      ledgerKey: '',
      lines,
      catalogVersion: this.kit.version,
      catalogHash: orderLineHash(this.kit.version, lines)
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
    const identityTaken = this.grants.some((row) => row.kind === grant.kind && row.economicIdentityId === grant.economicIdentityId);
    const uuidTaken = this.grants.some((row) => row.kind === grant.kind && row.mcUuid === grant.mcUuid);
    if (identityTaken || uuidTaken) {
      this.orders.delete(order.orderId);
      const prior = this.grants.find((row) => row.kind === grant.kind && (row.economicIdentityId === grant.economicIdentityId || row.mcUuid === grant.mcUuid));
      return { ok: true, duplicate: true, grant: prior, order: this.orders.get(prior.orderId) || null };
    }
    this.grants.push(grant);
    this.outbox.set(order.orderId, { outboxId: order.orderId, orderId: order.orderId, createdAt: order.createdAt });
    this.#audit({ action: 'kit-claim', actor: discord, reason: 'starter-kit', result: 'ok', subject: link.mcUuid });
    return { ok: true, grant, order };
  }

  async staffResend({ orderId, actor = '', reason = '' } = {}) {
    const staff = String(actor || '').trim();
    const why = String(reason || '').trim();
    const order = this.orders.get(String(orderId || ''));
    const deny = (result) => {
      this.#audit({ action: 'resend', actor: staff, reason: why || 'resend', result, subject: order?.orderId || String(orderId || '') });
      return { ok: false, reason: result };
    };
    if (!order) return deny('order-not-found');
    if (!this.#staffAllowed(staff, order)) return deny('staff-not-authorized');
    if (why.length < 3) return deny('reason-required');
    if (order.status === 'SENT_UNCONFIRMED' || order.lines.some((line) => line.status === 'SENT_UNCONFIRMED') || linesSent(order)) {
      return deny('unconfirmed-no-retry');
    }
    if (order.status !== 'DELIVERY_FAILED') return deny('resend-not-allowed');
    order.status = 'PAID';
    order.leaseToken = null;
    order.leaseOwner = null;
    order.leaseUntil = null;
    order.updatedAt = new Date(this.now()).toISOString();
    this.#audit({ action: 'resend', actor: staff, reason: why, result: 'ok', subject: order.orderId });
    return { ok: true, order };
  }

  async staffResolve({ orderId, actor = '', reason = '', resolution = '' } = {}) {
    const staff = String(actor || '').trim();
    const why = String(reason || '').trim();
    const order = this.orders.get(String(orderId || ''));
    const deny = (result) => {
      this.#audit({ action: 'staff-resolve', actor: staff, reason: why || 'resolve', result, subject: order?.orderId || String(orderId || '') });
      return { ok: false, reason: result };
    };
    if (!order) return deny('order-not-found');
    if (!this.#staffAllowed(staff, order)) return deny('staff-not-authorized');
    if (why.length < 3) return deny('reason-required');
    if (FINAL_STATUSES.has(order.status)) return deny('final-status');
    if (resolution !== 'delivered' && resolution !== 'unconfirmed') return deny('invalid-resolution');
    if (resolution === 'delivered') {
      order.status = 'DELIVERED';
      for (const line of order.lines) line.status = 'DELIVERED';
    } else {
      order.status = 'SENT_UNCONFIRMED';
      for (const line of order.lines) {
        if (line.status !== 'DELIVERED') line.status = 'SENT_UNCONFIRMED';
      }
    }
    order.leaseToken = null;
    order.leaseOwner = null;
    order.leaseUntil = null;
    order.updatedAt = new Date(this.now()).toISOString();
    this.#audit({ action: 'staff-resolve', actor: staff, reason: why, result: 'ok', subject: order.orderId });
    return { ok: true, order };
  }

  listGrants() {
    return this.grants.map((grant) => ({ ...grant, status: this.orders.get(grant.orderId)?.status || grant.status }));
  }

  sweepExpiredLeases(now = this.now()) {
    const expired = [];
    for (const order of this.orders.values()) {
      if (order.status !== 'DELIVERY_IN_PROGRESS') continue;
      if (!order.leaseUntil || Date.parse(order.leaseUntil) > now) continue;
      order.status = 'SENT_UNCONFIRMED';
      order.leaseToken = null;
      order.leaseOwner = null;
      order.leaseUntil = null;
      order.updatedAt = new Date(now).toISOString();
      for (const line of order.lines) {
        if (line.status !== 'DELIVERED') line.status = 'SENT_UNCONFIRMED';
      }
      bumpMcMetric('leaseExpired');
      console.warn(`[Nexus Economy] mc_lease_expired order=${order.orderId} status=SENT_UNCONFIRMED`);
      expired.push(order.orderId);
    }
    return expired;
  }

  claimNext({ owner = 'nexus-craft', now = this.now() } = {}) {
    if (!this.flags().shopDeliveryEnabled) return null;
    this.sweepExpiredLeases(now);
    const order = [...this.orders.values()]
      .filter((row) => (row.status === 'PAID' || row.status === 'PLAYER_OFFLINE') && !this.#leaseLive(row, now))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
    if (!order) return null;
    order.status = 'DELIVERY_IN_PROGRESS';
    order.leaseToken = crypto.randomUUID();
    order.leaseOwner = String(owner || 'nexus-craft').slice(0, 64);
    order.leaseUntil = new Date(now + leaseMsForOrder(order)).toISOString();
    order.updatedAt = new Date(now).toISOString();
    bumpMcMetric('claim');
    return order;
  }

  pendingOrders() {
    this.sweepExpiredLeases(this.now());
    return [...this.orders.values()].filter((order) => order.status === 'PAID' || order.status === 'PLAYER_OFFLINE' || order.status === 'DELIVERY_IN_PROGRESS');
  }

  markDelivery({ orderId, status, leaseToken = '', expectedStatus = '', lineIndex = null, lineStatus = '', note = '' } = {}) {
    if (!this.flags().shopDeliveryEnabled) return { ok: false, reason: 'mc-shop-delivery-disabled' };
    const order = this.orders.get(String(orderId || ''));
    if (!order) return { ok: false, reason: 'order-not-found' };
    if (FINAL_STATUSES.has(order.status)) return { ok: false, reason: 'final-status', order };
    if (!expectedStatus || order.status !== expectedStatus) return { ok: false, reason: 'illegal-transition', order };
    if (!order.leaseToken || order.leaseToken !== leaseToken) return { ok: false, reason: 'lease-lost', order };
    if (lineIndex != null) {
      const line = order.lines[lineIndex];
      if (!line) return { ok: false, reason: 'line-not-found' };
      if (line.status === 'DELIVERED') return { ok: true, order };
      if (line.status === 'SENT_UNCONFIRMED' && lineStatus !== 'SENT_UNCONFIRMED') return { ok: false, reason: 'unconfirmed-no-retry', order };
      line.status = lineStatus || status;
    }
    if (status === 'PLAYER_OFFLINE') {
      if (linesSent(order)) return this.#freezeUnconfirmed(order, note);
      order.status = 'PLAYER_OFFLINE';
      order.offlineAttempts = Number(order.offlineAttempts || 0) + 1;
      order.leaseToken = null;
      order.leaseOwner = null;
      order.leaseUntil = new Date(this.now() + offlineBackoffMs(order.offlineAttempts)).toISOString();
    } else if (status === 'SENT_UNCONFIRMED') {
      return this.#freezeUnconfirmed(order, note);
    } else if (status === 'DELIVERED') {
      if (order.lines.some((line) => line.status !== 'DELIVERED')) return { ok: false, reason: 'illegal-transition', order };
      order.status = 'DELIVERED';
      order.offlineAttempts = 0;
    } else if (status === 'DELIVERY_IN_PROGRESS') {
      order.status = 'DELIVERY_IN_PROGRESS';
      if (lineStatus === 'DELIVERED') order.offlineAttempts = 0;
      order.leaseUntil = new Date(this.now() + leaseMsForOrder(order)).toISOString();
    } else if (status === 'DELIVERY_FAILED') {
      if (linesSent(order)) return this.#freezeUnconfirmed(order, note);
      order.status = 'DELIVERY_FAILED';
      order.leaseToken = null;
      order.leaseOwner = null;
      order.leaseUntil = null;
    } else {
      return { ok: false, reason: 'invalid-status', order };
    }
    if (note) order.note = String(note).slice(0, 300);
    order.updatedAt = new Date(this.now()).toISOString();
    const grant = this.grants.find((row) => row.orderId === order.orderId);
    if (grant) grant.status = order.status;
    return { ok: true, order };
  }

  #freezeUnconfirmed(order, note) {
    order.status = 'SENT_UNCONFIRMED';
    for (const line of order.lines) {
      if (line.status !== 'DELIVERED') line.status = 'SENT_UNCONFIRMED';
    }
    order.leaseToken = null;
    order.leaseOwner = null;
    order.leaseUntil = null;
    if (note) order.note = String(note).slice(0, 300);
    order.updatedAt = new Date(this.now()).toISOString();
    bumpMcMetric('giveUnconfirmed');
    return { ok: true, order };
  }

  #leaseLive(order, now) {
    return Boolean(order.leaseUntil && Date.parse(order.leaseUntil) > now);
  }

  async #orderHold(order) {
    if (typeof this.wallet.resolve !== 'function') return null;
    const identity = await this.wallet.resolve(order.discordUserId);
    if (!identity || !String(identity.status || '').trim()) {
      return memberIdentityHold({
        missingRow: true,
        economicIdentityId: identity?.economicIdentityId || order.economicIdentityId,
        env: this.env
      });
    }
    return memberIdentityHold({
      status: identity.status,
      holdReason: identity.holdReason,
      economicIdentityId: identity.economicIdentityId || order.economicIdentityId,
      env: this.env
    });
  }

  async refundPreview(input = {}) {
    return this.refund({ ...input, preview: true, applyWallet: false });
  }

  async refund({ orderId, reason = '', actor = '', writesEnabled = false, now = this.now(), applyWallet = true, deferHold = false, force = false, staffAuthorized = false, preview = false, windowChecked = false, capChecked = false } = {}) {
    const order = this.orders.get(String(orderId || ''));
    if (!order) return { ok: false, reason: 'order-not-found' };
    if (order.status === 'REFUNDED' || order.refunded) return { ok: true, duplicate: true, order };
    if (order.status === 'DELIVERED') return { ok: false, reason: 'final-status', order };
    const auto = reason === 'auto-14d';
    const staffActor = String(actor || '').trim();
    const hold = deferHold ? null : await this.#orderHold(order);
    if (!auto) {
      const actorIdentity = await this.#refundActorIdentity(staffActor);
      if (actorIdentity.unresolved) return { ok: false, reason: 'staff-unlinked', order };
      if (staffActor === order.discordUserId || (actorIdentity.econId && actorIdentity.econId === order.economicIdentityId)) {
        if (hold) return { ...hold, order };
        return { ok: false, reason: 'staff-not-authorized', order };
      }
    }
    if (auto && hold) return { ...hold, order };
    if (auto) {
      if (!this.#autoRefundable(order, now)) return { ok: false, reason: 'refund-not-due', order };
    } else {
      const staffReason = String(reason || '').trim();
      if (staffReason.length < 3) return { ok: false, reason: 'refund-reason-required' };
      if (!await this.#refundStaffAllowed(staffActor, order, staffAuthorized === true)) return { ok: false, reason: 'staff-not-authorized' };
      if (hold) return { ...hold, order };
      if (windowChecked !== true) {
        const created = Date.parse(order.createdAt || '');
        if (!Number.isFinite(created) || now - created > STAFF_REFUND_WINDOW_MS) {
          return { ok: false, reason: 'refund-window', order };
        }
      }
      const sentUnconfirmed = order.status === 'SENT_UNCONFIRMED' || (order.lines || []).some((line) => line.status === 'SENT_UNCONFIRMED');
      if (sentUnconfirmed) {
        if (force !== true) return { ok: false, reason: 'refund-not-allowed', order };
      } else if (order.status !== 'DELIVERY_FAILED') {
        return { ok: false, reason: 'refund-not-allowed', order };
      }
      if (this.#leaseLive(order, now)) return { ok: false, reason: 'lease-live', order };
      if (capChecked !== true) {
        const today = this.audits.filter((row) => row.actor === staffActor && ctDayKey(Date.parse(row.createdAt)) === ctDayKey(now));
        if (today.length >= STAFF_REFUND_DAILY_CAP) return { ok: false, reason: 'staff-refund-cap' };
      }
    }
    if (this.audits.some((row) => row.orderId === order.orderId)) return { ok: true, duplicate: true, order };
    if (preview === true) return { ok: true, preview: true, order };
    if (Number(order.price) > 0 && !writesEnabled) return { ok: false, reason: 'economy-write-cutover-not-enabled' };
    if (Number(order.price) > 0 && applyWallet) {
      const key = `mc-shop-refund:${order.orderId}`;
      const credited = await this.wallet.credit({
        discordUserId: order.discordUserId,
        amount: order.price,
        idempotencyKey: key,
        type: 'reversal',
        source: 'mc-shop',
        metadata: { reason, actor, orderId: order.orderId, sku: order.sku, ...(force === true ? { force: true } : {}) }
      });
      if (!credited?.ok) return { ok: false, reason: credited?.reason || 'refund-failed', message: credited?.message, order };
      order.ledgerRefundKey = key;
      order.balance = credited.balance;
    }
    const previous = order.status;
    order.refunded = true;
    order.status = 'REFUNDED';
    order.leaseToken = null;
    order.leaseOwner = null;
    order.leaseUntil = null;
    order.updatedAt = new Date(now).toISOString();
    this.audits.push({
      orderId: order.orderId,
      actor: auto ? 'auto' : String(actor),
      reason: String(reason).slice(0, 300),
      amount: Number(order.price || 0),
      fromStatus: previous,
      createdAt: new Date(now).toISOString(),
      ...(force === true ? { force: true } : {})
    });
    const grant = this.grants.find((row) => row.orderId === order.orderId);
    if (grant) grant.status = 'REFUNDED';
    bumpMcMetric('refund');
    return { ok: true, order };
  }

  async sweepRefunds({ writesEnabled = false, now = this.now() } = {}) {
    this.sweepExpiredLeases(now);
    const results = [];
    for (const order of this.orders.values()) {
      if (!this.#autoRefundable(order, now)) continue;
      results.push(await this.refund({ orderId: order.orderId, reason: 'auto-14d', actor: 'auto', writesEnabled, now }));
    }
    return results;
  }

  #autoRefundable(order, now) {
    if (order.refunded || order.status === 'REFUNDED' || order.status === 'DELIVERED' || order.status === 'SENT_UNCONFIRMED') return false;
    if (order.status !== 'PAID' && order.status !== 'PLAYER_OFFLINE') return false;
    if (this.#leaseLive(order, now)) return false;
    if (linesSent(order)) return false;
    return now - Date.parse(order.createdAt) >= REFUND_AFTER_MS;
  }

  async #refundActorIdentity(actor) {
    if (typeof this.wallet?.resolve !== 'function') return { econId: '', unresolved: true };
    try {
      const identity = await this.wallet.resolve(actor);
      const econId = String(identity?.economicIdentityId || '');
      return { econId, unresolved: !econId };
    } catch {
      return { econId: '', unresolved: true };
    }
  }

  async #refundIsSelf(actor, order) {
    if (!actor || !order) return false;
    if (actor === order.discordUserId) return true;
    const actorIdentity = await this.#refundActorIdentity(actor);
    if (actorIdentity.unresolved) return false;
    return Boolean(actorIdentity.econId && order.economicIdentityId && actorIdentity.econId === order.economicIdentityId);
  }

  #staffAllowed(actor, order) {
    if (!/^\d{5,32}$/.test(actor)) return false;
    if (actor === order.discordUserId) return false;
    const allow = refundStaffIds(this.env);
    return allow.includes(actor);
  }

  async #refundStaffAllowed(actor, order, staffAuthorized = false) {
    if (!/^\d{5,32}$/.test(actor)) return false;
    if (await this.#refundIsSelf(actor, order)) return false;
    if (staffAuthorized !== true) return false;
    const listed = refundStaffIds(this.env);
    if (listed.length > 0 && !listed.includes(actor)) return false;
    return true;
  }

  async #identityForLink(discord) {
    if (typeof this.wallet.ensureMinecraftMember === 'function') {
      const ensured = await this.wallet.ensureMinecraftMember(discord);
      if (!ensured?.ok || !ensured.identity?.economicIdentityId) {
        return {
          ok: false,
          reason: ensured?.reason || 'verified-identity-required',
          message: ensured?.message,
          commitStamp: ensured?.commitStamp === true
        };
      }
      return { ok: true, identity: ensured.identity };
    }
    const identity = await this.wallet.resolve(discord);
    if (!identity?.economicIdentityId) return { ok: false, reason: 'verified-identity-required' };
    const held = linkElevationHold({
      status: identity.status,
      holdReason: identity.holdReason,
      economicIdentityId: identity.economicIdentityId,
      env: this.env
    });
    if (held) return held;
    return { ok: true, identity };
  }

  #cooldownReason(discordUserId, mcUuid, now) {
    for (const link of this.links.values()) {
      const until = Date.parse(link.cooldownUntil || '');
      if (!Number.isFinite(until) || until <= now) continue;
      if (link.discordUserId === discordUserId || link.mcUuid === mcUuid) return 'unlink-cooldown';
    }
    return '';
  }

  #insertOrder(input) {
    const orderId = input.orderId || this.createOrderId();
    if (this.orders.has(orderId)) {
      const error = new Error('duplicate-order-id');
      error.code = 'duplicate-order-id';
      throw error;
    }
    const now = new Date(this.now()).toISOString();
    const order = {
      orderId,
      discordUserId: input.discordUserId,
      economicIdentityId: input.economicIdentityId,
      mcUuid: input.mcUuid,
      sku: input.sku,
      bundles: Number(input.bundles || 0),
      price: input.price,
      source: input.source,
      nonce: input.nonce || '',
      ledgerKey: input.ledgerKey || '',
      status: 'PAID',
      lines: input.lines,
      catalogVersion: input.catalogVersion || '',
      catalogHash: input.catalogHash || '',
      createdAt: now,
      updatedAt: now,
      leaseUntil: null,
      leaseToken: null,
      leaseOwner: null,
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
  STAFF_REFUND_WINDOW_MS,
  activeMcLink,
  LEASE_MS,
  OFFLINE_BACKOFF_MS,
  CODE_ATTEMPT_LIMIT,
  LINK_REQUESTS_PER_HOUR,
  STAFF_REFUND_DAILY_CAP,
  CODE_ALPHABET,
  hashCode,
  linkCodeSecret,
  assertMcLinkCodeSecret,
  generateLinkCode,
  verifiedDiscordIdentity,
  mcEarnEligible,
  mcPlaytimeEligible,
  leaseMsForOrder,
  offlineBackoffMs,
  dayOrders,
  isMinecraftShopOrder,
  stackLines,
  orderLineHash,
  signQuote,
  bumpMcMetric,
  mcMetrics,
  MemoryMcPoints
};
