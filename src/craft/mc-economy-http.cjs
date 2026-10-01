'use strict';

const http = require('node:http');
const https = require('node:https');

function economyConfigured(env = process.env) {
  return Boolean(String(env.NEXUS_ECONOMY_URL || '').trim() && String(env.NEXUS_ECONOMY_CRAFT_TOKEN || '').trim());
}

function economyRequest(pathname, { method = 'POST', body = null, env = process.env, timeoutMs = 8000 } = {}) {
  const base = String(env.NEXUS_ECONOMY_URL || '').trim().replace(/\/$/, '');
  const token = String(env.NEXUS_ECONOMY_CRAFT_TOKEN || '').trim();
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
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = raw ? JSON.parse(raw) : {}; } catch { return reject(new Error('Nexus economy worker returned invalid JSON.')); }
        if (Number(res.statusCode) >= 400) return reject(new Error(parsed.error || `Nexus economy worker HTTP ${res.statusCode}.`));
        resolve(parsed);
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Nexus economy worker request timed out.')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function httpMinecraftPoints(env = process.env) {
  const call = (pathname, body, method = 'POST') => economyRequest(pathname, { method, body, env });
  return {
    challenge: (input) => call('/mc/link/challenge', input),
    confirm: (input) => call('/mc/link/confirm', input),
    unlink: (input) => call('/mc/unlink', input),
    status: (input) => call(`/mc/link/${encodeURIComponent(input.discordUserId)}`, null, 'GET'),
    quote: (input) => call('/mc-shop/quote', input),
    buy: (input) => call('/mc-shop/buy', input),
    claimStarterKit: (input) => call('/mc/starter-kit/claim', input),
    listGrants: () => call('/mc/grants', null, 'GET'),
    claimNext: async () => {
      const result = await call('/mc-shop/claim', {});
      return result.order || null;
    },
    pendingOrders: async () => (await call('/mc-shop/orders/pending', null, 'GET')).orders || [],
    markDelivery: (input) => call('/mc-shop/delivery-status', input),
    refund: (input) => call('/mc-shop/refund', input),
    sweepRefunds: async (input) => (await call('/mc-shop/refund-sweep', input || {})).results || [],
    presence: (input) => call('/presence', input)
  };
}

module.exports = { economyConfigured, economyRequest, httpMinecraftPoints };
