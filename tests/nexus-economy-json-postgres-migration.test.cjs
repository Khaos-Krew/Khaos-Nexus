'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LEGACY_CURRENCY,
  deterministicEconomicIdentityId,
  planLegacyJsonMigration,
  applyLegacyJsonMigration
} = require('../src/sentinel/nexus-economy-json-postgres-migration.cjs');

function state() {
  return {
    version: 1,
    updatedAt: '2026-09-12T00:00:00.000Z',
    accounts: {
      '111111': {
        discordUserId: '111111',
        balance: 60,
        eosIds: ['EOS_ONE'],
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-12T00:00:00.000Z'
      },
      '222222': {
        discordUserId: '222222',
        balance: 15,
        eosIds: [],
        createdAt: '2026-09-02T00:00:00.000Z',
        updatedAt: '2026-09-12T00:00:00.000Z'
      }
    },
    eosToDiscord: { EOS_ONE: '111111' },
    ledger: [
      {
        id: 'ledger_seed', discordUserId: '111111', amount: 100, balanceAfter: 100,
        type: 'credit', source: 'seed', metadata: {}, at: '2026-09-10T00:00:00.000Z'
      },
      {
        id: 'ledger_buy', discordUserId: '111111', amount: -40, balanceAfter: 60,
        type: 'purchase', source: 'cluster-shop', metadata: { orderId: 'order_1' }, at: '2026-09-11T00:00:00.000Z'
      },
      {
        id: 'ledger_other', discordUserId: '222222', amount: 15, balanceAfter: 15,
        type: 'credit', source: 'seed', metadata: {}, at: '2026-09-11T00:00:00.000Z'
      }
    ],
    processed: {
      seed_111: 'ledger_seed',
      purchase_order_1: 'ledger_buy',
      seed_222: 'ledger_other',
      pruned_old_key: 'pruned_ledger_id'
    }
  };
}

test('legacy migration is deterministic and maps only the legacy Nexus Points balance', () => {
  const plan = planLegacyJsonMigration(state());
  assert.equal(plan.currency, LEGACY_CURRENCY);
  assert.equal(plan.currency, 'NEXUS_POINTS');
  assert.equal(plan.wallets.length, 2);
  assert.ok(plan.wallets.every((wallet) => wallet.currency === 'NEXUS_POINTS'));
  assert.equal(plan.wallets.some((wallet) => wallet.currency === 'NEXUS_COINS'), false);
  assert.equal(plan.wallets.some((wallet) => wallet.currency === 'DINO_CACHE_TOKENS'), false);
  assert.equal(plan.identities[0].economicIdentityId, deterministicEconomicIdentityId('111111'));
});

test('EOS-linked legacy accounts become verified while unlinked accounts remain restricted', () => {
  const plan = planLegacyJsonMigration(state());
  const one = plan.identities.find((identity) => identity.legacyDiscordUserId === '111111');
  const two = plan.identities.find((identity) => identity.legacyDiscordUserId === '222222');
  assert.equal(one.status, 'verified');
  assert.equal(two.status, 'restricted');
  const eos = plan.links.find((link) => link.provider === 'eos' && link.externalId === 'EOS_ONE');
  const discord = plan.links.find((link) => link.provider === 'discord' && link.externalId === '111111');
  assert.equal(eos.economicIdentityId, discord.economicIdentityId);
  assert.ok(eos.verifiedAt);
});

test('retained legacy idempotency keys map to ledger entries and pruned keys become tombstones', () => {
  const plan = planLegacyJsonMigration(state());
  assert.equal(plan.ledger.find((entry) => entry.legacyLedgerId === 'ledger_buy').idempotencyKey, 'purchase_order_1');
  assert.deepEqual(plan.tombstones, [{ idempotencyKey: 'pruned_old_key', legacyLedgerId: 'pruned_ledger_id' }]);
});

test('dry run never requires a database or mutates the input state', async () => {
  const input = state();
  const before = structuredClone(input);
  const result = await applyLegacyJsonMigration({ state: input, dryRun: true });
  assert.equal(result.ok, true);
  assert.equal(result.applied, false);
  assert.equal(result.dryRun, true);
  assert.deepEqual(input, before);
  assert.deepEqual(result.plan.counts, {
    identities: 2,
    links: 3,
    wallets: 2,
    ledgerEntries: 3,
    idempotencyTombstones: 1
  });
});

test('migration rejects EOS links that point to missing or conflicting accounts', () => {
  const missing = state();
  missing.eosToDiscord.EOS_BAD = '999999';
  assert.throws(() => planLegacyJsonMigration(missing), /missing Discord account/);

  const conflicting = state();
  conflicting.accounts['222222'].eosIds = ['EOS_ONE'];
  assert.throws(() => planLegacyJsonMigration(conflicting), /conflicts|multiple Discord accounts/);
});

test('migration refuses a legacy wallet whose latest retained ledger balance disagrees with the account', () => {
  const input = state();
  input.accounts['111111'].balance = 61;
  assert.throws(() => planLegacyJsonMigration(input), /does not match its latest retained ledger balance/);
});
