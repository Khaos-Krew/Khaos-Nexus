'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNexusEconomyWallet } = require('../src/sentinel/nexus-economy-composition.cjs');

test('economy composition is inert until a wallet operation is invoked', async () => {
  let connectCalls = 0;
  let queryCalls = 0;
  const pool = {
    async connect() { connectCalls += 1; throw new Error('unexpected connect'); },
    async query() { queryCalls += 1; return { rows: [] }; }
  };

  const composed = createNexusEconomyWallet({ pool });
  assert.ok(composed.wallet);
  assert.ok(composed.repository);
  assert.equal(connectCalls, 0);
  assert.equal(queryCalls, 0);
});

test('economy composition delegates reads through the Postgres repository', async () => {
  const calls = [];
  const pool = {
    async connect() { throw new Error('balance must not open a transaction'); },
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ discord_user_id: '12345', balance: '42' }] };
    }
  };

  const { wallet } = createNexusEconomyWallet({ pool, schema: 'public' });
  const balance = await wallet.balance('12345');
  assert.equal(balance, 42);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ['12345']);
  assert.match(calls[0].sql, /nexus_economy_accounts/);
});

test('economy composition rejects invalid schema names before any database work', () => {
  const pool = { connect() {}, query() {} };
  assert.throws(
    () => createNexusEconomyWallet({ pool, schema: 'public; DROP TABLE nope' }),
    /schema name is invalid/i
  );
});
