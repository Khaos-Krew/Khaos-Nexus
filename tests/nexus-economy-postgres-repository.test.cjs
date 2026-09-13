'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  NexusEconomyPostgresRepository,
  sqlIdent,
  normalizeCurrency,
  SUPPORTED_CURRENCIES
} = require('../src/sentinel/nexus-economy-postgres-repository.cjs');

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

test('currency aliases normalize into the three canonical wallet currencies', () => {
  assert.deepEqual(SUPPORTED_CURRENCIES, ['NEXUS_COINS', 'NEXUS_POINTS', 'DINO_CACHE_TOKENS']);
  assert.equal(normalizeCurrency('Nexus Coins'), 'NEXUS_COINS');
  assert.equal(normalizeCurrency('Nexus Points'), 'NEXUS_POINTS');
  assert.equal(normalizeCurrency('Dino Cache Tokens'), 'DINO_CACHE_TOKENS');
  assert.throws(() => normalizeCurrency('USD'), /Unsupported/);
});

test('schema SQL models one economic identity with separate currency wallets', () => {
  const sql = NexusEconomyPostgresRepository.schemaSql({ schema: 'sentinel_v2' });
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "sentinel_v2"\.nexus_economic_identities/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "sentinel_v2"\.nexus_economic_identity_links/);
  assert.match(sql, /PRIMARY KEY \(provider, external_id\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "sentinel_v2"\.nexus_economy_wallets/);
  assert.match(sql, /PRIMARY KEY \(economic_identity_id, currency\)/);
  assert.match(sql, /DINO_CACHE_TOKENS/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "sentinel_v2"\.nexus_economy_ledger/);
  assert.match(sql, /idempotency_key TEXT NOT NULL UNIQUE/);
  assert.match(sql, /FOREIGN KEY \(economic_identity_id, currency\)/);
  assert.doesNotMatch(sql, /nexus_economy_accounts/);
});

test('repository serializes one currency wallet transaction with an identity+currency advisory lock', async () => {
  const { pool, calls } = fakePool((text) => {
    if (/SELECT economic_identity_id, currency, balance FROM .*FOR UPDATE/s.test(text)) {
      return { rows: [{ economic_identity_id: 'econ_42', currency: 'NEXUS_POINTS', balance: '10' }] };
    }
    if (/INSERT INTO .*nexus_economy_ledger/s.test(text)) return { rows: [{ id: '99' }] };
    return { rows: [] };
  });
  const repository = new NexusEconomyPostgresRepository({ pool });
  const result = await repository.transact('econ_42', 'Nexus Points', async (tx) => {
    const wallet = await tx.getOrCreateWallet('econ_42', 'NEXUS_POINTS');
    assert.equal(Number(wallet.balance), 10);
    const entry = await tx.appendLedger({
      economicIdentityId: 'econ_42', currency: 'NEXUS_POINTS', amount: 5, balanceAfter: 15,
      type: 'credit', source: 'test', idempotencyKey: 'credit_1', metadata: { reason: 'test' },
      at: '2026-09-11T00:00:00.000Z'
    });
    await tx.setBalance('econ_42', 'NEXUS_POINTS', 15);
    return entry.id;
  });
  assert.equal(result, '99');
  assert.ok(calls.some((call) => call.text === 'BEGIN'));
  const lock = calls.find((call) => /pg_advisory_xact_lock/.test(call.text));
  assert.deepEqual(lock.params, ['nexus-economy:econ_42:NEXUS_POINTS']);
  assert.ok(calls.some((call) => call.text === 'COMMIT'));
  assert.equal(calls.some((call) => call.text === 'ROLLBACK'), false);
  assert.equal(calls.at(-1).scope, 'release');
});

test('repository rolls back and releases the client when work fails', async () => {
  const { pool, calls } = fakePool(() => ({ rows: [] }));
  const repository = new NexusEconomyPostgresRepository({ pool });
  await assert.rejects(
    repository.transact('econ_42', 'NEXUS_POINTS', async () => { throw new Error('boom'); }),
    /boom/
  );
  assert.ok(calls.some((call) => call.text === 'ROLLBACK'));
  assert.equal(calls.some((call) => call.text === 'COMMIT'), false);
  assert.equal(calls.at(-1).scope, 'release');
});

test('Discord wallet reads use identity linkage and a canonical currency parameter', async () => {
  const { pool, calls } = fakePool((text) => {
    if (/FROM .*nexus_economy_wallets/s.test(text)) {
      return { rows: [{ economic_identity_id: 'econ_123', currency: 'NEXUS_POINTS', balance: '50' }] };
    }
    return { rows: [] };
  });
  const repository = new NexusEconomyPostgresRepository({ pool, schema: 'sentinel_v2' });
  const wallet = await repository.getWalletByDiscord('123', 'Nexus Points');
  assert.equal(Number(wallet.balance), 50);
  const read = calls.find((call) => call.scope === 'pool');
  assert.deepEqual(read.params, ['123', 'NEXUS_POINTS']);
  assert.match(read.text, /nexus_economic_identity_links/);
  assert.match(read.text, /w\.currency = \$2/);
});

test('verified Discord and EOS links must resolve to the same economic identity', async () => {
  const { pool, calls } = fakePool((text) => {
    if (/JOIN .*nexus_economic_identity_links e/s.test(text)) return { rows: [{ economic_identity_id: 'econ_123', status: 'verified' }] };
    return { rows: [] };
  });
  const repository = new NexusEconomyPostgresRepository({ pool });
  const identity = await repository.resolveVerifiedIdentity({ discordUserId: '123', eosId: 'EOS_123' });
  assert.equal(identity.economic_identity_id, 'econ_123');
  const read = calls.find((call) => call.scope === 'pool');
  assert.deepEqual(read.params, ['123', 'EOS_123']);
  assert.match(read.text, /i\.status = 'verified'/);
  assert.match(read.text, /d\.verified_at IS NOT NULL/);
  assert.match(read.text, /e\.verified_at IS NOT NULL/);
});
