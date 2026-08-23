'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const { URL, URLSearchParams } = require('node:url');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const DISCORD_API = 'https://discord.com/api/v10';

function oauthConfig(config) {
  const clientId = String(config.discord?.oauthClientId || '').trim();
  const secretEnv = String(config.discord?.oauthClientSecretEnv || 'NEXUS_DISCORD_OAUTH_CLIENT_SECRET').trim();
  const clientSecret = String(process.env[secretEnv] || '').trim();
  const redirectUri = String(config.discord?.oauthRedirectUri || 'http://127.0.0.1:53117/callback').trim();
  return { clientId, clientSecret, secretEnv, redirectUri };
}

function assertLoopbackRedirect(redirectUri) {
  const parsed = new URL(redirectUri);
  if (parsed.protocol !== 'http:' || !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error('Discord OAuth redirect must use an HTTP loopback address.');
  }
  if (!parsed.port) throw new Error('Discord OAuth redirect must include a fixed loopback port.');
  return parsed;
}

function available(config) {
  const value = oauthConfig(config);
  return Boolean(value.clientId && value.clientSecret && value.redirectUri);
}

async function postForm(url, body, clientId, clientSecret, fetchImpl) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(body).toString()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error_description || payload.message || `Discord OAuth returned HTTP ${response.status}.`);
  return payload;
}

function callbackPage(message, success) {
  const text = String(message || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  return `<!doctype html><html><head><meta charset="utf-8"><title>Khaos Nexus</title><style>body{font-family:system-ui;background:#09090b;color:#f5f5f5;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:540px;padding:32px;border:1px solid #3f3f46;border-radius:18px;background:#18181b}h1{color:${success ? '#ef4444' : '#f59e0b'}}</style></head><body><div class="card"><h1>${success ? 'Discord linked' : 'Link failed'}</h1><p>${text}</p><p>You can close this browser tab and return to Khaos Nexus.</p></div></body></html>`;
}

async function linkDiscordWithOAuth({ config, backendClient, role, openExternal, fetchImpl = fetch, timeoutMs = 180000 }) {
  const { clientId, clientSecret, secretEnv, redirectUri } = oauthConfig(config);
  if (!clientId) throw new Error('Set the Discord OAuth Client ID under Accounts & Access first.');
  if (!clientSecret) throw new Error(`Save ${secretEnv} under Credentials before linking Discord.`);
  if (typeof openExternal !== 'function') throw new Error('Discord OAuth browser launcher is unavailable.');
  const redirect = assertLoopbackRedirect(redirectUri);
  const pairingResult = await backendClient.createPairingCode(role);
  if (!pairingResult.ok || !pairingResult.pairing?.code) throw new Error(pairingResult.message || 'Could not create a Nexus account link code.');
  const state = crypto.randomBytes(24).toString('hex');

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close(() => {});
      if (error) reject(error);
      else resolve(value);
    };

    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, redirect.origin);
        if (url.pathname !== redirect.pathname) {
          res.writeHead(404).end('Not found');
          return;
        }
        if (url.searchParams.get('state') !== state) throw new Error('Discord OAuth state check failed.');
        const oauthError = url.searchParams.get('error');
        if (oauthError) throw new Error(`Discord authorization was not completed (${oauthError}).`);
        const code = url.searchParams.get('code');
        if (!code) throw new Error('Discord did not return an authorization code.');

        const token = await postForm(`${DISCORD_API}/oauth2/token`, {
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri
        }, clientId, clientSecret, fetchImpl);
        const userResponse = await fetchImpl(`${DISCORD_API}/users/@me`, {
          headers: { authorization: `Bearer ${token.access_token}` }
        });
        const user = await userResponse.json().catch(() => ({}));
        if (!userResponse.ok || !user.id) throw new Error(user.message || 'Discord identity lookup failed.');

        const linked = await backendClient.linkAccount(pairingResult.pairing.code, {
          id: user.id,
          username: user.username,
          globalName: user.global_name,
          avatar: user.avatar
        });
        if (!linked.ok) throw new Error(linked.message || 'Nexus rejected the account link.');

        if (token.access_token) {
          postForm(`${DISCORD_API}/oauth2/token/revoke`, { token: token.access_token }, clientId, clientSecret, fetchImpl).catch(() => {});
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(callbackPage(`Linked ${linked.account.displayName} as ${linked.account.role}.`, true));
        finish(null, linked);
      } catch (error) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(callbackPage(error.message || String(error), false));
        finish(error);
      }
    });

    server.once('error', (error) => finish(error));
    const timer = setTimeout(() => finish(new Error('Discord account linking timed out.')), timeoutMs);
    timer.unref?.();
    server.listen(Number(redirect.port), redirect.hostname, async () => {
      try {
        const authorize = new URL('https://discord.com/oauth2/authorize');
        authorize.searchParams.set('client_id', clientId);
        authorize.searchParams.set('response_type', 'code');
        authorize.searchParams.set('redirect_uri', redirectUri);
        authorize.searchParams.set('scope', 'identify');
        authorize.searchParams.set('state', state);
        authorize.searchParams.set('prompt', 'consent');
        await openExternal(authorize.toString());
      } catch (error) {
        finish(error);
      }
    });
  });
}

module.exports = { DISCORD_API, LOOPBACK_HOSTS, assertLoopbackRedirect, available, linkDiscordWithOAuth, oauthConfig };
