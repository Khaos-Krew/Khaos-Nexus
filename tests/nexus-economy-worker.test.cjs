'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NexusEconomyStore, NexusEconomyWorker } = require('../src/sentinel/nexus-economy-worker.cjs');

function fixture(now = Date.parse('2026-09-10T12:00:00Z')) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-economy-'));
  let clock = now;
  const worker = new NexusEconomyWorker({
    store: new NexusEconomyStore(root),
    now: () => clock,
    onlineRates: { 'shadow-recruit': 2, 'cipher-runner': 4, 'nexus-raider': 4, 'khaos-warden': 4, 'blackout-legend': 4, 'origin-founder': 4 },
    offlineRates: { 'shadow-recruit': 0, 'cipher-runner': 4, 'nexus-raider': 6, 'khaos-warden': 8, 'blackout-legend': 10, 'origin-founder': 10 }
  });
  return { root, worker, advance: (ms) => { clock += ms; } };
}

test('links an EOS identity to one Discord wallet', () => {
  const { worker } = fixture();
  const linked = worker.linkArkIdentity({ discordUserId: '111', eosId: 'EOS_abc12345', rankId: 'shadow-recruit' });
  assert.equal(linked.discordUserId, '111');
  assert.equal(worker.accountByEos('EOS_abc12345').discordUserId, '111');
});

test('paid ranks accrue capped offline passive income while free rank does not', async () => {
  const paid = fixture();
  paid.worker.linkArkIdentity({ discordUserId: '222', eosId: 'EOS_paid12345', rankId: 'blackout-legend' });
  paid.advance(3 * 60 * 60_000);
  const result = await paid.worker.accrueOffline('222');
  assert.equal(result.credited, 30);
  assert.equal(result.balance, 30);

  const free = fixture();
  free.worker.linkArkIdentity({ discordUserId: '333', eosId: 'EOS_free12345', rankId: 'shadow-recruit' });
  free.advance(3 * 60 * 60_000);
  const freeResult = await free.worker.accrueOffline('333');
  assert.equal(freeResult.credited, 0);
  assert.equal(freeResult.balance, 0);
});

test('purchase debit is idempotent', async () => {
  const { worker } = fixture();
  worker.linkArkIdentity({ discordUserId: '444', eosId: 'EOS_buy12345', rankId: 'cipher-runner' });
  await worker.credit({ discordUserId: '444', amount: 100, idempotencyKey: 'seed:444' });
  const first = await worker.spend({ discordUserId: '444', amount: 25, orderId: 'NX-1' });
  const second = await worker.spend({ discordUserId: '444', amount: 25, orderId: 'NX-1' });
  assert.equal(first.balance, 75);
  assert.equal(second.balance, 75);
  assert.equal(second.duplicate, true);
});


test('concurrent offline accrual for different players preserves both credits', async () => {
  const f = fixture();
  for (const id of ['111', '222']) f.worker.linkArkIdentity({ discordUserId: id, eosId: `EOS_${id}`, rankId: 'blackout-legend' });
  f.advance(3_600_000);
  await Promise.all(['111', '222'].map(id => f.worker.accrueOffline(id)));
  assert.equal(f.worker.balance('111'), 10);
  assert.equal(f.worker.balance('222'), 10);
});

test('offline cap cannot be bypassed by repeated wallet reads and login settles income', async () => {
  const f = fixture();
  f.worker.linkArkIdentity({ discordUserId: '111', eosId: 'EOS_login', rankId: 'blackout-legend' });
  f.advance(100 * 3_600_000);
  assert.equal((await f.worker.accrueOffline('111')).credited, 480);
  assert.equal((await f.worker.accrueOffline('111')).credited, 0);
  f.advance(3_600_000);
  await f.worker.recordPresence({ eosId: 'EOS_login', online: true, server: 'gen1' });
  assert.equal(f.worker.balance('111'), 490);
});

test('idempotency keys are normalized, required, and bound to account and amount', async () => {
  const { worker } = fixture();
  await worker.credit({ discordUserId: '111', amount: 50, idempotencyKey: ' event ' });
  assert.equal((await worker.credit({ discordUserId: '111', amount: 50, idempotencyKey: 'event' })).duplicate, true);
  await assert.rejects(worker.credit({ discordUserId: '111', amount: 51, idempotencyKey: 'event' }), /conflicts/);
  await assert.rejects(worker.credit({ discordUserId: '222', amount: 50, idempotencyKey: 'event' }), /conflicts/);
  await assert.rejects(worker.credit({ discordUserId: '111', amount: 50 }), /idempotency/);
  assert.equal(worker.balance('111'), 50);
});

test('wallet cannot overflow and restart retains dedupe receipts', async () => {
  const { root, worker } = fixture();
  await worker.credit({ discordUserId: '111', amount: Number.MAX_SAFE_INTEGER, idempotencyKey: 'max' });
  await assert.rejects(worker.credit({ discordUserId: '111', amount: 1, idempotencyKey: 'overflow' }), /safe integer/);
  const restarted = new NexusEconomyWorker({ store: new NexusEconomyStore(root) });
  assert.equal((await restarted.credit({ discordUserId: '111', amount: Number.MAX_SAFE_INTEGER, idempotencyKey: 'max' })).duplicate, true);
});

test('cross-map presence earns once into the same Discord wallet', async () => {
  const f = fixture();
  f.worker.linkArkIdentity({ discordUserId: '111', eosId: 'EOS_maps', rankId: 'shadow-recruit' });
  await f.worker.recordPresence({ eosId: 'EOS_maps', online: true, server: 'gen1' });
  await f.worker.recordPresence({ eosId: 'EOS_maps', online: true, server: 'map2' });
  f.advance(300_000);
  await Promise.all(['gen1', 'map2'].map(server => f.worker.recordPresence({ eosId: 'EOS_maps', online: true, server })));
  assert.equal(f.worker.balance('111'), 2);
});
