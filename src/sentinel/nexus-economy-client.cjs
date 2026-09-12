'use strict';

const http = require('node:http');
const https = require('node:https');

function clean(value, max = 256) {
  return String(value || '').replace(/[\r\n\t\u0000-\u001f]+/g, '').trim().slice(0, max);
}

function configured() {
  return Boolean(String(process.env.NEXUS_ECONOMY_URL || '').trim() && String(process.env.NEXUS_ECONOMY_TOKEN || '').trim());
}

function request(pathname, { method = 'GET', body = null, timeoutMs = 8000 } = {}) {
  const base = String(process.env.NEXUS_ECONOMY_URL || '').trim().replace(/\/$/, '');
  const token = String(process.env.NEXUS_ECONOMY_TOKEN || '').trim();
  if (!base || !token) return Promise.reject(new Error('Nexus economy worker is not configured.'));
  const url = new URL(`${base}${pathname}`);
  const transport = url.protocol === 'https:' ? https : http;
  const payload = body == null ? null : Buffer.from(JSON.stringify(body));
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
        if ((res.statusCode || 500) >= 400) return reject(new Error(parsed.error || `Nexus economy worker HTTP ${res.statusCode}.`));
        resolve(parsed);
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Nexus economy worker request timed out.')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

class NexusEconomyClient {
  constructor({ identityStoreFactory = null } = {}) {
    this.identityStoreFactory = typeof identityStoreFactory === 'function' ? identityStoreFactory : null;
  }

  configured() { return configured(); }
  health() { return request('/health'); }

  identityStore() {
    if (this.identityStoreFactory) return this.identityStoreFactory();
    const { ArkIdentityStore } = require('./ark-identity-store.cjs');
    return new ArkIdentityStore();
  }

  async ensureIdentityProjected(discordUserId) {
    if (!this.configured()) return { ok: false, skipped: 'economy-worker-unconfigured', linked: 0 };
    const id = clean(discordUserId, 32);
    if (!/^\d{5,25}$/.test(id)) return { ok: false, skipped: 'discord-user-id-invalid', linked: 0 };
    const profile = this.identityStore().profileByDiscord(id);
    if (!profile) return { ok: false, skipped: 'identity-not-linked', linked: 0 };
    const rankId = clean(profile.rankId, 48) || 'shadow-recruit';
    let linked = 0;
    for (const account of profile.arkAccounts || []) {
      const eosId = clean(account?.eosId, 128);
      if (!eosId) continue;
      await this.linkIdentity({ discordUserId: id, eosId, rankId });
      linked += 1;
    }
    return { ok: true, discordUserId: id, rankId, linked };
  }

  async wallet(discordUserId) {
    await this.ensureIdentityProjected(discordUserId);
    return request(`/wallet/${encodeURIComponent(String(discordUserId))}`);
  }

  linkIdentity(input) { return request('/identity/link', { method: 'POST', body: input }); }
  presence(input) { return request('/presence', { method: 'POST', body: input }); }
  credit(input) { return request('/wallet/credit', { method: 'POST', body: input }); }
  spend(input) { return request('/wallet/spend', { method: 'POST', body: input }); }

  shopCatalog() { return request('/shop/catalog'); }
  shopQuote(input) { return request('/shop/quote', { method: 'POST', body: input }); }
  async shopBuy(input) {
    await this.ensureIdentityProjected(input?.discordUserId);
    return request('/shop/buy', { method: 'POST', body: input });
  }
  shopSell(input) { return request('/shop/sell', { method: 'POST', body: input }); }
  shopOrder(orderId) { return request(`/shop/order/${encodeURIComponent(String(orderId))}`); }
  pendingShopOrders() { return request('/shop/orders/pending'); }
  confirmShopSellRemoval(input) { return request('/shop/sell/confirm-removal', { method: 'POST', body: input }); }
  markShopBuyDelivery(input) { return request('/shop/buy/delivery-status', { method: 'POST', body: input }); }
}

module.exports = { configured, NexusEconomyClient };
