'use strict';

const http = require('node:http');
const https = require('node:https');

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
  configured() { return configured(); }
  health() { return request('/health'); }
  wallet(discordUserId) { return request(`/wallet/${encodeURIComponent(String(discordUserId))}`); }
  linkIdentity(input) { return request('/identity/link', { method: 'POST', body: input }); }
  presence(input) { return request('/presence', { method: 'POST', body: input }); }
  credit(input) { return request('/wallet/credit', { method: 'POST', body: input }); }
  spend(input) { return request('/wallet/spend', { method: 'POST', body: input }); }
}

module.exports = { configured, NexusEconomyClient };
