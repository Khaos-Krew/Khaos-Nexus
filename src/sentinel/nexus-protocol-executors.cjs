'use strict';

function token(value, label, pattern = /^[A-Za-z0-9:_-]{1,96}$/) {
  const result = String(value || '').trim();
  if (!pattern.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}

function buildEventCountdownReload() {
  return Object.freeze({ plugin: 'EventCountdown', command: 'EventCountdown.Reload', destructive: false });
}

function buildRewardsAscendedReload() {
  return Object.freeze({ plugin: 'RewardsAscended', command: 'RA.Reload', destructive: false });
}

function buildRewardsAscendedGrant(eosId, rewardId) {
  const eos = token(eosId, 'EOS id', /^[A-Za-z0-9_-]{4,96}$/);
  const reward = token(rewardId, 'reward id');
  return Object.freeze({
    plugin: 'RewardsAscended',
    command: `RA.Reward ${eos} ${reward}`,
    destructive: true,
    requiresIdempotencyKey: true,
    target: eos,
    rewardId: reward
  });
}

function buildCustomRatesReload() {
  return Object.freeze({ plugin: 'CousinCustomRates', command: 'CousinCustomRates.Reload', destructive: false });
}

function buildCustomRatesActivate(preset) {
  const name = token(preset, 'rate preset', /^[A-Za-z0-9_-]{1,64}$/);
  return Object.freeze({
    plugin: 'CousinCustomRates',
    command: `changerates ${name}`,
    destructive: true,
    requiresIdempotencyKey: true,
    preset: name
  });
}

function protocolExecutionPlan(input = {}) {
  const protocolId = token(input.protocolId, 'protocol id');
  const plan = [];
  if (input.reloadCountdown) plan.push(buildEventCountdownReload());
  if (input.reloadRewards) plan.push(buildRewardsAscendedReload());
  if (input.reloadRates) plan.push(buildCustomRatesReload());
  if (input.ratePreset) plan.push(buildCustomRatesActivate(input.ratePreset));
  if (input.reward) plan.push(buildRewardsAscendedGrant(input.reward.eosId, input.reward.rewardId));
  return Object.freeze({
    protocolId,
    createdAt: Number(input.createdAt ?? Date.now()),
    dryRun: input.dryRun !== false,
    actions: Object.freeze(plan)
  });
}

function assertExecutable(plan, options = {}) {
  if (!plan || !Array.isArray(plan.actions)) throw new Error('Invalid Protocol execution plan');
  if (plan.dryRun) throw new Error('Protocol execution plan is dry-run only');
  const idempotencyKey = String(options.idempotencyKey || '').trim();
  if (plan.actions.some((action) => action.requiresIdempotencyKey) && !/^[A-Za-z0-9:_-]{8,128}$/.test(idempotencyKey)) {
    throw new Error('A durable idempotency key is required for mutating Protocol actions');
  }
  return true;
}

module.exports = {
  buildEventCountdownReload,
  buildRewardsAscendedReload,
  buildRewardsAscendedGrant,
  buildCustomRatesReload,
  buildCustomRatesActivate,
  protocolExecutionPlan,
  assertExecutable
};
