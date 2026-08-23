'use strict';

const http = require('node:http');
const https = require('node:https');
const { safeSentinalAdminUrl } = require('./config-store.cjs');

function pairRequest(baseUrl, code, options = {}) {
  const safeUrl = safeSentinalAdminUrl(baseUrl, '');
  if (!safeUrl) return Promise.reject(new Error('Use a valid HTTPS Sentinal admin URL. Loopback HTTP is allowed only for local testing.'));
  const endpoint = new URL('/v1/pair', `${safeUrl}/`);
  const transport = endpoint.protocol === 'https:' ? https : http;
  const payload = Buffer.from(JSON.stringify({ code: String(code || '').trim() }));
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 10_000));

  return new Promise((resolve, reject) => {
    const req = transport.request(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'content-length': payload.length,
        'user-agent': 'Khaos-Nexus-Desktop/0.1'
      }
    }, (res) => {
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 64 * 1024) {
          req.destroy(new Error('Sentinal pairing response was too large.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        let body = {};
        try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
        catch { return reject(new Error(`Sentinal pairing returned invalid JSON (HTTP ${res.statusCode || 0}).`)); }
        if ((res.statusCode || 500) < 200 || (res.statusCode || 500) >= 300 || body.ok === false) {
          return reject(new Error(String(body.message || body.code || `Sentinal pairing failed with HTTP ${res.statusCode || 0}.`).slice(0, 240)));
        }
        const token = String(body.token || '');
        if (token.length < 32 || token.length > 1024 || /\s/.test(token)) return reject(new Error('Sentinal pairing returned an invalid admin credential.'));
        resolve({ ok: true, baseUrl: safeUrl, token, pairedAt: body.pairedAt || '' });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Sentinal pairing request timed out.')));
    req.on('error', reject);
    req.end(payload);
  });
}

module.exports = { pairRequest };
