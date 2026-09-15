'use strict';

/**
 * Shadow Recruit empty wallet + EOS-hard passive NP (LEDGER §8 T1–T8).
 * No shop WRITES / purchases / delivery flag flips.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isShadowRecruitEligibleRank } = require('../src/shared/ranks.cjs');
const {
  NexusEconomyPostgresRuntimeRepository,
  SHADOW_RECRUIT_LINK_SOURCE
} = require('../src/sentinel/nexus-economy-postgres-runtime-repository.cjs');
const { NexusEconomyPostgresRepository } = require('../src/sentinel/nexus-economy-postgres-repository.cjs');
const { NexusEconomyWalletCore } = require('../src/sentinel/nexus-economy-wallet-core.cjs');
const { PostgresEconomyAccrual } = require('../src/economy-worker/postgres-accrual.cjs');
const {
  FINANCIAL_WRITE_PATHS,
  DRAIN_MUTATION_PATHS,
  WRITE_PATHS,
  writeGate,
  createEconomyServer
} = require('../src/economy-worker/server.cjs');
const { deterministicEconomicIdentityId } = require('../src/sentinel/nexus-economy-json-postgres-migration.cjs');

const DISCORD = '123456789012345678';
const EOS = 'EOS_PROOF_ABCDEF12';

function fakePool(handler) {
  const calls = [];
  const client = {
    async query(text, params = []) {
      calls.push({ scope: 'client', text, params });
      return handler(text, params, 'client', calls);
    },
    release() { calls.push({ scope: 'release' }); }
  };
  return {
    calls,
    pool: {
      async connect() { calls.push({ scope: 'connect' }); return client; },
      async query(text, params = []) {
        calls.push({ scope: 'pool', text, params });
        return handler(text, params, 'pool', calls);
      }
    }
  };
}

test('isShadowRecruitEligibleRank: level >= 0 for catalog ranks', () => {
  assert.equal(isShadowRecruitEligibleRank('shadow-recruit'), true);
  assert.equal(isShadowRecruitEligibleRank('cipher-runner'), true);
  assert.equal(isShadowRecruitEligibleRank('blackout-legend'), true);
  assert.equal(isShadowRecruitEligibleRank('unknown-rank'), false);
  assert.equal(isShadowRecruitEligibleRank(''), false);
});

test('T1: rank shadow-recruit ensure mints restricted identity + discord link + zero wallets', async () => {
  const economicIdentityId = deterministicEconomicIdentityId(DISCORD);
  let status = null;
  const wallets = new Set();
  let discordLink = null;
  let accrualRank = null;
  const { pool, calls } = fakePool((text, params) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK' || /LOCK TABLE/.test(text)) return { rows: [] };
    if (/FROM .*nexus_economic_identity_links WHERE provider = 'discord'/.test(text)) {
      return { rows: discordLink ? [discordLink] : [] };
    }
    if (/INSERT INTO .*nexus_economic_identities/.test(text)) {
      if (status == null) status = 'restricted';
      return { rows: [] };
    }
    if (/SELECT status FROM .*nexus_economic_identities/.test(text)) return { rows: [{ status }] };
    if (/INSERT INTO .*nexus_economic_identity_links/.test(text)) {
      discordLink = {
        economic_identity_id: params[1],
        verified_at: null,
        source: params[2],
        provider: 'discord',
        external_id: params[0]
      };
      return { rows: [] };
    }
    if (/INSERT INTO .*nexus_economy_wallets/.test(text)) {
      const currency = params[1];
      if (!wallets.has(currency)) {
        wallets.add(currency);
        return { rowCount: 1, rows: [{ currency }] };
      }
      return { rowCount: 0, rows: [] };
    }
    if (/INSERT INTO .*nexus_economy_accrual_state/.test(text)) {
      accrualRank = params[1];
      return { rows: [] };
    }
    return { rows: [] };
  });

  const repository = new NexusEconomyPostgresRuntimeRepository({ pool });
  const result = await repository.ensureShadowRecruitWallet(DISCORD, 'shadow-recruit');

  assert.equal(result.ok, true);
  assert.equal(result.status, 'restricted');
  assert.equal(result.economicIdentityId, economicIdentityId);
  assert.equal(result.source, SHADOW_RECRUIT_LINK_SOURCE);
  assert.deepEqual(result.walletsCreated.sort(), ['DINO_CACHE_TOKENS', 'NEXUS_COINS', 'NEXUS_POINTS']);
  assert.equal(discordLink.verified_at, null);
  assert.equal(discordLink.source, 'shadow-recruit-rank');
  assert.equal(accrualRank, 'shadow-recruit');
  assert.equal(calls.some((c) => /provider = 'eos'|VALUES \('eos'/.test(c.text || '')), false);
  assert.equal(calls.some((c) => /SET status = 'verified'/.test(c.text || '')), false);
});

test('T2: repeat ensure is idempotent (no duplicate wallets / no ledger)', async () => {
  const economicIdentityId = deterministicEconomicIdentityId(DISCORD);
  let status = 'restricted';
  const wallets = new Set(['NEXUS_COINS', 'NEXUS_POINTS', 'DINO_CACHE_TOKENS']);
  const discordLink = {
    economic_identity_id: economicIdentityId,
    verified_at: null,
    source: 'shadow-recruit-rank'
  };
  let walletInsertAttempts = 0;
  const { pool, calls } = fakePool((text) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK' || /LOCK TABLE/.test(text)) return { rows: [] };
    if (/FROM .*nexus_economic_identity_links WHERE provider = 'discord'/.test(text)) return { rows: [discordLink] };
    if (/INSERT INTO .*nexus_economic_identities/.test(text)) return { rows: [] };
    if (/SELECT status FROM .*nexus_economic_identities/.test(text)) return { rows: [{ status }] };
    if (/INSERT INTO .*nexus_economic_identity_links/.test(text)) return { rows: [] };
    if (/INSERT INTO .*nexus_economy_wallets/.test(text)) {
      walletInsertAttempts += 1;
      return { rowCount: 0, rows: [] };
    }
    if (/INSERT INTO .*nexus_economy_accrual_state/.test(text)) return { rows: [] };
    return { rows: [] };
  });

  const repository = new NexusEconomyPostgresRuntimeRepository({ pool });
  const result = await repository.ensureShadowRecruitWallet(DISCORD, 'shadow-recruit');
  assert.equal(result.ok, true);
  assert.deepEqual(result.walletsCreated, []);
  assert.equal(result.walletsExisting.length, 3);
  assert.equal(walletInsertAttempts, 3);
  assert.equal(calls.some((c) => /nexus_economy_ledger/.test(c.text || '')), false);
});

test('T3: no EOS → #accruePassive returns credited:0 and does not advance cursor', async () => {
  let creditCalls = 0;
  let cursorAdvanced = false;
  const { pool } = fakePool((text) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    if (/pg_advisory_xact_lock/.test(text)) return { rows: [] };
    if (/provider = 'discord'/.test(text) && /status = 'verified'/.test(text)) {
      return { rows: [{ economic_identity_id: 'econ_1', discord_user_id: DISCORD }] };
    }
    if (/INSERT INTO .*nexus_economy_accrual_state/.test(text)) return { rows: [] };
    if (/SELECT \* FROM .*nexus_economy_accrual_state/.test(text)) {
      return {
        rows: [{
          economic_identity_id: 'econ_1',
          rank_id: 'cipher-runner',
          online: false,
          last_passive_at: new Date(Date.now() - 5 * 3600_000).toISOString(),
          offline_since: new Date(Date.now() - 5 * 3600_000).toISOString(),
          passive_credit_cursor: 0,
          last_presence_at: null
        }]
      };
    }
    if (/INSERT INTO .*nexus_economy_wallets/.test(text)) return { rows: [] };
    if (/SELECT balance FROM .*nexus_economy_wallets/.test(text)) return { rows: [{ balance: '0' }] };
    if (/provider = 'eos'/.test(text) && /verified_at IS NOT NULL/.test(text)) return { rows: [] };
    if (/INSERT INTO .*nexus_economy_ledger/.test(text)) {
      creditCalls += 1;
      return { rowCount: 1, rows: [{ id: 1 }] };
    }
    if (/UPDATE .*nexus_economy_accrual_state SET online/.test(text)) {
      // params include passive_credit_cursor — if still 0, not advanced for credit
      return { rows: [] };
    }
    return { rows: [] };
  });

  const accrual = new PostgresEconomyAccrual({ pool, now: () => Date.now() });
  const result = await accrual.accrueOffline(DISCORD);
  assert.equal(result.ok, true);
  assert.equal(result.credited, 0);
  assert.equal(creditCalls, 0);
});

test('T4: EOS linked → passive credit allowed when rate/cap permit', async () => {
  let creditCalls = 0;
  const nowMs = Date.parse('2026-09-15T12:00:00.000Z');
  const { pool } = fakePool((text) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    if (/pg_advisory_xact_lock/.test(text)) return { rows: [] };
    if (/provider = 'discord'/.test(text) && /status = 'verified'/.test(text)) {
      return { rows: [{ economic_identity_id: 'econ_eos', discord_user_id: DISCORD }] };
    }
    if (/INSERT INTO .*nexus_economy_accrual_state/.test(text)) return { rows: [] };
    if (/SELECT \* FROM .*nexus_economy_accrual_state/.test(text)) {
      return {
        rows: [{
          economic_identity_id: 'econ_eos',
          rank_id: 'cipher-runner',
          online: false,
          last_passive_at: new Date(nowMs - 5 * 3600_000).toISOString(),
          offline_since: new Date(nowMs - 5 * 3600_000).toISOString(),
          passive_credit_cursor: 0,
          last_presence_at: null
        }]
      };
    }
    if (/INSERT INTO .*nexus_economy_wallets/.test(text)) return { rows: [] };
    if (/SELECT balance FROM .*nexus_economy_wallets/.test(text)) return { rows: [{ balance: '0' }] };
    if (/provider = 'eos'/.test(text) && /verified_at IS NOT NULL/.test(text)) {
      return { rows: [{ '?column?': 1 }] };
    }
    if (/INSERT INTO .*nexus_economy_ledger/.test(text)) {
      creditCalls += 1;
      return { rowCount: 1, rows: [{ id: 99 }] };
    }
    if (/UPDATE .*nexus_economy_wallets SET balance/.test(text)) return { rows: [] };
    if (/UPDATE .*nexus_economy_accrual_state SET online/.test(text)) return { rows: [] };
    return { rows: [] };
  });

  const accrual = new PostgresEconomyAccrual({ pool, now: () => nowMs });
  const result = await accrual.accrueOffline(DISCORD);
  assert.equal(result.ok, true);
  assert.ok(result.credited > 0);
  assert.equal(creditCalls, 1);
});

test('T5: status=disabled rejects ensure (no wallet open)', async () => {
  const economicIdentityId = deterministicEconomicIdentityId(DISCORD);
  const { pool, calls } = fakePool((text) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK' || /LOCK TABLE/.test(text)) return { rows: [] };
    if (/FROM .*nexus_economic_identity_links WHERE provider = 'discord'/.test(text)) {
      return { rows: [{ economic_identity_id: economicIdentityId, verified_at: null, source: 'x' }] };
    }
    if (/INSERT INTO .*nexus_economic_identities/.test(text)) return { rows: [] };
    if (/SELECT status FROM .*nexus_economic_identities/.test(text)) return { rows: [{ status: 'disabled' }] };
    if (/INSERT INTO .*nexus_economy_wallets/.test(text)) throw new Error('unexpected wallet insert for disabled');
    return { rows: [] };
  });
  const repository = new NexusEconomyPostgresRuntimeRepository({ pool });
  const result = await repository.ensureShadowRecruitWallet(DISCORD, 'shadow-recruit');
  assert.equal(result.ok, false);
  assert.equal(result.rejected, 'disabled');
  assert.equal(calls.some((c) => c.text === 'ROLLBACK'), true);
});

test('T5b: quarantine denylist rejects ensure', async () => {
  const economicIdentityId = deterministicEconomicIdentityId(DISCORD);
  const { pool } = fakePool((text) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK' || /LOCK TABLE/.test(text)) return { rows: [] };
    if (/FROM .*nexus_economic_identity_links WHERE provider = 'discord'/.test(text)) {
      return { rows: [{ economic_identity_id: economicIdentityId }] };
    }
    return { rows: [] };
  });
  const repository = new NexusEconomyPostgresRuntimeRepository({ pool });
  const result = await repository.ensureShadowRecruitWallet(DISCORD, 'shadow-recruit', {
    env: { NEXUS_ECONOMY_QUARANTINE_DENYLIST: economicIdentityId }
  });
  assert.equal(result.ok, false);
  assert.equal(result.rejected, 'quarantine-denylist');
});

test('T6: credit/spend on restricted empty wallet still rejected (verified required)', async () => {
  const economicIdentityId = deterministicEconomicIdentityId(DISCORD);
  const { pool } = fakePool((text) => {
    if (/FROM .*nexus_economic_identity_links/.test(text)) {
      return {
        rows: [{
          economic_identity_id: economicIdentityId,
          status: 'restricted',
          provider: 'discord',
          external_id: DISCORD,
          verified_at: null,
          source: 'shadow-recruit-rank'
        }]
      };
    }
    return { rows: [] };
  });
  const repository = new NexusEconomyPostgresRepository({ pool });
  const walletCore = new NexusEconomyWalletCore({ repository });
  await assert.rejects(
    () => walletCore.credit({
      discordUserId: DISCORD,
      amount: 1,
      idempotencyKey: 'credit_restricted_1',
      source: 'test'
    }),
    /Verified economic identity is required/
  );
  await assert.rejects(
    () => walletCore.spend({
      discordUserId: DISCORD,
      amount: 1,
      orderId: 'order_restricted_1'
    }),
    /Verified economic identity is required/
  );
});

test('T7: shop WRITES remain fail-closed; ensure is not a financial write path', () => {
  assert.equal(FINANCIAL_WRITE_PATHS.has('/shop/buy'), true);
  assert.equal(FINANCIAL_WRITE_PATHS.has('/shop/sell'), true);
  assert.equal(FINANCIAL_WRITE_PATHS.has('/shop/buy/delivery-status'), true);
  assert.equal(FINANCIAL_WRITE_PATHS.has('/wallet/ensure-shadow-recruit'), false);
  assert.equal(WRITE_PATHS.has('/wallet/ensure-shadow-recruit'), false);
  assert.equal(DRAIN_MUTATION_PATHS.has('/wallet/ensure-shadow-recruit'), true);

  const blocked = writeGate('/shop/buy', { writesEnabled: false, presenceWritesEnabled: true });
  assert.equal(blocked.statusCode, 503);
  assert.equal(blocked.body.error, 'economy-write-cutover-not-enabled');

  const ensureGate = writeGate('/wallet/ensure-shadow-recruit', { writesEnabled: false, presenceWritesEnabled: true });
  assert.equal(ensureGate, null);

  // Source fixture: server still reads NEXUS_ECONOMY_WRITES_ENABLED (no flip in this change).
  const serverSrc = fs.readFileSync(path.join(__dirname, '../src/economy-worker/server.cjs'), 'utf8');
  assert.match(serverSrc, /NEXUS_ECONOMY_WRITES_ENABLED/);
  assert.doesNotMatch(serverSrc, /NEXUS_ECONOMY_WRITES_ENABLED\s*=\s*['"]true['"]/);

  const runtime = createEconomyServer({
    writesEnabled: false,
    presenceWritesEnabled: true,
    token: 'test-token',
    worker: { health() { return { ok: true }; }, balances: async () => ({}) },
    shop: { listCatalog: () => [], pendingBuyOrders: () => [] }
  });
  assert.equal(runtime.writesEnabled, false);
});

test('T8: higher rank (>= shadow-recruit) still ensures wallet', async () => {
  assert.equal(isShadowRecruitEligibleRank('nexus-raider'), true);
  let status = null;
  const wallets = new Set();
  const { pool } = fakePool((text, params) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK' || /LOCK TABLE/.test(text)) return { rows: [] };
    if (/FROM .*nexus_economic_identity_links WHERE provider = 'discord'/.test(text)) return { rows: [] };
    if (/INSERT INTO .*nexus_economic_identities/.test(text)) {
      status = 'restricted';
      return { rows: [] };
    }
    if (/SELECT status FROM .*nexus_economic_identities/.test(text)) return { rows: [{ status }] };
    if (/INSERT INTO .*nexus_economic_identity_links/.test(text)) return { rows: [] };
    if (/INSERT INTO .*nexus_economy_wallets/.test(text)) {
      wallets.add(params[1]);
      return { rowCount: 1, rows: [{ currency: params[1] }] };
    }
    if (/INSERT INTO .*nexus_economy_accrual_state/.test(text)) {
      assert.equal(params[1], 'nexus-raider');
      return { rows: [] };
    }
    return { rows: [] };
  });
  const repository = new NexusEconomyPostgresRuntimeRepository({ pool });
  const result = await repository.ensureShadowRecruitWallet(DISCORD, 'nexus-raider');
  assert.equal(result.ok, true);
  assert.equal(result.rankId, 'nexus-raider');
  assert.equal(wallets.size, 3);
});

test('getOrCreateWallet allows restricted insert; getWalletByDiscord reads restricted without verified_at', async () => {
  const { pool, calls } = fakePool((text) => {
    if (/INSERT INTO .*nexus_economy_wallets/.test(text)) {
      assert.match(text, /status IN \('verified', 'restricted'\)/);
      return { rows: [] };
    }
    if (/SELECT economic_identity_id, currency, balance FROM .*FOR UPDATE/s.test(text)) {
      return { rows: [{ economic_identity_id: 'econ_r', currency: 'NEXUS_POINTS', balance: '0' }] };
    }
    if (/FROM .*nexus_economy_wallets w/.test(text)) {
      assert.doesNotMatch(text, /verified_at IS NOT NULL/);
      assert.match(text, /status IN \('verified', 'restricted'\)/);
      return { rows: [{ economic_identity_id: 'econ_r', currency: 'NEXUS_POINTS', balance: '0' }] };
    }
    return { rows: [] };
  });
  const repository = new NexusEconomyPostgresRepository({ pool });
  const wallet = await repository.transact('econ_r', 'NEXUS_POINTS', async (tx) => tx.getOrCreateWallet('econ_r', 'NEXUS_POINTS'));
  assert.equal(Number(wallet.balance), 0);
  const read = await repository.getWalletByDiscord(DISCORD, 'NEXUS_POINTS');
  assert.equal(Number(read.balance), 0);
  assert.ok(calls.length > 0);
});

test('active presence still resolves via EOS (resolveByEos requires verified EOS)', async () => {
  const { pool } = fakePool((text) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    if (/provider = 'eos'/.test(text) && /verified_at IS NOT NULL/.test(text) && /status = 'verified'/.test(text)) {
      return { rows: [] }; // unlinked
    }
    return { rows: [] };
  });
  const accrual = new PostgresEconomyAccrual({ pool });
  const result = await accrual.recordPresence({ eosId: EOS, online: true, rankId: 'cipher-runner' });
  assert.deepEqual(result, { ok: false, reason: 'unlinked-player' });
});
