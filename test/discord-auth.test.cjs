'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { DiscordAuth, createPkce, parseRedirectUri } = require('../main/services/discord-auth.cjs');

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function createStore(discord) {
  let session = null;
  return {
    getConfig: () => ({ discord: JSON.parse(JSON.stringify(discord)) }),
    setDiscordOAuthSession: (next) => { session = JSON.parse(JSON.stringify(next)); },
    getDiscordOAuthSession: () => session ? JSON.parse(JSON.stringify(session)) : null,
    clearDiscordOAuthSession: () => { session = null; }
  };
}

test('PKCE verifier and challenge use URL-safe values', () => {
  const pkce = createPkce();
  assert.match(pkce.verifier, /^[A-Za-z0-9_-]+$/);
  assert.match(pkce.challenge, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(pkce.verifier, pkce.challenge);
});

test('redirect URI is restricted to a fixed 127.0.0.1 callback', () => {
  const uri = parseRedirectUri('http://127.0.0.1:43119/callback');
  assert.equal(uri.hostname, '127.0.0.1');
  assert.equal(uri.port, '43119');
  assert.throws(() => parseRedirectUri('https://example.com/callback'), /127\.0\.0\.1/);
  assert.throws(() => parseRedirectUri('http://127.0.0.1/callback'), /fixed local port/);
});

test('completes browser OAuth login and authorizes an allowed operator', async () => {
  const port = await freePort();
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const discord = {
    oauthClientId: '123456789012345678',
    oauthRedirectUri: redirectUri,
    oauthScopes: ['identify', 'guilds'],
    ownerUserId: '111',
    operatorUserIds: ['222'],
    guildId: '999'
  };
  const store = createStore(discord);
  const requests = [];
  let openedUrl = null;
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/oauth2/token')) {
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('client_id'), discord.oauthClientId);
      assert.equal(body.get('grant_type'), 'authorization_code');
      assert.ok(body.get('code_verifier'));
      return response(200, { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, token_type: 'Bearer', scope: 'identify guilds' });
    }
    if (url.endsWith('/users/@me')) return response(200, { id: '222', username: 'asuna', global_name: 'Khaos Asuna', discriminator: '0' });
    if (url.endsWith('/users/@me/guilds')) return response(200, [{ id: '999', name: 'Khaos Nexus', owner: false }]);
    return response(404, { message: 'not found' });
  };
  const auth = new DiscordAuth({
    configStore: store,
    logger: { info() {}, warn() {} },
    fetchImpl,
    openExternal: async (url) => {
      openedUrl = url;
      const authorize = new URL(url);
      assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(authorize.searchParams.get('scope'), 'identify guilds');
      const callback = new URL(redirectUri);
      callback.searchParams.set('code', 'authorization-code');
      callback.searchParams.set('state', authorize.searchParams.get('state'));
      setTimeout(() => fetch(callback).catch(() => {}), 20);
    },
    now: () => Date.parse('2026-07-22T18:00:00Z')
  });

  const result = await auth.login();
  assert.ok(openedUrl);
  assert.equal(result.status, 'signed-in');
  assert.equal(result.authorized, true);
  assert.equal(result.user.id, '222');
  assert.equal(result.configuredGuild.name, 'Khaos Nexus');
  assert.equal(store.getDiscordOAuthSession().refreshToken, 'refresh');
  assert.equal(requests.length, 3);
});

test('marks a signed-in Discord account unauthorized when it is not allowlisted', async () => {
  const discord = {
    oauthClientId: '123456789012345678',
    oauthRedirectUri: 'http://127.0.0.1:43119/callback',
    oauthScopes: ['identify', 'guilds'],
    ownerUserId: '111',
    operatorUserIds: ['222'],
    guildId: ''
  };
  const store = createStore(discord);
  store.setDiscordOAuthSession({ accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.parse('2026-07-23T18:00:00Z') });
  const auth = new DiscordAuth({
    configStore: store,
    logger: { info() {}, warn() {} },
    openExternal: async () => {},
    fetchImpl: async (url) => {
      if (url.endsWith('/users/@me')) return response(200, { id: '333', username: 'visitor', discriminator: '0' });
      if (url.endsWith('/users/@me/guilds')) return response(200, []);
      return response(404, { message: 'not found' });
    },
    now: () => Date.parse('2026-07-22T18:00:00Z')
  });
  const result = await auth.restore();
  assert.equal(result.status, 'unauthorized');
  assert.equal(result.authorized, false);
  assert.match(result.authorizedReason, /not on the operator allowlist/);
});

test('refreshes an expired Discord session and stores rotated tokens', async () => {
  const discord = {
    oauthClientId: '123456789012345678',
    oauthRedirectUri: 'http://127.0.0.1:43119/callback',
    oauthScopes: ['identify', 'guilds'],
    ownerUserId: '',
    operatorUserIds: [],
    guildId: ''
  };
  const store = createStore(discord);
  store.setDiscordOAuthSession({ accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: Date.parse('2026-07-22T17:00:00Z') });
  const auth = new DiscordAuth({
    configStore: store,
    logger: { info() {}, warn() {} },
    openExternal: async () => {},
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith('/oauth2/token')) {
        const body = new URLSearchParams(options.body);
        assert.equal(body.get('grant_type'), 'refresh_token');
        assert.equal(body.get('refresh_token'), 'old-refresh');
        return response(200, { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, token_type: 'Bearer', scope: 'identify guilds' });
      }
      if (url.endsWith('/users/@me')) return response(200, { id: '444', username: 'kirito', discriminator: '0' });
      if (url.endsWith('/users/@me/guilds')) return response(200, []);
      return response(404, { message: 'not found' });
    },
    now: () => Date.parse('2026-07-22T18:00:00Z')
  });
  const result = await auth.restore();
  assert.equal(result.status, 'signed-in');
  assert.equal(store.getDiscordOAuthSession().accessToken, 'new-access');
  assert.equal(store.getDiscordOAuthSession().refreshToken, 'new-refresh');
});
