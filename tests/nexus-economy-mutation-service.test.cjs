'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NexusEconomyMutationService } = require('../src/sentinel/nexus-economy-mutation-service.cjs');

function fixture(env = { NEXUS_ECONOMY_AUTHORITY: 'nexus' }) {
  const calls = [];
  const wallet = {
    async credit(input) { calls.push(['credit', input]); return { ok: true, duplicate: false, balance: 50, transactionId: 'tx-1' }; },
    async spend(input) { calls.push(['spend', input]); return { ok: true, duplicate: false, balance: 30, transactionId: 'tx-2' }; }
  };
  const auditRows = [];
  const audit = { async record(row) { auditRows.push(row); } };
  const times = [new Date('2026-09-11T03:00:00Z'), new Date('2026-09-11T03:00:01Z')];
  const service = new NexusEconomyMutationService({ wallet, audit, env, now: () => times.shift() || new Date('2026-09-11T03:00:02Z') });
  return { service, calls, auditRows };
}

test('wallet credit requires Nexus authority and records audit before mutation', async () => {
  const { service, calls, auditRows } = fixture({ NEXUS_ECONOMY_AUTHORITY: 'compatibility' });
  await assert.rejects(
    service.credit({ discordUserId: '111', amount: 50, idempotencyKey: 'cache_1' }, { actor: 'sentinel-worker' }),
    (error) => error?.code === 'NEXUS_ECONOMY_MUTATION_DENIED'
  );
  assert.equal(calls.length, 0);
  assert.equal(auditRows.length, 0);
});

test('audit failure blocks wallet mutation before balance can change', async () => {
  let walletCalls = 0;
  const service = new NexusEconomyMutationService({
    wallet: {
      async credit() { walletCalls += 1; return { ok: true }; },
      async spend() { walletCalls += 1; return { ok: true }; }
    },
    audit: { async record() { throw new Error('audit unavailable'); } },
    env: { NEXUS_ECONOMY_AUTHORITY: 'nexus' }
  });
  await assert.rejects(
    service.credit({ discordUserId: '111', amount: 1, idempotencyKey: 'credit_1' }, { actor: 'owner' }),
    /audit unavailable/
  );
  assert.equal(walletCalls, 0);
});

test('credit writes attempt and result audit records around the wallet mutation', async () => {
  const { service, calls, auditRows } = fixture();
  const result = await service.credit(
    { discordUserId: '111', amount: 50, idempotencyKey: 'cache_1' },
    { actor: 'sentinel-worker', metadata: { source: 'dino-cache' } }
  );
  assert.equal(result.transactionId, 'tx-1');
  assert.equal(calls.length, 1);
  assert.equal(auditRows.length, 2);
  assert.equal(auditRows[0].type, 'economy.mutation.attempt');
  assert.equal(auditRows[0].operation, 'wallet-credit');
  assert.equal(auditRows[0].actor, 'sentinel-worker');
  assert.equal(auditRows[0].idempotencyKey, 'cache_1');
  assert.deepEqual(auditRows[0].metadata, { source: 'dino-cache' });
  assert.equal(auditRows[1].type, 'economy.mutation.result');
  assert.equal(auditRows[1].transactionId, 'tx-1');
  assert.equal(auditRows[1].balance, 50);
});

test('spend uses order id as the audited idempotency identity', async () => {
  const { service, auditRows } = fixture();
  const result = await service.spend(
    { discordUserId: '222', amount: 20, orderId: 'ORDER_9' },
    { actor: 'cluster-shop' }
  );
  assert.equal(result.transactionId, 'tx-2');
  assert.equal(auditRows[0].operation, 'wallet-spend');
  assert.equal(auditRows[0].idempotencyKey, 'ORDER_9');
  assert.equal(auditRows[1].ok, true);
});

test('actor is mandatory and validation happens before audit or wallet mutation', async () => {
  const { service, calls, auditRows } = fixture();
  await assert.rejects(
    service.credit({ discordUserId: '111', amount: 1, idempotencyKey: 'credit_2' }, {}),
    /Actor is required/
  );
  assert.equal(calls.length, 0);
  assert.equal(auditRows.length, 0);
});
