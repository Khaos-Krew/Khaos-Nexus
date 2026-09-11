'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NexusEconomyWorker, NexusEconomyStore } = require('../src/sentinel/nexus-economy-worker.cjs');
const { ArkEconomyPresenceBridge } = require('../src/sentinel/ark-economy-presence-bridge.cjs');
const { withRewardsLock } = require('../src/sentinel/rewards-ascended-lock.cjs');
const { itemRewardEntry } = require('../src/sentinel/cluster-shop-rewards-delivery.cjs');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-presence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let now = Date.now();
  const worker = new NexusEconomyWorker({ store: new NexusEconomyStore(dir), now: () => now });
  worker.linkArkIdentity({ discordUserId: '1234567890', eosId: 'EOS_alpha_123', rankId: 'cipher-runner' });
  return { worker, advance: ms => { now += ms; }, snapshot: (server, eosIds) => worker.recordPresenceSnapshot({ server, eosIds, observedAt: new Date(now).toISOString() }) };
}

test('fresh map snapshots recover missed logout after bridge restart without losing other map presence', async t => {
  const f = fixture(t);
  await f.snapshot('gen1', ['EOS_alpha_123']);
  await f.snapshot('map2', ['EOS_alpha_123']);
  f.advance(60_000);
  await f.snapshot('gen1', []);
  assert.equal(f.worker.wallet('1234567890').online, true);
  await f.snapshot('map2', []);
  assert.equal(f.worker.wallet('1234567890').online, false);
});

test('stale and duplicate snapshots cannot keep generating income', async t => {
  const f = fixture(t);
  await f.snapshot('gen1', ['EOS_alpha_123']);
  assert.equal((await f.snapshot('gen1', ['EOS_alpha_123'])).duplicate, true);
  f.advance(20 * 60_000);
  await f.worker.accrueOffline('1234567890');
  assert.equal(f.worker.wallet('1234567890').online, false);
  assert.equal(f.worker.balance('1234567890'), 0);
  await assert.rejects(f.worker.recordPresenceSnapshot({ server: 'gen1', eosIds: [], observedAt: '2000-01-01' }), /fresh/);
});

test('identity snapshot revokes old EOS ownership without moving wallet balances', async t => {
  const f = fixture(t);
  await f.worker.credit({ discordUserId: '1234567890', amount: 25, idempotencyKey: 'seed' });
  await f.snapshot('gen1', ['EOS_alpha_123']);
  const result = f.worker.syncIdentitySnapshot({ profiles: [{ discordUserId: '9876543210', eosIds: ['EOS_alpha_123'], rankId: 'shadow-recruit' }], observedAt: new Date().toISOString() });
  assert.equal(result.linked, 1);
  assert.equal(f.worker.accountByEos('EOS_alpha_123').discordUserId, '9876543210');
  assert.equal(f.worker.balance('1234567890'), 25);
  assert.equal(f.worker.balance('9876543210'), 0);
  assert.equal(f.worker.wallet('1234567890').online, false);
});

test('bridge rejects incomplete and stale registry results rather than inventing logouts', async () => {
  const calls = [];
  const bridge = new ArkEconomyPresenceBridge({ client: { configured: () => true, presenceSnapshot: async data => { calls.push(data); return { ok: true }; } } });
  const now = new Date().toISOString();
  await bridge.syncServers([
    { id: 'good', runtime: { state: 'online', players: [], playerCount: 0, lastCheckedAt: now } },
    { id: 'missing', runtime: { state: 'online', players: [], playerCount: 3, lastCheckedAt: now } },
    { id: 'stale', runtime: { state: 'online', players: [], lastCheckedAt: '2000-01-01' } },
    { id: 'bad', runtime: { state: 'offline', players: [], lastCheckedAt: now } }
  ]);
  assert.deepEqual(calls.map(c => c.server), ['good']);
});

test('shared reward lock serializes config/reload/send for one map and releases after failure', async () => {
  const events = [];
  await Promise.all([
    withRewardsLock('ARK_GEN1', async () => { events.push('cache-config'); await new Promise(r => setImmediate(r)); await withRewardsLock('ARK_GEN1', async () => events.push('cache-send')); }),
    withRewardsLock('ARK_GEN1', async () => { events.push('shop-config'); events.push('shop-send'); })
  ]);
  assert.deepEqual(events, ['cache-config', 'cache-send', 'shop-config', 'shop-send']);
  await assert.rejects(withRewardsLock('ARK_GEN1', async () => { throw new Error('fail'); }), /fail/);
  assert.equal(await withRewardsLock('ARK_GEN1', async () => 'recovered'), 'recovered');
});

test('every launch catalog item preserves its existing price/quantity and builds a delivery payload', () => {
  const catalog = require('../config/ark/cluster-shop-catalog.json');
  const original = require('../config/ark/wshop/nexus-wshop-migration.json').wshop.nativeCatalog.ShopItems;
  assert.equal(catalog.length, 42);
  for (const item of catalog) {
    assert.equal(item.buyPrice, original[item.id].Price);
    assert.equal(item.baseQuantity, original[item.id].Items[0].Amount);
    assert.equal(item.sellable, false);
    const reward = itemRewardEntry({ quote: { ...item, totalQuantity: item.baseQuantity * item.maxBundles } });
    assert.equal(reward.Items[0].Amount, item.baseQuantity * item.maxBundles);
  }
});
