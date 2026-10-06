'use strict';

const http = require('node:http');
const https = require('node:https');
const { withIdentityProof } = require('./nexus-economy-identity-proof.cjs');
const { rankById } = require('../shared/ranks.cjs');
const { economyPerkForRank, OFFLINE_PASSIVE_CAP_HOURS } = require('../shared/nexus-economy-rank-perks.cjs');
const { highestConfiguredRankForMember } = require('./ark-account-linking.cjs');
const { assertDiscordMembershipVerified } = require('./nexus-economy-o9-eligibility.cjs');
const { MemberVerificationStore } = require('./member-verification-store.cjs');
const { MEMBER_HOLD_MESSAGE, memberHoldFromError } = require('./nexus-economy-identity-hold.cjs');

function asMemberHold(result) {
  if (!result || result.ok !== false) return null;
  if (result.reason !== 'account-hold' && result.reason !== 'quarantined' && result.message !== MEMBER_HOLD_MESSAGE) return null;
  const reason = result.reason === 'quarantined' ? 'quarantined' : 'account-hold';
  return { ok: false, reason, message: MEMBER_HOLD_MESSAGE, credited: 0 };
}

function clean(value, max = 256) {
  return String(value || '').replace(/[\r\n\t\u0000-\u001f]+/g, '').trim().slice(0, max);
}

function configured() {
  return Boolean(String(process.env.NEXUS_ECONOMY_URL || '').trim() && String(process.env.NEXUS_ECONOMY_TOKEN || '').trim());
}

