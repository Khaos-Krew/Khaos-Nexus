'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');
const { PostgresArkShop } = require('../src/economy-worker/ark-np-postgres.cjs');
const { authorizeMcRefundActor, mcRefundActorAllowed } = require('../src/economy-worker/mc-refund-auth.cjs');
const { MemoryMcPoints, assertMcLinkCodeSecret } = require('../src/economy-worker/mc-points-service.cjs');
const { PostgresMcPoints, MC_SCHEMA_VERSION } = require('../src/economy-worker/mc-points-postgres.cjs');
const { PostgresEconomyAccrual } = require('../src/economy-worker/postgres-accrual.cjs');
const { createEconomyServer, craftRouteAllowed, writeGate } = require('../src/economy-worker/server.cjs');
const { pollMcPlaytime } = require('../src/craft/mc-playtime.cjs');
const { handleMcPointsCommand, installMcEconomyLoops } = require('../src/craft/mc-points-commands.cjs');
const { httpMinecraftPoints } = require('../src/craft/mc-economy-http.cjs');
const { NexusEconomyClient } = require('../src/sentinel/nexus-economy-client.cjs');
const { handleArkShopInteraction } = require('../src/sentinel/ark-np-shop-ui.cjs');
const { craftHelpText } = require('../src/craft/help.cjs');
const { NexusEconomyStore, NexusEconomyWorker } = require('../src/sentinel/nexus-economy-worker.cjs');
const { mcShopConfirmText, mcShopReceiptText } = require('../src/sentinel/mc-shop-ui-extension.cjs');
const { mcMemberText } = require('../src/shared/mc-member-text.cjs');
const { mcPointsFlags } = require('../src/shared/mc-points-flags.cjs');
const { catalogFingerprint, loadMcShopCatalog } = require('../src/shared/mc-shop-catalog.cjs');
const { discordBotToken, guildJoinedAtMs, memberJoinedAtMs, trustedJoinedAt, FIRST_PLAY_MS } = require('../src/shared/mc-starter-kit.cjs');
const { COMMUNITY_MANAGER_ROLE_ID, OWNER_ROLE_ID } = require('../src/economy-worker/ark-staff-auth.cjs');

const UUID = '853c80ef-3c37-49fd-aa49-938b674adae6';
const DISCORD = '111111111111111111';
const BUYER = '222222222222222222';
const ADMIN = '444444444444444444';
const GUILD = '999999999999999999';
const ROLE = '555555555555555555';
const LINK_SECRET = 'mc-link-code-hmac-secret-32chars!';
const JOINED = Date.parse('2020-01-15T00:00:00.000Z');
const STATUS_TEXT = 'I could not check your Minecraft link. Try `/mc link status` again in a minute. If it still fails, ask a staff member.';

function wallet(balance = 100) {
  return {
    calls: [],
    balanceValue: balance,
    status: 'verified',
    holdReason: '',
    quarantinedValue: false,
    async resolve(discordUserId) {
      return {
        economicIdentityId: `econ_${discordUserId}`,
        status: this.status,
        holdReason: this.holdReason,
        verifiedAt: '2026-01-01T00:00:00.000Z'
      };
    },
    async balance() { return this.balanceValue; },
    async spend(input) {
      this.calls.push(['spend', input.amount]);
      this.balanceValue -= input.amount;
      return { ok: true, balance: this.balanceValue };
    },
    async credit(input) {
      this.calls.push(['credit', input.amount, input]);
      this.balanceValue += input.amount;
      return { ok: true, balance: this.balanceValue };
    },
    async lifetimeMs() { return 0; },
    async quarantined() { return this.quarantinedValue; }
  };
}

function service({ bank = wallet(), env = {}, fetchImpl, tenureOf } = {}) {
  let now = Date.parse('2026-10-01T18:00:00Z');
  const points = new MemoryMcPoints({
    now: () => now,
    wallet: bank,
    fetchImpl,
    tenureOf,
    env: {
      MC_POINTS_ENABLED: 'true',
      MC_SHOP_ENABLED: 'true',
      MC_STARTER_KIT_ENABLED: 'true',
      MC_LINK_CODE_SECRET: LINK_SECRET,
      ...env
    }
  });
  return { points, bank, advance: (ms) => { now += ms; } };
}

async function link(points, discord = DISCORD, uuid = UUID) {
  const challenge = await points.challenge({ discordUserId: discord, mcUuid: uuid, mcName: 'Steve' });
  assert.equal(challenge.ok, true, challenge.reason);
  const confirmed = await points.confirm({ discordUserId: discord, code: challenge.code });
  assert.equal(confirmed.ok, true, confirmed.reason);
}

function jsonResponse(body, ok = true) {
  return { ok, async json() { return body; } };
}

function discordApi({ roles = [ROLE], permissions = '8', name = 'Administrators', ownerId = '888888888888888888' } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), authorization: init?.headers?.authorization || '' });
    if (String(url).includes('/members/')) return jsonResponse({ roles });
    if (String(url).endsWith('/roles')) {
      return jsonResponse(roles.map((id) => ({ id, name, permissions: String(permissions), managed: false })));
    }
    return jsonResponse({ owner_id: ownerId });
  };
  return { calls, fetchImpl };
}

function listen(runtime) {
  return new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
}

function request({ port, method, path: pathname, token, payload }) {
  const body = payload == null ? null : Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json', 'content-length': body.length } : {})
      }
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} }));
    });
    req.on('error', reject);
    req.end(body || undefined);
  });
}

