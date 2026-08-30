'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ArkIdentityStore } = require('../src/sentinel/ark-identity-store.cjs');
const { RewardJournal, rollRewardCacheWithPity } = require('../src/sentinel/ark-reward-engine.cjs');
const { definitiveDeliveryError, claimPolicy, RewardDeliveryAdapter, ArkSupporterCacheService } = require('../src/sentinel/ark-supporter-cache-service.cjs');
const { arkCommand, formatSupporterClaim, formatSupporterStatus } = require('../src/sentinel/ark-ops-extension.cjs');

class FakeRcon {
  constructor({ failAdd = false } = {}) { this.failAdd = failAdd; this.commands = []; this.points = 100; }
  async execute(command) {
    this.commands.push(command);
    if (command.startsWith('AddPoints ')) {
      if (this.failAdd) return 'No mutation';
      this.points += Number(command.split(' ').at(-1));
      return 'Successfully added points';
    }
    if (command.startsWith('GetPlayerPoints ')) return `Player has ${this.points} points`;
    return 'ok';
  }
}

function fixture(rankId = 'cipher-runner', options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-supporter-cache-'));
  const identityStore = new ArkIdentityStore({ root, secret: 'test-secret-with-at-least-thirty-two-characters' });
  const discordUserId = '123456789012345678';
  const challenge = identityStore.issueChallenge(discordUserId);
  identityStore.verifyChallenge({ code: challenge.code, eosId: '0002supporter123', playerName: 'Supporter', mapId: 'gen1' });
  identityStore.updateRank(discordUserId, rankId);
  const journal = new RewardJournal(root);
  const rcon = options.rcon || new FakeRcon();
  const delivery = options.delivery || new RewardDeliveryAdapter({ rcon, journal, kitEnabled: false });
  const service = new ArkSupporterCacheService({ identityStore, journal, rcon, delivery, rng: options.rng || (() => 0), now: options.now || Date.now });
  return { root, identityStore, discordUserId, journal, rcon, service };
}

test('claim policy maps every rank cadence and Founder weekly claims to the legacy pool', () => {
  assert.equal(claimPolicy({ rankId: 'shadow-recruit' }, 'weekly').allowance, 0);
  assert.equal(claimPolicy({ rankId: 'khaos-warden' }, 'weekly').allowance, 2);
  assert.equal(claimPolicy({ rankId: 'blackout-legend' }, 'daily').allowance, 1);
  assert.equal(claimPolicy({ rankId: 'nexus-raider' }, 'weekly').rollCount, 2);
  assert.equal(claimPolicy({ rankId: 'origin-founder' }, 'weekly').cacheType, 'founder');
});

test('linked supporter claims a verified Nexus Points reward once per allowance', async () => {
  const { service, discordUserId, rcon, journal } = fixture();
  const result = await service.claim(discordUserId, 'weekly');
  assert.equal(result.ok, true);
  assert.equal(result.rolls[0].rewardId, 'nexus-points-medium');
  assert.equal(rcon.commands.filter((item) => item.startsWith('AddPoints ')).length, 1);
  assert.equal(journal.read().claims[0].state, 'delivered');
  assert.equal((await service.claim(discordUserId, 'weekly')).reason, 'allowance-used');
});

test('free rank has no supporter claim and unlinked users fail closed', async () => {
  const free = fixture('shadow-recruit');
  assert.equal((await free.service.claim(free.discordUserId, 'weekly')).reason, 'no-entitlement');
  assert.equal((await free.service.claim('999999999999999999', 'weekly')).reason, 'account-not-linked');
});

test('supporter delivery refuses to guess when a profile has multiple ARK identities', async () => {
  const item = fixture('cipher-runner');
  const second = item.identityStore.issueChallenge(item.discordUserId);
  item.identityStore.verifyChallenge({ code: second.code, eosId: '0002secondark123', playerName: 'Second', mapId: 'gen2' });
  assert.equal((await item.service.claim(item.discordUserId, 'weekly')).reason, 'multiple-ark-accounts');
  assert.equal(item.rcon.commands.length, 0);
});

test('ambiguous external delivery failure enters manual review and blocks unsafe retry', async () => {
  const rcon = new FakeRcon({ failAdd: true });
  const { service, discordUserId, journal } = fixture('cipher-runner', { rcon });
  const failed = await service.claim(discordUserId, 'weekly');
  assert.equal(failed.reason, 'manual-review');
  assert.equal(journal.read().claims[0].state, 'manual-review');
  assert.equal((await service.claim(discordUserId, 'weekly')).reason, 'allowance-used');
});

test('definitive pre-delivery validation failure releases the allowance', async () => {
  const delivery = { supports: () => true, async deliver() { throw definitiveDeliveryError('preflight rejected'); } };
  const { service, discordUserId, journal } = fixture('cipher-runner', { delivery });
  assert.equal((await service.claim(discordUserId, 'weekly')).reason, 'failed');
  assert.equal(journal.read().claims[0].state, 'failed');
  assert.equal(service.status(discordUserId, 'weekly').eligibility.ok, true);
});

test('partial multi-roll delivery enters manual review and consumes the allowance', async () => {
  const sequence = [0.99, 0];
  const rcon = new FakeRcon({ failAdd: true });
  const { service, discordUserId, journal } = fixture('nexus-raider', { rcon, rng: () => sequence.shift() ?? 0 });
  const result = await service.claim(discordUserId, 'weekly');
  assert.equal(result.reason, 'manual-review');
  assert.equal(result.deliveries[0].type, 'event-token');
  assert.equal(journal.read().claims[0].state, 'manual-review');
  assert.equal(service.status(discordUserId, 'weekly').eligibility.ok, false);
});

test('pity roll filters to the configured minimum while preserving the value budget', () => {
  const pool = [
    { id: 'low', type: 'currency', amount: 1, value: 10, weight: 100, tags: ['currency'] },
    { id: 'pity', type: 'currency', amount: 2, value: 150, weight: 1, tags: ['currency'] }
  ];
  const roll = rollRewardCacheWithPity('daily', { pool, dryStreak: 5, rng: () => 0 });
  assert.equal(roll.rewardId, 'pity');
  assert.equal(roll.pity.active, true);
  assert.ok(roll.reward.value <= roll.valueBudget);
});

test('/ark exposes linked supporter claim and status surfaces without raw EOS input', () => {
  const command = arkCommand().toJSON();
  for (const name of ['supporter-cache', 'supporter-cache-status']) {
    const sub = command.options.find((item) => item.name === name);
    assert.ok(sub);
    assert.deepEqual(sub.options[0].choices.map((item) => item.value), ['daily', 'weekly']);
    assert.equal(sub.options.some((item) => item.name === 'eos_id'), false);
  }
});

test('supporter claim and status formatting is bounded and does not expose delivery responses', () => {
  const claim = formatSupporterClaim({ ok: true, claim: { id: 'claim-1' }, rolls: [{ reward: { type: 'currency', amount: 250 }, pity: { active: true } }] });
  assert.match(claim, /250 Nexus Points/);
  assert.match(claim, /pity protection/);
  const status = formatSupporterStatus({ ok: true, policy: { rankId: 'cipher-runner', entitlementType: 'weekly', allowance: 1 }, eligibility: { ok: true, remaining: 1 }, eventTokens: 3 });
  assert.match(status, /1\/1 remaining/);
  assert.match(status, /event tokens: \*\*3/);
});
