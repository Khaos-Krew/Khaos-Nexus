'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { installIdentityProjectionHooks } = require('../src/sentinel/nexus-economy-identity-sync-extension.cjs');
const { NexusEconomyClient } = require('../src/sentinel/nexus-economy-client.cjs');

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('verified ARK links and rank syncs are projected to the Nexus wallet immediately', async () => {
  const links = [];
  class FakeIdentityStore {
    verifyChallenge() {
      return {
        ok: true,
        profile: {
          discordUserId: '123456789012345678',
          rankId: 'shadow-recruit',
          arkAccounts: [{ eosId: '0002walletrepair' }]
        }
      };
    }

    updateRank() {
      return {
        ok: true,
        changed: true,
        profile: {
          discordUserId: '123456789012345678',
          rankId: 'blackout-legend',
          arkAccounts: [{ eosId: '0002walletrepair' }]
        }
      };
    }
  }

  const installed = installIdentityProjectionHooks({
    IdentityStoreClass: FakeIdentityStore,
    economyClientFactory: () => ({
      configured: () => true,
      linkIdentity: async (input) => { links.push(input); return { ok: true }; }
    }),
    logger: { warn() {} }
  });
  assert.equal(installed, true);
  assert.equal(installIdentityProjectionHooks({ IdentityStoreClass: FakeIdentityStore }), false);

  const store = new FakeIdentityStore();
  const verified = store.verifyChallenge();
  assert.equal(verified.ok, true);
  await tick();
  assert.deepEqual(links[0], {
    discordUserId: '123456789012345678',
    eosId: '0002walletrepair',
    rankId: 'shadow-recruit'
  });

  const ranked = store.updateRank();
  assert.equal(ranked.changed, true);
  await tick();
  assert.deepEqual(links[1], {
    discordUserId: '123456789012345678',
    eosId: '0002walletrepair',
    rankId: 'blackout-legend'
  });
});

test('wallet reads and shop buys repair a locally verified identity before using the economy worker', async (t) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, path: req.url, body: raw ? JSON.parse(raw) : null });
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url?.startsWith('/wallet/')) res.end(JSON.stringify({ ok: true, wallet: { balance: 25 } }));
      else if (req.url === '/shop/buy') res.end(JSON.stringify({ ok: true, order: { id: 'order-test' } }));
      else res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const priorUrl = process.env.NEXUS_ECONOMY_URL;
  const priorToken = process.env.NEXUS_ECONOMY_TOKEN;
  t.after(() => {
    if (priorUrl == null) delete process.env.NEXUS_ECONOMY_URL; else process.env.NEXUS_ECONOMY_URL = priorUrl;
    if (priorToken == null) delete process.env.NEXUS_ECONOMY_TOKEN; else process.env.NEXUS_ECONOMY_TOKEN = priorToken;
  });

  const address = server.address();
  process.env.NEXUS_ECONOMY_URL = `http://127.0.0.1:${address.port}`;
  process.env.NEXUS_ECONOMY_TOKEN = 'wallet-link-repair-test-token';

  const profile = {
    discordUserId: '123456789012345678',
    rankId: 'nexus-raider',
    arkAccounts: [{ eosId: '0002walletrepair' }]
  };
  const client = new NexusEconomyClient({
    identityStoreFactory: () => ({ profileByDiscord: (id) => id === profile.discordUserId ? profile : null })
  });

  const wallet = await client.wallet(profile.discordUserId);
  assert.equal(wallet.wallet.balance, 25);
  assert.deepEqual(requests.slice(0, 2).map((item) => item.path), [
    '/identity/link',
    `/wallet/${profile.discordUserId}`
  ]);
  assert.deepEqual(requests[0].body, {
    discordUserId: profile.discordUserId,
    eosId: '0002walletrepair',
    rankId: 'nexus-raider'
  });

  const buy = await client.shopBuy({
    discordUserId: profile.discordUserId,
    eosId: '0002walletrepair',
    itemId: 'test-item',
    bundles: 1,
    idempotencyKey: 'wallet-repair-test-order'
  });
  assert.equal(buy.ok, true);
  assert.deepEqual(requests.slice(2, 4).map((item) => item.path), ['/identity/link', '/shop/buy']);
});

test('shop buy fails closed when identity projection fails', async (t) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    res.writeHead(req.url === '/identity/link' ? 503 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url === '/identity/link' ? { error: 'projection unavailable' } : { ok: true }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const priorUrl = process.env.NEXUS_ECONOMY_URL;
  const priorToken = process.env.NEXUS_ECONOMY_TOKEN;
  t.after(() => {
    if (priorUrl == null) delete process.env.NEXUS_ECONOMY_URL; else process.env.NEXUS_ECONOMY_URL = priorUrl;
    if (priorToken == null) delete process.env.NEXUS_ECONOMY_TOKEN; else process.env.NEXUS_ECONOMY_TOKEN = priorToken;
  });
  const address = server.address();
  process.env.NEXUS_ECONOMY_URL = `http://127.0.0.1:${address.port}`;
  process.env.NEXUS_ECONOMY_TOKEN = 'wallet-link-repair-test-token';

  const client = new NexusEconomyClient({
    identityStoreFactory: () => ({
      profileByDiscord: () => ({
        discordUserId: '123456789012345678',
        rankId: 'shadow-recruit',
        arkAccounts: [{ eosId: '0002walletrepair' }]
      })
    })
  });

  await assert.rejects(
    client.shopBuy({ discordUserId: '123456789012345678', itemId: 'test-item', bundles: 1 }),
    /projection unavailable/
  );
  assert.deepEqual(requests, ['/identity/link']);
});