function withEnv(values, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test('kit tenure accepts the Sentinel bot token and the running client', async () => {
  assert.equal(discordBotToken({
    NEXUS_SENTINEL_TOKEN: 'sentinel-bot-token',
    NEXUS_SENTINAL_DISCORD_TOKEN: 'stale-token',
    DISCORD_BOT_TOKEN: 'other-token'
  }), 'sentinel-bot-token');
  const calls = [];
  const joined = await guildJoinedAtMs(DISCORD, {
    NEXUS_DISCORD_GUILD_ID: GUILD,
    NEXUS_SENTINEL_TOKEN: 'sentinel-bot-token'
  }, async (url, init) => {
    calls.push({ url: String(url), authorization: init.headers.authorization });
    return jsonResponse({ joined_at: '2020-01-15T00:00:00.000Z' });
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].authorization, 'Bot sentinel-bot-token');
  assert.match(calls[0].url, new RegExp(`/guilds/${GUILD}/members/${DISCORD}$`));
  assert.equal(joined, JOINED);

  const legacy = await guildJoinedAtMs(DISCORD, {
    NEXUS_DISCORD_GUILD_ID: GUILD,
    NEXUS_SENTINAL_DISCORD_TOKEN: 'legacy-bot-token'
  }, async (_url, init) => {
    assert.equal(init.headers.authorization, 'Bot legacy-bot-token');
    return jsonResponse({ joined_at: '2020-01-15T00:00:00.000Z' });
  });
  assert.equal(legacy, JOINED);
  assert.equal(await guildJoinedAtMs(DISCORD, { NEXUS_DISCORD_GUILD_ID: GUILD }, async () => {
    throw new Error('fetch should not run without a token');
  }), NaN);

  let clientFetches = 0;
  const fromClient = await guildJoinedAtMs(DISCORD, { NEXUS_DISCORD_GUILD_ID: GUILD }, async () => {
    throw new Error('no token');
  }, {
    guilds: {
      async fetch(guildId) {
        assert.equal(guildId, GUILD);
        return { members: { async fetch(userId) {
          assert.equal(userId, DISCORD);
          clientFetches += 1;
          return { joinedTimestamp: JOINED };
        } } };
      }
    }
  });
  assert.equal(fromClient, JOINED);
  assert.equal(clientFetches, 1);
  assert.equal(trustedJoinedAt(JOINED, Date.now()), JOINED);
  assert.equal(await memberJoinedAtMs({ member: { joinedTimestamp: JOINED }, user: { id: DISCORD } }), JOINED);
});

test('starter kit claim uses the worker lookup and ignores a caller tenure stamp', async () => {
  const failing = service({
    env: { NEXUS_DISCORD_GUILD_ID: GUILD, NEXUS_SENTINEL_TOKEN: 'sentinel-bot-token' },
    fetchImpl: async () => jsonResponse({}, false)
  });
  await link(failing.points);
  failing.points.links.get(UUID).playtimeMs = FIRST_PLAY_MS;
  const ignored = await failing.points.claimStarterKit({
    discordUserId: DISCORD,
    joinedAt: JOINED,
    tenureTrusted: true
  });
  assert.equal(ignored.reason, 'tenure-unknown');

  const ready = service({
    env: { NEXUS_DISCORD_GUILD_ID: GUILD, NEXUS_SENTINEL_TOKEN: 'sentinel-bot-token' },
    fetchImpl: async () => jsonResponse({ joined_at: '2020-01-15T00:00:00.000Z' })
  });
  await link(ready.points);
  ready.points.links.get(UUID).playtimeMs = FIRST_PLAY_MS;
  const claim = await ready.points.claimStarterKit({ discordUserId: DISCORD, joinedAt: Date.now() });
  assert.equal(claim.ok, true, claim.reason);
  assert.equal(claim.order.price, 0);
});

test('sentinal kit claim prefers the worker Discord lookup and craft cannot claim', async () => {
  const { points } = service();
  await link(points);
  points.links.get(UUID).playtimeMs = FIRST_PLAY_MS;
  const fetches = [];
  const runtime = createEconomyServer({
    token: 'sentinal-token',
    craftToken: 'craft-token',
    writesEnabled: false,
    worker: { minecraft: points, health: () => ({ ok: true }) },
    shop: { listCatalog: () => [], pendingBuyOrders: () => [] },
    discordEnv: { NEXUS_DISCORD_GUILD_ID: GUILD, NEXUS_SENTINEL_TOKEN: 'sentinel-bot-token' },
    fetchImpl: async (url, init) => {
      fetches.push(init.headers.authorization);
      return jsonResponse({ joined_at: '2020-01-15T00:00:00.000Z' });
    }
  });
  await listen(runtime);
  const port = runtime.server.address().port;
  try {
    const craftClaim = await request({
      port,
      method: 'POST',
      path: '/mc/starter-kit/claim',
      token: 'craft-token',
      payload: { discordUserId: DISCORD, joinedAt: JOINED }
    });
    assert.equal(craftClaim.status, 403);
    assert.equal(craftClaim.body.error, 'craft-token-scope');
    const trusted = await request({
      port,
      method: 'POST',
      path: '/mc/starter-kit/claim',
      token: 'sentinal-token',
      payload: { discordUserId: DISCORD, joinedAt: Date.now() }
    });
    assert.equal(trusted.status, 200);
    assert.equal(trusted.body.ok, true, trusted.body.reason);
    assert.deepEqual(fetches, ['Bot sentinel-bot-token']);

    const fallback = service();
    await link(fallback.points, BUYER);
    fallback.points.links.get(UUID).playtimeMs = FIRST_PLAY_MS;
    const fallbackRuntime = createEconomyServer({
      token: 'sentinal-token',
      craftToken: 'craft-token',
      worker: { minecraft: fallback.points, health: () => ({ ok: true }) },
      shop: { listCatalog: () => [], pendingBuyOrders: () => [] },
      discordEnv: { NEXUS_DISCORD_GUILD_ID: GUILD, NEXUS_SENTINEL_TOKEN: 'sentinel-bot-token' },
      fetchImpl: async () => jsonResponse({}, false)
    });
    await listen(fallbackRuntime);
    const fallbackPort = fallbackRuntime.server.address().port;
    try {
      const usedBody = await request({
        port: fallbackPort,
        method: 'POST',
        path: '/mc/starter-kit/claim',
        token: 'sentinal-token',
        payload: { discordUserId: BUYER, joinedAt: JOINED }
      });
      assert.equal(usedBody.body.ok, true, usedBody.body.reason);
      const future = service();
      await link(future.points);
      future.points.links.get(UUID).playtimeMs = FIRST_PLAY_MS;
      const futureRuntime = createEconomyServer({
        token: 'sentinal-token',
        worker: { minecraft: future.points, health: () => ({ ok: true }) },
        shop: { listCatalog: () => [], pendingBuyOrders: () => [] },
        discordEnv: { NEXUS_DISCORD_GUILD_ID: GUILD, NEXUS_SENTINEL_TOKEN: 'sentinel-bot-token' },
        fetchImpl: async () => jsonResponse({}, false)
      });
      await listen(futureRuntime);
      try {
        const rejected = await request({
          port: futureRuntime.server.address().port,
          method: 'POST',
          path: '/mc/starter-kit/claim',
          token: 'sentinal-token',
          payload: { discordUserId: DISCORD, joinedAt: Date.now() + 60_000 }
        });
        assert.equal(rejected.body.reason, 'tenure-unknown');
      } finally {
        await new Promise((resolve) => futureRuntime.server.close(resolve));
      }
    } finally {
      await new Promise((resolve) => fallbackRuntime.server.close(resolve));
    }
  } finally {
    await new Promise((resolve) => runtime.server.close(resolve));
  }
});

test('ARK starter kit records tenure from the Sentinel token', async () => {
  const calls = [];
  const orders = [];
  const shop = new PostgresArkShop({
    now: () => Date.parse('2026-10-01T18:00:00Z'),
    env: {
      ARK_STARTER_KIT_ENABLED: 'true',
      ARK_SHOP_DRY_RUN: 'false',
      NEXUS_DISCORD_GUILD_ID: GUILD,
      NEXUS_SENTINEL_TOKEN: 'sentinel-bot-token'
    },
    fetchImpl: async (url, init) => {
      calls.push(init.headers.authorization);
      assert.match(String(url), /\/members\//);
      return jsonResponse({ joined_at: '2020-01-15T00:00:00.000Z' });
    },
    pool: arkPool({ orders, apiOk: true })
  });
  const claimed = await shop.claimStarterKit({ discordUserId: DISCORD, joinedAt: Date.now() + 60_000 });
  assert.equal(claimed.ok, true, claimed.reason);
  assert.deepEqual(calls, ['Bot sentinel-bot-token']);
  assert.equal(Date.parse(orders[0].metadata.joinedAt), JOINED);

  const suppliedOrders = [];
  const supplied = new PostgresArkShop({
    now: () => Date.parse('2026-10-01T18:00:00Z'),
    env: {
      ARK_STARTER_KIT_ENABLED: 'true',
      ARK_SHOP_DRY_RUN: 'false',
      NEXUS_DISCORD_GUILD_ID: GUILD,
      NEXUS_SENTINEL_TOKEN: 'sentinel-bot-token'
    },
    fetchImpl: async () => jsonResponse({}, false),
    pool: arkPool({ orders: suppliedOrders })
  });
  const fromClient = await supplied.claimStarterKit({ discordUserId: DISCORD, joinedAt: JOINED });
  assert.equal(fromClient.ok, true, fromClient.reason);
  assert.equal(Date.parse(suppliedOrders[0].metadata.joinedAt), JOINED);

  const rejectedOrders = [];
  const rejected = new PostgresArkShop({
    now: () => Date.parse('2026-10-01T18:00:00Z'),
    env: {
      ARK_STARTER_KIT_ENABLED: 'true',
      ARK_SHOP_DRY_RUN: 'false',
      NEXUS_DISCORD_GUILD_ID: GUILD,
      NEXUS_SENTINEL_TOKEN: 'sentinel-bot-token'
    },
    fetchImpl: async () => jsonResponse({}, false),
    pool: arkPool({ orders: rejectedOrders })
  });
  const future = await rejected.claimStarterKit({ discordUserId: DISCORD, joinedAt: Date.now() + 60_000 });
  assert.equal(future.ok, true, future.reason);
  assert.equal(rejectedOrders[0].metadata.joinedAt, null);
});

test('craft can read link status and the member sees a clear failure', async () => {
  assert.equal(craftRouteAllowed('GET', `/mc/link/${DISCORD}`), true);
  assert.equal(craftRouteAllowed('POST', `/mc/link/${DISCORD}`), false);
  assert.equal(craftRouteAllowed('POST', '/mc-shop/buy'), false);
  assert.equal(craftRouteAllowed('POST', '/mc-shop/quote'), false);
  assert.equal(craftRouteAllowed('POST', '/mc-shop/refund'), false);
  const runtime = createEconomyServer({
    token: 'sentinal-token',
    craftToken: 'craft-token',
    writesEnabled: false,
    worker: {
      health: () => ({ ok: true }),
      minecraft: { async status() { return { ok: true, linked: false }; } }
    },
    shop: { listCatalog: () => [], pendingBuyOrders: () => [] }
  });
  await listen(runtime);
  const port = runtime.server.address().port;
  try {
    const status = await request({ port, method: 'GET', path: `/mc/link/${DISCORD}`, token: 'craft-token' });
    assert.equal(status.status, 200);
    assert.equal(status.body.linked, false);
    const buy = await request({ port, method: 'POST', path: '/mc-shop/buy', token: 'craft-token', payload: {} });
    assert.equal(buy.status, 403);
    assert.equal(buy.body.error, 'craft-token-scope');
  } finally {
    await new Promise((resolve) => runtime.server.close(resolve));
  }

  const replies = [];
  await handleMcPointsCommand({
    commandName: 'mc',
    user: { id: DISCORD },
    options: { getSubcommand: () => 'status', getSubcommandGroup: () => 'link' },
    async reply(payload) { replies.push(payload.content); }
  }, {
    ephemeral: (text) => ({ content: text }),
    points: { async status() { throw new Error('craft-token-scope'); } }
  });
  assert.equal(replies[0], STATUS_TEXT);
  assert.equal(replies[0], mcMemberText('link-status-unavailable'));
  assert.doesNotMatch(replies[0], /token|Something went wrong/i);
});

test('shop dry-run shows a test receipt and debits nothing', async () => {
  assert.equal(mcPointsFlags({ MC_SHOP_ENABLED: 'true' }).shopDryRun, true);
  const dry = service();
  await link(dry.points);
  const quoted = await dry.points.quote({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
  assert.equal(quoted.quote.dryRun, true);
  assert.match(mcShopConfirmText(quoted.quote), /This is a test/);
  assert.doesNotMatch(mcShopConfirmText(quoted.quote), /Confirm to spend/);
  const bought = await dry.points.buy({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1, nonce: quoted.quote.nonce, writesEnabled: true });
  assert.equal(bought.ok, true);
  assert.equal(bought.dryRun, true);
  assert.equal(bought.debited, false);
  assert.equal(bought.balance, 100);
  assert.equal(bought.receipt.balanceAfter, 100);
  assert.equal(dry.points.orders.size, 0);
  assert.equal(dry.bank.calls.length, 0);
  assert.match(mcShopReceiptText(bought), /No Nexus Points were spent/);
  assert.match(mcShopReceiptText(bought), /Nothing was queued/);
  assert.doesNotMatch(mcShopReceiptText(bought), /Your order is queued/);

  const heldQuote = await dry.points.quote({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
  dry.bank.status = 'disabled';
  const held = await dry.points.buy({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1, nonce: heldQuote.quote.nonce });
  assert.equal(held.reason, 'account-hold');
  assert.equal(dry.bank.calls.length, 0);
  dry.bank.status = 'verified';
  const blockedQuote = await dry.points.quote({ discordUserId: DISCORD, sku: 'mc_food32', bundles: 1 });
  dry.bank.quarantinedValue = true;
  const blocked = await dry.points.buy({ discordUserId: DISCORD, sku: 'mc_food32', bundles: 1, nonce: blockedQuote.quote.nonce });
  assert.equal(blocked.reason, 'quarantined');

  const catalog = loadMcShopCatalog({});
  const hash = catalogFingerprint(catalog);
  const sql = [];
  const postgres = new PostgresMcPoints({
    now: () => Date.parse('2026-10-01T18:00:00Z'),
    wallet: wallet(),
    env: { MC_SHOP_ENABLED: 'true' },
    pool: {
      async query(text) {
        sql.push(String(text));
        if (String(text).includes('SELECT version')) return { rows: [{ version: MC_SCHEMA_VERSION }] };
        return { rows: [] };
      },
      async connect() {
        return {
          async query(text) {
            const query = String(text);
            sql.push(query);
            if (query === 'BEGIN' || query === 'ROLLBACK' || query === 'COMMIT') return { rows: [], rowCount: 0 };
            if (query.includes('nexus_mc_quotes') && query.includes('SELECT')) {
              return { rows: [{
                nonce: 'dry-nonce',
                consumed_at: null,
                expires_at: '2099-01-01T00:00:00.000Z',
                discord_user_id: DISCORD,
                economic_identity_id: 'econ_1',
                sku: 'mc_logs64',
                bundles: 1,
                price: 10,
                item_id: 'minecraft:oak_log',
                catalog_hash: hash
              }] };
            }
            if (query.includes('nexus_mc_orders')) return { rows: [] };
            if (query.includes('pg_advisory_xact_lock')) return { rows: [] };
            if (query.includes('nexus_mc_links') && query.includes('SELECT')) return { rows: [{ mc_uuid: 'linked' }], rowCount: 1 };
            if (query.includes('SELECT status')) return { rows: [{ status: 'verified', hold_reason: null }] };
            if (query.includes('SELECT balance')) return { rows: [{ balance: 100 }] };
            if (/\b(INSERT|UPDATE|DELETE)\b/i.test(query)) throw new Error(`dry-run wrote ${query}`);
            return { rows: [] };
          },
          release() {}
        };
      }
    }
  });
  const receipt = await postgres.buy({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1, nonce: 'dry-nonce', writesEnabled: false });
  assert.equal(receipt.dryRun, true);
  assert.equal(receipt.debited, false);
  assert.equal(receipt.balance, 100);
  assert.equal(sql.some((query) => /INSERT INTO/.test(query) && /nexus_economy_ledger|nexus_mc_orders/.test(query)), false);

  await withEnv({ MC_SHOP_DRY_RUN: null }, () => {
    assert.equal(writeGate('/mc-shop/buy', { writesEnabled: false }), null);
  });
  await withEnv({ MC_SHOP_DRY_RUN: 'false' }, () => {
    assert.equal(writeGate('/mc-shop/buy', { writesEnabled: false }).body.error, 'economy-write-cutover-not-enabled');
  });
});

test('a short link secret disables Minecraft routes and leaves the rest of the worker up', async () => {
  const short = assertMcLinkCodeSecret({ MC_POINTS_ENABLED: 'true', MC_LINK_CODE_SECRET: 'too-short' });
  assert.equal(short.ok, false);
  assert.equal(short.code, 'link-code-secret-missing');
  assert.equal(assertMcLinkCodeSecret({ MC_POINTS_ENABLED: 'false' }).ok, true);
  assert.equal(assertMcLinkCodeSecret({ MC_POINTS_ENABLED: 'true', MC_LINK_CODE_SECRET: LINK_SECRET }).ok, true);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-secret-'));
  const worker = new NexusEconomyWorker({
    store: new NexusEconomyStore(root),
    env: { MC_POINTS_ENABLED: 'true', MC_SHOP_ENABLED: 'true', MC_LINK_CODE_SECRET: 'too-short' }
  });
  worker.linkArkIdentity({ discordUserId: DISCORD, eosId: 'EOSsecret1', rankId: 'shadow-recruit' });
  const runtime = createEconomyServer({
    worker,
    token: 'sentinal-token',
    craftToken: 'craft-token',
    writesEnabled: true,
    env: { MC_POINTS_ENABLED: 'true', MC_LINK_CODE_SECRET: 'too-short' },
    mcRoutesEnabled: false
  });
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
  const port = runtime.server.address().port;
  try {
    const creditBody = JSON.stringify({ discordUserId: DISCORD, amount: 4, idempotencyKey: 'level-up-stays-up', source: 'community-level-up' });
    const credit = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port, path: '/wallet/credit', method: 'POST',
        headers: { authorization: 'Bearer sentinal-token', 'content-type': 'application/json', 'content-length': Buffer.byteLength(creditBody) }
      }, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
      });
      req.on('error', reject);
      req.end(creditBody);
    });
    assert.notEqual(credit.body.reason, 'link-code-secret-missing');
    assert.notEqual(credit.body.error, 'link-code-secret-missing');
    const quoteBody = JSON.stringify({ discordUserId: DISCORD, sku: 'mc_logs64', bundles: 1 });
    const quote = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port, path: '/mc-shop/quote', method: 'POST',
        headers: { authorization: 'Bearer sentinal-token', 'content-type': 'application/json', 'content-length': Buffer.byteLength(quoteBody) }
      }, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
      });
      req.on('error', reject);
      req.end(quoteBody);
    });
    assert.equal(quote.status, 503);
    assert.equal(quote.body.reason, 'link-code-secret-missing');
  } finally {
    runtime.server.close();
  }
});

