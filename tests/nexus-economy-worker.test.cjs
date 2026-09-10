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
