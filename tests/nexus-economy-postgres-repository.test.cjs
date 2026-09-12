'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NexusEconomyPostgresRepository, sqlIdent } = require('../src/sentinel/nexus-economy-postgres-repository.cjs');

function fakePool(handler) {
  const calls = [];
  const client = {
    async query(text, params = []) {
      calls.push({ scope: 'client', text, params });
      return handler(text, params, 'client');
    },
    release() { calls.push({ scope: 'release' }); }
  };
  return {
    calls,
    pool: {
      async connect() { calls.push({ scope: 'connect' }); return client; },
      async query(text, params = []) {
        calls.push({ scope: 'pool', text, params });
        return handler(text, params, 'pool');
      }
    }
  };
}

test('schema identifiers are validated before interpolation', () => {
  assert.equal(sqlIdent('public'), '"public"');
  assert.equal(sqlIdent('sentinel_v2'), '"sentinel_v2"');
  assert.throws(() => sqlIdent('public; DROP TABLE x'), /invalid/);
});

test('schema SQL is inert DDL with durable account and idempotent ledger constraints', () => {
  const sql = NexusEconomyPostgresRepository.schemaSql({ schema: 'sentinel_v2' });
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "sentinel_v2"\.nexus_economy_accounts/);
  assert.match(sql, /balance BIGINT NOT NULL DEFAULT 0 CHECK \(balance >= 0\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "sentinel_v2"\.nexus_economy_ledger/);
  assert.match(sql, /idempotency_key TEXT NOT NULL UNIQUE/);
  assert.match(sql, /REFERENCES "sentinel_v2"\.nexus_economy_accounts/);
});

test('repository serializes one wallet transaction with an advisory lock and commits', async () => {
  const { pool, calls } = fakePool((text) => {
    if (/SELECT discord_user_id, balance .*FOR UPDATE/s.test(text)) return { rows: [{ discord_user_id: '42', balance: '10' }] };
    if (/INSERT INTO .*nexus_economy_ledger/s.test(text)) return { rows: [{ id: '99' }] };
    return { rows: [] };
  });
  const repository = new NexusEconomyPostgresRepository({ pool });
  const result = await repository.transact('42', async (tx) => {
    const account = await tx.getOrCreateAccount('42');
    assert.equal(Number(account.balance), 10);
    const entry = await tx.appendLedger({
      discordUserId: '42', amount: 5, balanceAfter: 15, type: 'credit', source: 'test',
      idempotencyKey: 'credit_1', metadata: { reason: 'test' }, at: '2026-09-11T00:00:00.000Z'
    });
    await tx.setBalance('42', 15);
    return entry.id;
  });
  assert.equal(result, '99');
  assert.ok(calls.some((call) => call.text === 'BEGIN'));
  assert.ok(calls.some((call) => /pg_advisory_xact_lock/.test(call.text)));
  assert.ok(calls.some((call) => call.text === 'COMMIT'));
  assert.equal(calls.some((call) => call.text === 'ROLLBACK'), false);
  assert.equal(calls.at(-1).scope, 'release');
});

test('repository rolls back and releases the client when work fails', async () => {
  const { pool, calls } = fakePool(() => ({ rows: [] }));
  const repository = new NexusEconomyPostgresRepository({ pool });
  await assert.rejects(
    repository.transact('42', async () => { throw new Error('boom'); }),
    /boom/
  );
  assert.ok(calls.some((call) => call.text === 'ROLLBACK'));
  assert.equal(calls.some((call) => call.text === 'COMMIT'), false);
  assert.equal(calls.at(-1).scope, 'release');
});

test('read path uses parameterized SQL and maps absent accounts to null', async () => {
  const { pool, calls } = fakePool(() => ({ rows: [] }));
  const repository = new NexusEconomyPostgresRepository({ pool, schema: 'sentinel_v2' });
  const account = await repository.getAccount('123');
  assert.equal(account, null);
  const read = calls.find((call) => call.scope === 'pool');
  assert.deepEqual(read.params, ['123']);
  assert.match(read.text, /"sentinel_v2"\.nexus_economy_accounts WHERE discord_user_id = \$1/);
});