test('an Administrator can refund one Minecraft order and named owner roles cannot', async () => {
  const api = discordApi();
  const bank = wallet(100);
  const { points } = service({
    bank,
    fetchImpl: api.fetchImpl,
    env: {
      MC_SHOP_DRY_RUN: 'false',
      NEXUS_SENTINEL_TOKEN: 'sentinel-bot-token',
      NEXUS_DISCORD_GUILD_ID: GUILD
    }
  });
  await link(points, BUYER);
  const quoted = await points.quote({ discordUserId: BUYER, sku: 'mc_logs64', bundles: 1 });
  const paid = await points.buy({ discordUserId: BUYER, sku: 'mc_logs64', bundles: 1, nonce: quoted.quote.nonce, writesEnabled: true });
  const order = points.orders.get(paid.order.orderId);
  order.status = 'SENT_UNCONFIRMED';
  const self = await points.refund({ orderId: order.orderId, reason: 'lost delivery', actor: BUYER, writesEnabled: true });
  assert.equal(self.reason, 'self-refund');
  assert.equal(mcMemberText('self-refund'), 'Nothing was refunded. Ask another staff admin to do this refund.');
  assert.equal(api.calls.length, 0);
  const refused = await points.refund({ orderId: order.orderId, reason: 'lost delivery', actor: ADMIN, writesEnabled: true, staffAuthorized: true });
  assert.equal(refused.reason, 'refund-not-allowed');
  const refunded = await points.refund({ orderId: order.orderId, reason: 'lost delivery', actor: ADMIN, writesEnabled: true, staffAuthorized: true, force: true });
  assert.equal(refunded.ok, true, refunded.reason);
  assert.equal(order.status, 'REFUNDED');
  assert.equal(points.audits.length, 1);
  assert.equal(points.audits[0].force, true);
  assert.equal(bank.balanceValue, 100);
  assert.equal(bank.calls.find((call) => call[0] === 'credit')[2].metadata.force, true);
  assert.equal(api.calls.length, 0);
  const again = await points.refund({ orderId: order.orderId, reason: 'lost delivery', actor: ADMIN, writesEnabled: true });
  assert.equal(again.duplicate, true);
  assert.equal(points.audits.length, 1);
  assert.equal(bank.calls.filter((call) => call[0] === 'credit').length, 1);

  for (const blocked of [
    { roles: [OWNER_ROLE_ID], name: 'Owner' },
    { roles: [COMMUNITY_MANAGER_ROLE_ID], name: 'Community Manager' }
  ]) {
    const blockedApi = discordApi(blocked);
    const decision = await authorizeMcRefundActor({
      actor: ADMIN,
      env: { NEXUS_DISCORD_GUILD_ID: GUILD, NEXUS_SENTINEL_TOKEN: 'sentinel-bot-token' },
      fetchImpl: blockedApi.fetchImpl
    });
    assert.equal(decision.reason, 'staff-not-authorized');
  }

  let listedFetches = 0;
  const listed = await authorizeMcRefundActor({
    actor: ADMIN,
    env: { NEXUS_MC_REFUND_STAFF_IDS: '333333333333333333', NEXUS_SENTINEL_TOKEN: 'sentinel-bot-token', NEXUS_DISCORD_GUILD_ID: GUILD },
    fetchImpl: async () => { listedFetches += 1; return jsonResponse({}); }
  });
  assert.equal(listed.reason, 'staff-not-authorized');
  assert.equal(listedFetches, 0);
  const onList = await authorizeMcRefundActor({
    actor: '333333333333333333',
    env: { NEXUS_MC_REFUND_STAFF_IDS: '333333333333333333' },
    fetchImpl: async () => { throw new Error('list does not fetch'); }
  });
  assert.equal(onList.ok, false);
  assert.equal(onList.reason, 'staff-not-authorized');

  const failedBank = wallet(100);
  const failedService = service({
    bank: failedBank,
    env: { MC_SHOP_DRY_RUN: 'false', NEXUS_MC_REFUND_STAFF_IDS: ADMIN }
  });
  await link(failedService.points, BUYER, '11111111-1111-4111-8111-111111111111');
  const failedQuote = await failedService.points.quote({ discordUserId: BUYER, sku: 'mc_logs64', bundles: 1 });
  const failedPaid = await failedService.points.buy({
    discordUserId: BUYER,
    sku: 'mc_logs64',
    bundles: 1,
    nonce: failedQuote.quote.nonce,
    writesEnabled: true
  });
  const failedOrder = failedService.points.orders.get(failedPaid.order.orderId);
  failedOrder.status = 'DELIVERY_FAILED';
  const failedRefund = await failedService.points.refund({
    orderId: failedOrder.orderId,
    reason: 'delivery failed',
    actor: ADMIN,
    writesEnabled: true,
    staffAuthorized: true
  });
  assert.equal(failedRefund.ok, true, failedRefund.reason);
  assert.equal(failedRefund.order.status, 'REFUNDED');
  assert.equal(failedBank.calls.find((call) => call[0] === 'credit')[2].metadata.force, undefined);
});

