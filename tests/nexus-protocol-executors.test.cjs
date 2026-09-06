'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildEventCountdownReload,
  buildRewardsAscendedReload,
  buildRewardsAscendedGrant,
  buildCustomRatesReload,
  buildCustomRatesActivate,
  protocolExecutionPlan,
  assertExecutable
} = require('../src/sentinel/nexus-protocol-executors.cjs');

test('plugin executor builders emit only the documented RCON command shapes', () => {
  assert.equal(buildEventCountdownReload().command, 'EventCountdown.Reload');
  assert.equal(buildRewardsAscendedReload().command, 'RA.Reload');
  assert.equal(buildRewardsAscendedGrant('EOS_ABC123', 'alpha_reward').command, 'RA.Reward EOS_ABC123 alpha_reward');
  assert.equal(buildCustomRatesReload().command, 'CousinCustomRates.Reload');
  assert.equal(buildCustomRatesActivate('event_rates').command, 'changerates event_rates');
});

test('command tokens reject whitespace and command injection characters', () => {
  assert.throws(() => buildRewardsAscendedGrant('EOS_ABC;quit', 'reward'), /Invalid EOS id/);
  assert.throws(() => buildRewardsAscendedGrant('EOS_ABC', 'reward all'), /Invalid reward id/);
  assert.throws(() => buildCustomRatesActivate('event_rates\nquit'), /Invalid rate preset/);
});

test('execution plans default to dry-run and mutating actions require durable idempotency', () => {
  const dryRun = protocolExecutionPlan({
    protocolId: 'alpha_purge',
    ratePreset: 'event_rates',
    reward: { eosId: 'EOS_ABC123', rewardId: 'alpha_reward' },
    createdAt: 1000
  });
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.actions.length, 2);
  assert.throws(() => assertExecutable(dryRun, { idempotencyKey: 'protocol:run:1' }), /dry-run/);

  const livePlan = protocolExecutionPlan({
    protocolId: 'alpha_purge',
    ratePreset: 'event_rates',
    createdAt: 1000,
    dryRun: false
  });
  assert.throws(() => assertExecutable(livePlan), /idempotency/);
  assert.equal(assertExecutable(livePlan, { idempotencyKey: 'alpha_purge:run_123' }), true);
});

test('reload-only plans are non-destructive but still explicitly activated by caller', () => {
  const plan = protocolExecutionPlan({
    protocolId: 'community',
    reloadCountdown: true,
    reloadRewards: true,
    reloadRates: true,
    dryRun: false
  });
  assert.ok(plan.actions.every((action) => action.destructive === false));
  assert.equal(assertExecutable(plan), true);
});