function request(pathname, { method = 'GET', body = null, timeoutMs = 8000, acceptedStatusCodes = [] } = {}) {
  const base = String(process.env.NEXUS_ECONOMY_URL || '').trim().replace(/\/$/, '');
  const token = String(process.env.NEXUS_ECONOMY_TOKEN || '').trim();
  if (!base || !token) return Promise.reject(new Error('Nexus economy worker is not configured.'));
  const url = new URL(`${base}${pathname}`);
  const transport = url.protocol === 'https:' ? https : http;
  const payload = body == null ? null : Buffer.from(JSON.stringify(body));
  const accepted = new Set((acceptedStatusCodes || []).map((value) => Number(value)).filter(Number.isFinite));
  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {})
      }
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; if (raw.length > 512 * 1024) req.destroy(new Error('Nexus economy response too large.')); });
      res.on('end', () => {
        let parsed = {};
        try { parsed = raw ? JSON.parse(raw) : {}; } catch { return reject(new Error(`Nexus economy worker returned invalid JSON (${res.statusCode}).`)); }
        const statusCode = Number(res.statusCode || 500);
        if (statusCode >= 400 && !accepted.has(statusCode)) return reject(new Error(parsed.error || `Nexus economy worker HTTP ${res.statusCode}.`));
        resolve(parsed);
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Nexus economy worker request timed out.')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const _unverifiedLogOnce = new Set();

class NexusEconomyClient {
  constructor({ identityStoreFactory = null, memberVerificationStoreFactory = null } = {}) {
    this.identityStoreFactory = typeof identityStoreFactory === 'function' ? identityStoreFactory : null;
    this.memberVerificationStoreFactory = typeof memberVerificationStoreFactory === 'function'
      ? memberVerificationStoreFactory
      : null;
  }

  configured() { return configured(); }
  health() { return request('/health'); }

  identityStore() {
    if (this.identityStoreFactory) return this.identityStoreFactory();
    const { ArkIdentityStore } = require('./ark-identity-store.cjs');
    return new ArkIdentityStore();
  }

  memberVerificationStore() {
    if (this.memberVerificationStoreFactory) return this.memberVerificationStoreFactory();
    return new MemberVerificationStore();
  }

  async ensureIdentityProjected(discordUserId) {
    if (!this.configured()) return { ok: false, skipped: 'economy-worker-unconfigured', linked: 0 };
    const id = clean(discordUserId, 32);
    if (!/^\d{5,25}$/.test(id)) return { ok: false, skipped: 'discord-user-id-invalid', linked: 0 };

    // O9 client fail-closed: do not project/link without Sentinal Discord-verify grant.
    const membership = assertDiscordMembershipVerified(id, { store: this.memberVerificationStore() });
    if (!membership.ok) {
      if (!_unverifiedLogOnce.has(id)) {
        _unverifiedLogOnce.add(id);
        console.warn(`[Nexus Economy] skip identity projection discord=${id}: ${membership.reason}`);
      }
      return { ok: false, skipped: membership.reason, linked: 0 };
    }

    const profile = this.identityStore().profileByDiscord(id);
    if (!profile) return { ok: false, skipped: 'identity-not-linked', linked: 0 };
    const rankId = clean(profile.rankId, 48) || 'shadow-recruit';
    let linked = 0;
    for (const account of profile.arkAccounts || []) {
      const eosId = clean(account?.eosId, 128);
      if (!eosId) continue;
      const signedLink = withIdentityProof(
        { discordUserId: id, eosId, rankId, discordMembershipVerified: true },
        account
      );
      let linkedResult;
      try {
        linkedResult = await request('/identity/link', { method: 'POST', body: signedLink, acceptedStatusCodes: [409] });
      } catch (error) {
        const held = memberHoldFromError(error);
        if (held) return held;
        throw error;
      }
      const held = asMemberHold(linkedResult?.result) || asMemberHold(linkedResult);
      if (held) return held;
      linked += 1;
    }
    return { ok: true, discordUserId: id, rankId, linked };
  }

  async wallet(discordUserId, { member, config = {} } = {}) {
    const result = await request(`/wallet/${encodeURIComponent(String(discordUserId))}`);
    if (result.rankId) return result;
    if (!member) return result;
    const rank = highestConfiguredRankForMember(member, config);
    const perk = economyPerkForRank(rank.id);
    return { ...result, rankId: rank.id, rankName: rankById(rank.id).name,
      activePoints: perk.onlinePointsPerFiveMinutes, activeIntervalMinutes: 5,
      passivePointsPerHour: perk.offlinePointsPerHour, passiveCapHours: OFFLINE_PASSIVE_CAP_HOURS };
  }

  balances(discordUserId) {
    return request(`/wallet-balances/${encodeURIComponent(String(discordUserId))}`);
  }

  linkIdentity(input) { return request('/identity/link', { method: 'POST', body: input }); }

  demoteIdentityToRestricted(discordUserId) {
    return request('/identity/demote-restricted', {
      method: 'POST',
      body: { discordUserId: String(discordUserId || '') }
    });
  }

  ensureShadowRecruitWallet(discordUserId, rankId = 'shadow-recruit') {
    return request('/wallet/ensure-shadow-recruit', {
      method: 'POST',
      body: { discordUserId: String(discordUserId || ''), rankId: String(rankId || 'shadow-recruit') }
    });
  }

  presence(input) { return request('/presence', { method: 'POST', body: input }); }
  credit(input) { return request('/wallet/credit', { method: 'POST', body: input }); }
  spend(input) { return request('/wallet/spend', { method: 'POST', body: input }); }
  adminCredit(input) { return request('/wallet/admin-credit', { method: 'POST', body: input }); }
  adminSpend(input) { return request('/wallet/admin-spend', { method: 'POST', body: input }); }

  shopCatalog() { return request('/shop/catalog'); }
  shopQuote(input) { return request('/shop/quote', { method: 'POST', body: input }); }
  async shopBuy(input) {
    // O9 fail-closed: Discord-verify required and link failures must reject before /shop/buy.
    let projection;
    try {
      projection = await this.ensureIdentityProjected(input?.discordUserId);
    } catch (error) {
      const held = memberHoldFromError(error);
      if (held) return held;
      throw error;
    }
    const held = asMemberHold(projection);
    if (held) return held;
    if (!projection?.ok) {
      throw new Error(projection?.skipped || 'identity-projection-required');
    }
    return request('/shop/buy', { method: 'POST', body: input, acceptedStatusCodes: [409] });
  }
  shopSell(input) { return request('/shop/sell', { method: 'POST', body: input }); }
  shopOrder(orderId) { return request(`/shop/order/${encodeURIComponent(String(orderId))}`); }
  pendingShopOrders() { return request('/shop/orders/pending'); }
  confirmShopSellRemoval(input) { return request('/shop/sell/confirm-removal', { method: 'POST', body: input }); }
  sweepCreditFailedSells() { return request('/shop/sell/sweep-credit-failed', { method: 'POST', body: {} }); }
  markShopBuyDelivery(input) { return request('/shop/buy/delivery-status', { method: 'POST', body: input }); }

  mcShopCatalog() { return request('/mc-shop/catalog'); }
  mcShopQuote(input) { return request('/mc-shop/quote', { method: 'POST', body: input }); }
  mcShopBuy(input) { return request('/mc-shop/buy', { method: 'POST', body: input, acceptedStatusCodes: [409] }); }
  mcClaimStarterKit(input) { return request('/mc/starter-kit/claim', { method: 'POST', body: input }); }
  mcShopRefundPreview(input) { return request('/mc-shop/refund-preview', { method: 'POST', body: input }); }
  mcShopRefund(input) { return request('/mc-shop/refund', { method: 'POST', body: input }); }

  arkShopCatalog() { return request('/np-shop/catalog'); }
  arkShopQuote(input) { return request('/np-shop/quote', { method: 'POST', body: input }); }
  arkShopBuy(input) { return request('/np-shop/buy', { method: 'POST', body: input, acceptedStatusCodes: [409] }); }
  arkClaimStarterKit(input) { return request('/ark/starter-kit/claim', { method: 'POST', body: input }); }
  arkPoints(discordUserId) { return request(`/np-shop/activity/${encodeURIComponent(String(discordUserId || ''))}`); }
  arkPendingOrders() { return request('/np-shop/orders/pending'); }
  arkGrants() { return request('/ark/grants'); }
  arkStaffResolve(input) { return request('/ark/staff/resolve', { method: 'POST', body: input }); }

  coinShopCatalog() { return request('/coin-shop/catalog'); }
  coinShopQuote(input) { return request('/coin-shop/quote', { method: 'POST', body: input, acceptedStatusCodes: [409, 503] }); }
  coinShopPurchase(input) { return request('/coin-shop/purchase', { method: 'POST', body: input, acceptedStatusCodes: [409, 503] }); }
  coinShopRefundPreview(input) { return request('/coin-shop/refund-preview', { method: 'POST', body: input, acceptedStatusCodes: [409, 503] }); }
  coinShopRefund(input) { return request('/coin-shop/refund', { method: 'POST', body: input, acceptedStatusCodes: [409, 503] }); }
  coinShopMarkEquipped(input) { return request('/coin-shop/mark-equipped', { method: 'POST', body: input, acceptedStatusCodes: [409, 503] }); }
  coinShopEntitlements(discordUserId) { return request(`/coin-shop/entitlements/${encodeURIComponent(String(discordUserId || ''))}`); }
  coinShopLookup(input) { return request('/coin-shop/lookup', { method: 'POST', body: input, acceptedStatusCodes: [409, 503] }); }
}

module.exports = { configured, NexusEconomyClient };