test('Craft /mcadmin refund points at Sentinal and the staff list only narrows', async () => {
  let refunds = 0;
  const points = {
    async refund() {
      refunds += 1;
      return { ok: true, order: { price: 10, orderId: 'order-1' } };
    }
  };
  async function run(interaction, env) {
    interaction.replies.length = 0;
    await handleMcPointsCommand(interaction, {
      isStaff: true,
      env,
      points,
      ephemeral: (text) => ({ content: text })
    });
    return interaction.replies[0];
  }
  const pointed = await run(refundInteraction(ADMIN, [{ id: ROLE, name: 'Administrators', permissions: '8' }]), {});
  assert.match(pointed, /\/shopadmin mc-refund/);
  assert.equal(refunds, 0);
  const listedOnly = await run(
    refundInteraction('333333333333333333', [{ id: ROLE, name: 'Member', permissions: '0' }]),
    { NEXUS_MC_REFUND_STAFF_IDS: '333333333333333333' }
  );
  assert.match(listedOnly, /\/shopadmin mc-refund/);
  assert.equal(refunds, 0);

  const staffEnv = { NEXUS_STAFF_ADMIN_ROLE_IDS: ROLE };
  assert.equal(mcRefundActorAllowed(refundInteraction(ADMIN, [{ id: ROLE, name: 'Administrators', permissions: '8' }]), staffEnv), true);
  assert.equal(mcRefundActorAllowed(refundInteraction(ADMIN, [{ id: ROLE, name: 'Moderator', permissions: '0' }]), {}), false);
  assert.equal(mcRefundActorAllowed(
    refundInteraction(ADMIN, [{ id: ROLE, name: 'Administrators', permissions: '8' }]),
    { ...staffEnv, NEXUS_MC_REFUND_STAFF_IDS: '333333333333333333' }
  ), false);
  assert.equal(mcRefundActorAllowed(
    refundInteraction('333333333333333333', [{ id: ROLE, name: 'Member', permissions: '0' }]),
    { NEXUS_MC_REFUND_STAFF_IDS: '333333333333333333' }
  ), false);
  assert.equal(mcRefundActorAllowed(refundInteraction(ADMIN, [{ id: OWNER_ROLE_ID, name: 'Owner', permissions: '8' }]), {}), true);
  assert.equal(mcRefundActorAllowed(refundInteraction(ADMIN, [{ id: '777777777777777771', name: 'Owner', permissions: '8' }]), {}), false);
  assert.equal(mcRefundActorAllowed(refundInteraction(ADMIN, [{ id: COMMUNITY_MANAGER_ROLE_ID, name: 'Community Manager', permissions: '8' }]), {}), false);
  assert.equal(mcRefundActorAllowed(refundInteraction(ADMIN, [{ id: COMMUNITY_MANAGER_ROLE_ID, name: 'Helpers', permissions: '8' }]), { NEXUS_STAFF_ADMIN_ROLE_IDS: COMMUNITY_MANAGER_ROLE_ID }), false);
  assert.equal(mcRefundActorAllowed(refundInteraction(ADMIN, [{ id: ROLE, name: 'Community Manager', permissions: '0' }]), staffEnv), true);
  assert.equal(mcRefundActorAllowed(refundInteraction(ADMIN, [
    { id: OWNER_ROLE_ID, name: 'Owner', permissions: '8' },
    { id: COMMUNITY_MANAGER_ROLE_ID, name: 'Community Manager', permissions: '8' }
  ]), {}), true);
  const fallback = mcRefundActorAllowed({
    user: { id: ADMIN },
    member: { roles: { cache: new Map() } },
    memberPermissions: { has: (bit) => BigInt(bit) === BigInt(PermissionFlagsBits.Administrator) }
  }, {});
  assert.equal(fallback, false);
  assert.equal(mcRefundActorAllowed(refundInteraction(ADMIN, [], false), {}), false);
  const guildOwner = refundInteraction(ADMIN, [{ id: '777777777777777771', name: 'Owner', permissions: '0' }]);
  guildOwner.guild.ownerId = ADMIN;
  assert.equal(mcRefundActorAllowed(guildOwner, {}), true);
  assert.match(craftHelpText({ MC_POINTS_ENABLED: 'true' }), /\/mcadmin refund/);
  assert.ok(craftHelpText({ MC_POINTS_ENABLED: 'true', MC_SHOP_ENABLED: 'true', MC_STARTER_KIT_ENABLED: 'true' }).length <= 1900);
});

