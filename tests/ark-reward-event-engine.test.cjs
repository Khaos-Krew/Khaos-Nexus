'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  rewardIsSupporterSafe,
  validatePool,
  rollRewardCache,
  entitlementForRank,
  RewardJournal
} = require('../src/sentinel/ark-reward-engine.cjs');
const {
  chooseEvent,
  rollAnomaly,
  buildAnomalyPlan,
  EventJournal
} = require('../src/sentinel/ark-event-engine.cjs');

function sequence(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

test('supporter reward guard rejects P2W tags', () => {
  assert.equal(rewardIsSupporterSafe({ tags: ['cosmetic'] }), true);
  assert.equal(rewardIsSupporterSafe({ tags: ['best-in-slot'] }), false);
  assert.throws(() => validatePool([
    { id: 'bad', type: 'kit', weight: 1, value: 1, tags: ['exclusive-power'] }
  ], { supporter: true, valueBudget: 100 }), /non-P2W/i);
});

test('supporter cache respects value budget and deterministic roll', () => {
  const roll = rollRewardCache('daily', { rng: () => 0, supporter: true });
  assert.equal(roll.cacheType, 'daily');
  assert.equal(roll.rewardId, 'nexus-points-small');
  assert.equal(roll.supporterSafe, true);
  assert.ok(roll.reward.value <= roll.valueBudget);
});

test('rank cache entitlements match planned supporter cadence', () => {
  assert.equal(entitlementForRank('cipher-runner').weekly, 1);
  assert.equal(entitlementForRank('khaos-warden').weekly, 2);
  assert.equal(entitlementForRank('blackout-legend').daily, 1);
  assert.equal(entitlementForRank('origin-founder').legacy, true);
});

test('reward journal enforces periodic allowance accounting', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-reward-'));
  const journal = new RewardJournal(dir);
  assert.equal(journal.canClaim('player-1', 'weekly', 1, 7 * 86400000).ok, true);
  journal.record({ identityId: 'player-1', cacheType: 'weekly', roll: { rewardId: 'test' } });
  const status = journal.canClaim('player-1', 'weekly', 1, 7 * 86400000);
  assert.equal(status.ok, false);
  assert.equal(status.used, 1);
});

test('event selection and anomaly plans are deterministic and safe by default', () => {
  const event = chooseEvent({ rng: () => 0 });
  assert.equal(event.id, 'supply-rush');

  const anomaly = rollAnomaly({ rng: sequence([0, 0]), baseMaxLevel: 150 });
  assert.equal(anomaly.tierId, 'rare');
  assert.equal(anomaly.speciesId, 'rex');
  assert.equal(anomaly.targetLevel, 160);

  const plan = buildAnomalyPlan(anomaly, 'Ragnarok');
  assert.equal(plan.safeByDefault, true);
  assert.equal(plan.autoSpawn, false);
  assert.equal(plan.mapName, 'Ragnarok');
  assert.equal(plan.proposedSpawn.blueprint, anomaly.blueprint);
});

test('event journal records start and finish transitions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-event-'));
  const journal = new EventJournal(dir);
  const started = journal.start({ eventId: 'alpha-hunt', mapName: 'Ragnarok' });
  assert.equal(started.state, 'active');
  const finished = journal.finish(started.id, { winner: 'tribe-1' });
  assert.equal(finished.state, 'finished');
  assert.equal(finished.metadata.winner, 'tribe-1');
});
