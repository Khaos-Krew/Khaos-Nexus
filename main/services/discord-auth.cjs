'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const DISCORD_API = 'https://discord.com/api/v10';
const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:43119/callback';
const DEFAULT_SCOPES = ['identify', 'guilds'];

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function createPkce() {
  const verifier = base64Url(crypto.randomBytes(64));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function parseRedirectUri(value) {
  const uri = new URL(String(value || DEFAULT_REDIRECT_URI));
  if (uri.protocol !== 'http:' || uri.hostname !== '127.0.0.1') {
    throw new Error('Discord desktop login redirect must use http://127.0.0.1 with a local callback path.');
  }
  if (!uri.port) throw new Error('Discord desktop login redirect must include a fixed local port.');
  return uri;
}

function normalizeUser(user) {
  if (!user) return null;
  return {
    id: String(user.id || ''),
    username: String(user.username || ''),
    globalName: user.global_name || null,
    discriminator: String(user.discriminator || '0'),
    avatar: user.avatar || null,
    locale: user.locale || null,
    publicFlags: Number(user.public_flags || 0)
  };
}

class DiscordAuth extends EventEmitter {
  constructor({ configStore, logger, openExternal, fetchImpl = global.fetch, now = () => Date.now() }) {
    super();
    this.configStore = configStore;
    this.logger = logger;
    this.openExternal = openExternal;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.loginInProgress = false;
    this.state = {
      status: 'signed-out',
      user: null,
      guilds: [],
      authorized: false,
      authorizedReason: null,
      expiresAt: null,
      lastError: null
    };
  }

  getConfig() {
    const discord = this.configStore.getConfig().discord || {};
    return {
      clientId: String(discord.oauthClientId || '').trim(),
      redirectUri: String(discord.oauthRedirectUri || DEFAULT_REDIRECT_URI).trim(),
      scopes: Array.isArray(discord.oauthScopes) && discord.oauthScopes.length ? discord.oauthScopes : DEFAULT_SCOPES,
      ownerUserId: String(discord.ownerUserId || '').trim(),
      operatorUserIds: Array.isArray(discord.operatorUserIds) ? discord.operatorUserIds.map(String) : [],
      guildId: String(discord.guildId || '').trim()
    };
  }

  publicState() {
    const config = this.getConfig();
    const matchingGuild = config.guildId ? this.state.guilds.find((guild) => String(guild.id) === config.guildId) : null;
    return {
      ...this.state,
      configured: Boolean(config.clientId && config.redirectUri),
      redirectUri: config.redirectUri,
      scopes: config.scopes,
      guildCount: this.state.guilds.length,
      configuredGuild: matchingGuild ? { id: String(matchingGuild.id), name: matchingGuild.name, owner: Boolean(matchingGuild.owner) } : null,
      loginInProgress: this.loginInProgress
    };
  }

  update(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.publicState());
  }

  getState() {
    return JSON.parse(JSON.stringify(this.publicState()));
  }

  isAuthorized(userId) {
    const config = this.getConfig();
    const allowed = new Set([config.ownerUserId, ...config.operatorUserIds].filter(Boolean));
    if (!allowed.size) return { authorized: true, reason: 'No operator allowlist is configured.' };
    if (allowed.has(String(userId))) return { authorized: true, reason: 'Discord account is on the operator allowlist.' };
    return { authorized: false, reason: 'Discord account is not on the operator allowlist.' };
  }

  async request(url, options = {}) {
    if (typeof this.fetchImpl !== 'function') throw new Error('Network requests are unavailable in this build.');
    const response = await this.fetchImpl(url, options);
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(payload?.message || `Discord request failed with status ${response.status}.`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async exchangeToken(params) {
    const body = new URLSearchParams(params);
    return this.request(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
  }

  async fetchIdentity(accessToken) {
    const headers = { Authorization: `Bearer ${accessToken}` };
    const [user, guilds] = await Promise.all([
      this.request(`${DISCORD_API}/users/@me`, { headers }),
      this.request(`${DISCORD_API}/users/@me/guilds`, { headers })
    ]);
    return { user: normalizeUser(user), guilds: Array.isArray(guilds) ? guilds : [] };
  }

  saveTokenResponse(token) {
    const expiresAt = this.now() + (Number(token.expires_in || 0) * 1000);
    this.configStore.setDiscordOAuthSession({
      accessToken: String(token.access_token || ''),
      refreshToken: String(token.refresh_token || ''),
      tokenType: String(token.token_type || 'Bearer'),
      scope: String(token.scope || ''),
      expiresAt
    });
    return expiresAt;
  }

  async applyToken(token) {
    const expiresAt = this.saveTokenResponse(token);
    const identity = await this.fetchIdentity(token.access_token);
    const authorization = this.isAuthorized(identity.user.id);
    this.update({
      status: authorization.authorized ? 'signed-in' : 'unauthorized',
      user: identity.user,
      guilds: identity.guilds,
      authorized: authorization.authorized,
      authorizedReason: authorization.reason,
      expiresAt,
      lastError: null
    });
    this.logger.info('Discord desktop login completed.', {
      userId: identity.user.id,
      username: identity.user.username,
      authorized: authorization.authorized,
      guildCount: identity.guilds.length
    });
    return this.getState();
  }

  async restore() {
    const session = this.configStore.getDiscordOAuthSession();
    if (!session?.accessToken && !session?.refreshToken) return this.getState();
    this.update({ status: 'restoring', lastError: null });
    try {
      if (!session.accessToken || Number(session.expiresAt || 0) <= this.now() + 5 * 60 * 1000) {
        return await this.refresh();
      }
      const identity = await this.fetchIdentity(session.accessToken);
      const authorization = this.isAuthorized(identity.user.id);
      this.update({
        status: authorization.authorized ? 'signed-in' : 'unauthorized',
        user: identity.user,
        guilds: identity.guilds,
        authorized: authorization.authorized,
        authorizedReason: authorization.reason,
        expiresAt: session.expiresAt,
        lastError: null
      });
      return this.getState();
    } catch (error) {
      this.configStore.clearDiscordOAuthSession();
      this.update({ status: 'signed-out', user: null, guilds: [], authorized: false, expiresAt: null, lastError: error.message });
      this.logger.warn('Stored Discord login could not be restored.', { message: error.message });
      return this.getState();
    }
  }

  async refresh() {
    const config = this.getConfig();
    const session = this.configStore.getDiscordOAuthSession();
    if (!config.clientId) throw new Error('Add the Discord OAuth client ID before refreshing login.');
    if (!session?.refreshToken) throw new Error('No Discord refresh token is stored. Sign in again.');
    this.update({ status: 'refreshing', lastError: null });
    try {
      const token = await this.exchangeToken({
        client_id: config.clientId,
        grant_type: 'refresh_token',
        refresh_token: session.refreshToken
      });
      return await this.applyToken(token);
    } catch (error) {
      this.configStore.clearDiscordOAuthSession();
      this.update({ status: 'signed-out', user: null, guilds: [], authorized: false, expiresAt: null, lastError: error.message });
      throw error;
    }
  }

  callbackPage(success, message) {
    const title = success ? 'Khaos Nexus login complete' : 'Khaos Nexus login failed';
    const safeMessage = String(message || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{margin:0;background:#08090d;color:#f4f5f7;font:16px Segoe UI,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}.card{max-width:560px;background:#11131a;border:1px solid #2b303b;border-radius:16px;padding:30px;box-shadow:0 20px 60px rgba(0,0,0,.35)}h1{margin-top:0;color:${success ? '#4bd89c' : '#ff4354'}}p{color:#a3a9b7;line-height:1.6}</style></head><body><div class="card"><h1>${title}</h1><p>${safeMessage}</p><p>You can close this browser tab and return to Khaos Nexus.</p></div></body></html>`;
  }

  async login() {
    if (this.loginInProgress) throw new Error('A Discord login is already in progress.');
    const config = this.getConfig();
    if (!config.clientId) throw new Error('Add the Discord OAuth client ID before signing in.');
    const redirect = parseRedirectUri(config.redirectUri);
    const { verifier, challenge } = createPkce();
    const state = base64Url(crypto.randomBytes(32));
    this.loginInProgress = true;
    this.update({ status: 'signing-in', lastError: null });

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout = null;
      const server = http.createServer(async (request, response) => {
        try {
          const incoming = new URL(request.url, config.redirectUri);
          if (incoming.pathname !== redirect.pathname) {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('Not found');
            return;
          }
          const returnedState = incoming.searchParams.get('state');
          const oauthError = incoming.searchParams.get('error');
          const code = incoming.searchParams.get('code');
          if (returnedState !== state) throw new Error('Discord login state validation failed.');
          if (oauthError) throw new Error(`Discord authorization was not completed: ${oauthError}.`);
          if (!code) throw new Error('Discord did not return an authorization code.');

          const token = await this.exchangeToken({
            client_id: config.clientId,
            grant_type: 'authorization_code',
            code,
            redirect_uri: config.redirectUri,
            code_verifier: verifier
          });
          const result = await this.applyToken(token);
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end(this.callbackPage(true, `Signed in as ${result.user?.globalName || result.user?.username || 'Discord user'}.`));
          finish(null, result);
        } catch (error) {
          response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end(this.callbackPage(false, error.message));
          this.update({ status: 'signed-out', lastError: error.message });
          finish(error);
        }
      });

      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        this.loginInProgress = false;
        if (timeout) clearTimeout(timeout);
        server.close(() => {});
        this.emit('state', this.publicState());
        if (error) reject(error);
        else resolve(result);
      };

      server.on('error', (error) => {
        this.update({ status: 'signed-out', lastError: error.message });
        finish(new Error(`Discord login callback could not start on ${redirect.host}: ${error.message}`));
      });

      timeout = setTimeout(() => {
        const error = new Error('Discord login timed out. Start the login again.');
        this.update({ status: 'signed-out', lastError: error.message });
        finish(error);
      }, 3 * 60 * 1000);
      timeout.unref?.();

      server.listen(Number(redirect.port), redirect.hostname, async () => {
        const authorize = new URL('https://discord.com/oauth2/authorize');
        authorize.searchParams.set('client_id', config.clientId);
        authorize.searchParams.set('response_type', 'code');
        authorize.searchParams.set('redirect_uri', config.redirectUri);
        authorize.searchParams.set('scope', config.scopes.join(' '));
        authorize.searchParams.set('state', state);
        authorize.searchParams.set('code_challenge', challenge);
        authorize.searchParams.set('code_challenge_method', 'S256');
        authorize.searchParams.set('prompt', 'consent');
        try {
          await this.openExternal(authorize.toString());
        } catch (error) {
          this.update({ status: 'signed-out', lastError: error.message });
          finish(error);
        }
      });
    });
  }

  logout() {
    this.configStore.clearDiscordOAuthSession();
    this.update({ status: 'signed-out', user: null, guilds: [], authorized: false, authorizedReason: null, expiresAt: null, lastError: null });
    this.logger.info('Discord desktop user signed out.');
    return this.getState();
  }
}

module.exports = { DiscordAuth, createPkce, parseRedirectUri, normalizeUser, DEFAULT_REDIRECT_URI, DEFAULT_SCOPES };