test('playtime dry-run does not stop the Minecraft delivery loop', () => {
  const deliveryLoop = Symbol.for('khaos.nexus.craft.mc.delivery');
  delete globalThis[deliveryLoop];
  const started = installMcEconomyLoops({
    store: { getServer() { return null; } },
    env: {
      NEXUS_ECONOMY_URL: 'http://127.0.0.1:9',
      NEXUS_ECONOMY_CRAFT_TOKEN: 'craft-token',
      MC_POINTS_ENABLED: 'true',
      MC_SHOP_DELIVERY_ENABLED: 'true'
    }
  });
  assert.equal(globalThis[deliveryLoop], true);
  assert.ok(started.timers.length > 0);
  for (const timer of started.timers) clearInterval(timer);
  delete globalThis[deliveryLoop];
  delete globalThis[Symbol.for('khaos.nexus.craft.mc.playtime')];
  delete globalThis[Symbol.for('khaos.nexus.craft.mc.refund-sweep')];
});

test('Sentinal previews and refunds a Minecraft order and Craft cannot', async () => {
  const bank = wallet(100);
  const { points } = service({
    bank,
    env: {
      MC_POINTS_ENABLED: 'true',
      MC_SHOP_ENABLED: 'true',
      MC_SHOP_DRY_RUN: 'false',
      MC_LINK_CODE_SECRET: LINK_SECRET
    }
  });
  await link(points, BUYER);
  const quoted = await points.quote({ discordUserId: BUYER, sku: 'mc_logs64', bundles: 1 });
  const paid = await points.buy({ discordUserId: BUYER, sku: 'mc_logs64', bundles: 1, nonce: quoted.quote.nonce, writesEnabled: true });
  paid.order.status = 'DELIVERY_FAILED';
  const runtime = createEconomyServer({
    worker: {
      minecraft: points,
      health: () => ({ ok: true }),
      credit: async (input) => points.wallet.credit(input),
      spend: async (input) => points.wallet.spend(input)
    },
    token: 'sentinal-token',
    craftToken: 'craft-token',
    writesEnabled: true,
    mcRoutesEnabled: true
  });
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
  const port = runtime.server.address().port;
  try {
    await withEnv({
      NEXUS_ECONOMY_URL: `http://127.0.0.1:${port}`,
      NEXUS_ECONOMY_CRAFT_TOKEN: 'craft-token',
      NEXUS_ECONOMY_TOKEN: 'sentinal-token'
    }, async () => {
      await assert.rejects(
        () => httpMinecraftPoints().refund({ orderId: paid.order.orderId, reason: 'from craft', actor: ADMIN }),
        /craft-token-scope/
      );
      assert.notEqual(points.orders.get(paid.order.orderId).status, 'REFUNDED');
      const interaction = refundInteraction(ADMIN, [{ id: ROLE, name: 'Administrators', permissions: '8' }]);
      interaction.commandName = 'shopadmin';
      interaction.isChatInputCommand = () => true;
      interaction.options.getSubcommand = () => 'mc-refund';
      interaction.options.getBoolean = () => false;
      interaction.options.getString = (name) => (name === 'order' ? paid.order.orderId : 'delivery failed in game');
      const staffEnv = { NEXUS_STAFF_ADMIN_ROLE_IDS: ROLE };
      await handleArkShopInteraction(interaction, { economyClient: new NexusEconomyClient(), env: staffEnv });
      assert.match(interaction.replies.at(-1), /Preview/);
      assert.notEqual(points.orders.get(paid.order.orderId).status, 'REFUNDED');
      interaction.options.getBoolean = (name) => name === 'confirm';
      await handleArkShopInteraction(interaction, { economyClient: new NexusEconomyClient(), env: staffEnv });
      assert.match(interaction.replies.at(-1), /Refunded/);
      assert.match(interaction.replies.at(-1), /This order cannot be refunded again/);
      assert.doesNotMatch(interaction.replies.at(-1), /shopadmin lookup/);
      assert.doesNotMatch(interaction.replies.at(-1), /audit is stored/);
      assert.equal(points.orders.get(paid.order.orderId).status, 'REFUNDED');
    });
  } finally {
    runtime.server.close();
  }
});

test('the kit clock uses dry-run playtime and does not require live Point credits', async () => {
  const observed = mcPointsFlags({ MC_POINTS_ENABLED: 'true', MC_STARTER_KIT_ENABLED: 'true' });
  assert.equal(observed.playtimeEnabled, false);
  assert.equal(observed.playtimeWrites, false);
  assert.equal(observed.kitPlaytimeObservation, true);
  assert.equal(mcPointsFlags({
    MC_POINTS_ENABLED: 'true',
    MC_STARTER_KIT_ENABLED: 'true',
    MC_PLAYTIME_NP_ENABLED: 'true'
  }).kitPlaytimeObservation, false);
  assert.equal(mcPointsFlags({
    MC_POINTS_ENABLED: 'true',
    MC_STARTER_KIT_ENABLED: 'true',
    MC_PLAYTIME_DRY_RUN: 'false'
  }).kitPlaytimeObservation, false);

  const commands = [];
  const posts = [];
  const listed = `There are 1 of a max of 20 players online: Steve (${UUID})`;
  const rcon = async (command) => {
    commands.push(String(command));
    if (command === 'list uuids') return listed;
    if (String(command).endsWith('Pos')) return '[1.0d, 64.0d, 2.0d]';
    if (String(command).endsWith('Rotation')) return '[10.0f, 20.0f]';
    return '';
  };
  const posted = await pollMcPlaytime({
    rcon,
    presence: async (input) => { posts.push(input); },
    now: () => 0,
    env: { MC_POINTS_ENABLED: 'true', MC_STARTER_KIT_ENABLED: 'true' }
  });
  assert.equal(posted.posted, 1);
  assert.equal(posts[0].provider, 'minecraft');
  assert.equal(commands.some((command) => command.startsWith('give ')), false);
  const silent = await pollMcPlaytime({
    rcon,
    presence: async () => { posts.push('live'); },
    now: () => 0,
    env: { MC_POINTS_ENABLED: 'true', MC_STARTER_KIT_ENABLED: 'true', MC_PLAYTIME_DRY_RUN: 'false' }
  });
  assert.equal(silent.posted, 0);
  assert.equal(posts.length, 1);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-kit-clock-'));
  let now = Date.parse('2026-10-01T16:00:00Z');
  const worker = new NexusEconomyWorker({
    store: new NexusEconomyStore(root),
    now: () => now,
    env: {
      MC_POINTS_ENABLED: 'true',
      MC_STARTER_KIT_ENABLED: 'true',
      MC_LINK_CODE_SECRET: LINK_SECRET
    }
  });
  worker.linkArkIdentity({ discordUserId: DISCORD, eosId: 'EOSkitclock1', rankId: 'shadow-recruit' });
  const challenge = await worker.minecraft.challenge({ discordUserId: DISCORD, mcUuid: UUID, mcName: 'Steve' });
  assert.equal((await worker.minecraft.confirm({ discordUserId: DISCORD, code: challenge.code })).ok, true);
  const first = await worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
  assert.equal(first.dryRun, true);
  assert.equal(first.credited, 0);
  now += 5 * 60 * 1000;
  const second = await worker.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
  assert.equal(second.credited, 0);
  assert.equal(second.dryRun, true);
  assert.ok(second.playtimeMs > 0);
  assert.equal(worker.balance(DISCORD), 0);
  assert.equal(worker.store.read().accounts[DISCORD].online, false);

  const writes = [];
  const accrual = new PostgresEconomyAccrual({
    env: { MC_POINTS_ENABLED: 'true', MC_STARTER_KIT_ENABLED: 'true' },
    pool: {
      async connect() {
        return {
          async query(sql) {
            writes.push(String(sql));
            if (/\b(INSERT|UPDATE|DELETE)\b/i.test(String(sql))) throw new Error(`observation wrote ${sql}`);
            return { rows: [] };
          },
          release() {}
        };
      }
    }
  });
  const unlinked = await accrual.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' });
  assert.equal(unlinked.reason, 'unlinked-player');
  assert.equal(unlinked.credited, 0);
  assert.equal(unlinked.dryRun, true);
  const disabled = new PostgresEconomyAccrual({
    env: { MC_POINTS_ENABLED: 'true' },
    pool: { async connect() { throw new Error('should not connect'); } }
  });
  assert.equal((await disabled.recordPresence({ provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' })).reason, 'mc-playtime-disabled');

  await withEnv({
    MC_POINTS_ENABLED: 'true',
    MC_STARTER_KIT_ENABLED: 'true',
    MC_PLAYTIME_NP_ENABLED: null,
    MC_PLAYTIME_DRY_RUN: null
  }, async () => {
    const seen = [];
    const runtime = createEconomyServer({
      token: 'sentinal-token',
      craftToken: 'craft-token',
      writesEnabled: false,
      presenceWritesEnabled: false,
      worker: {
        health: () => ({ ok: true }),
        recordPresence: async (input) => { seen.push(input); return { ok: true, dryRun: true, credited: 0 }; }
      },
      shop: { listCatalog: () => [], pendingBuyOrders: () => [] }
    });
    await listen(runtime);
    const port = runtime.server.address().port;
    try {
      const minecraft = await request({
        port,
        method: 'POST',
        path: '/presence',
        token: 'craft-token',
        payload: { provider: 'minecraft', mcUuid: UUID, online: true, server: 'minecraft' }
      });
      assert.equal(minecraft.status, 200);
      assert.equal(minecraft.body.credited, 0);
      assert.equal(seen.length, 1);
      const ark = await request({
        port,
        method: 'POST',
        path: '/presence',
        token: 'craft-token',
        payload: { provider: 'ark', eosId: 'EOS12345678', online: true }
      });
      assert.equal(ark.status, 503);
      assert.equal(ark.body.error, 'economy-presence-writes-not-enabled');
      assert.equal(seen.length, 1);
    } finally {
      await new Promise((resolve) => runtime.server.close(resolve));
    }
  });
});

test('Craft watch paths include the shared and worker Minecraft files', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../docs/ops/NEXUS_CRAFT.md'), 'utf8');
  assert.match(doc, /src\/shared\/mc-\*\.cjs/);
  assert.match(doc, /src\/economy-worker\/mc-\*\.cjs/);
  assert.match(doc, /does not require `MC_PLAYTIME_NP_ENABLED`/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../src/economy-worker/server.cjs'), 'utf8'), /railway\.toml/);
});

function refundInteraction(userId, roles, permissionsHas = false) {
  const replies = [];
  return {
    commandName: 'mcadmin',
    user: { id: userId },
    guild: { id: GUILD, ownerId: '777777777777777777' },
    replies,
    member: { roles: { cache: new Map(roles.map((role) => [role.id, role])) } },
    memberPermissions: { has: () => permissionsHas },
    options: {
      getSubcommand: () => 'refund',
      getSubcommandGroup: () => false,
      getString(name) {
        if (name === 'order') return 'order-1';
        if (name === 'reason') return 'delivery failed in game';
        return '';
      }
    },
    async reply(payload) { replies.push(payload.content); }
  };
}

function arkPool({ orders }) {
  return {
    async query(text) {
      if (String(text).includes('SELECT version')) return { rows: [{ version: MC_SCHEMA_VERSION }] };
      return { rows: [] };
    },
    async connect() {
      return {
        async query(text, params = []) {
          const query = String(text);
          if (query === 'BEGIN' || query === 'COMMIT' || query === 'ROLLBACK') return { rows: [], rowCount: 0 };
          if (query.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
          if (query.includes("provider = 'discord'")) {
            return { rows: [{ economic_identity_id: 'econ_ark', status: 'verified', hold_reason: null }] };
          }
          if (query.includes("provider = 'eos'")) return { rows: [{ external_id: 'EOSarkkit1' }] };
          if (query.includes('FOR UPDATE')) return { rows: [{ status: 'verified', hold_reason: null }] };
          if (query.includes('nexus_mc_grants') && query.includes('SELECT')) return { rows: [] };
          if (query.includes('nexus_economy_wallets') && query.includes('INSERT')) return { rows: [], rowCount: 1 };
          if (query.includes('SELECT balance')) return { rows: [{ balance: 0 }] };
          if (query.includes('INSERT INTO') && query.includes('nexus_mc_orders')) {
            orders.push(JSON.parse(params[1]));
            return { rows: [], rowCount: 1 };
          }
          if (query.includes('nexus_mc_outbox')) return { rows: [], rowCount: 1 };
          if (query.includes('nexus_mc_grants') && query.includes('INSERT')) return { rows: [{ grant_id: 'grant' }], rowCount: 1 };
          return { rows: [], rowCount: 0 };
        },
        release() {}
      };
    }
  };
}
