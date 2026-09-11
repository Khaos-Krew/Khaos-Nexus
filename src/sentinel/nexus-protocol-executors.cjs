'use strict';

const crypto = require('node:crypto');

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

function actionFingerprint(protocolId, serverId, action, index) {
  const body = [protocolId, serverId, index, action.plugin, action.command].join('\u001f');
  return crypto.createHash('sha256').update(body).digest('hex').slice(0, 24);
}

function buildExecutionEnvelope(plan, options = {}) {
  const serverId = token(options.serverId, 'server id', /^[A-Za-z0-9:_-]{2,96}$/);
  const idempotencyKey = String(options.idempotencyKey || '').trim();
  assertExecutable(plan, { idempotencyKey });

  const maxActions = Math.max(1, Math.min(20, Number(options.maxActions || 10)));
  if (plan.actions.length === 0) throw new Error('Protocol execution plan has no actions');
  if (plan.actions.length > maxActions) throw new Error('Protocol execution plan exceeds action limit');

  const allowedPlugins = new Set(options.allowedPlugins || ['EventCountdown', 'RewardsAscended', 'CousinCustomRates']);
  for (const action of plan.actions) {
    if (!allowedPlugins.has(action.plugin)) throw new Error(`Protocol executor plugin is not allowed: ${action.plugin}`);
  }

  const actions = plan.actions.map((action, index) => Object.freeze({
    actionId: actionFingerprint(plan.protocolId, serverId, action, index),
    index,
    plugin: action.plugin,
    command: action.command,
    destructive: action.destructive === true,
    idempotencyKey: action.requiresIdempotencyKey ? `${idempotencyKey}:${index}` : null
  }));

  return Object.freeze({
    version: 1,
    protocolId: plan.protocolId,
    serverId,
    createdAt: plan.createdAt,
    idempotencyKey: idempotencyKey || null,
    actions: Object.freeze(actions)
  });
}

function isAllowedExecutorCommand(action = {}) {
  if (action.plugin === 'EventCountdown') return action.command === 'EventCountdown.Reload';
  if (action.plugin === 'RewardsAscended') {
    return action.command === 'RA.Reload'
      || /^RA\.Reward [A-Za-z0-9_-]{4,96} [A-Za-z0-9:_-]{1,96}$/.test(action.command);
  }
  if (action.plugin === 'CousinCustomRates') {
    return action.command === 'CousinCustomRates.Reload'
      || /^changerates [A-Za-z0-9_-]{1,64}$/.test(action.command);
  }
  return false;
}

function validateExecutionEnvelope(envelope, options = {}) {
  if (!envelope || envelope.version !== 1 || !Array.isArray(envelope.actions)) {
    throw new Error('Invalid Protocol execution envelope');
  }
  const expectedServerId = options.serverId ? token(options.serverId, 'server id', /^[A-Za-z0-9:_-]{2,96}$/) : null;
  const serverId = token(envelope.serverId, 'server id', /^[A-Za-z0-9:_-]{2,96}$/);
  const protocolId = token(envelope.protocolId, 'protocol id');
  if (expectedServerId && serverId !== expectedServerId) throw new Error('Protocol execution envelope server mismatch');

  const now = Number(options.now ?? Date.now());
  const maxAgeMs = Math.max(1000, Math.min(3600000, Number(options.maxAgeMs || 300000)));
  const createdAt = Number(envelope.createdAt);
  if (!Number.isFinite(createdAt) || createdAt > now + 30000 || now - createdAt > maxAgeMs) {
    throw new Error('Protocol execution envelope is stale or has an invalid timestamp');
  }
  if (envelope.actions.length === 0 || envelope.actions.length > 20) throw new Error('Invalid Protocol execution envelope action count');

  const seenActionIds = new Set();
  for (let index = 0; index < envelope.actions.length; index += 1) {
    const action = envelope.actions[index];
    if (!action || action.index !== index || !isAllowedExecutorCommand(action)) {
      throw new Error('Protocol execution envelope contains an invalid action');
    }
    const expectedActionId = actionFingerprint(protocolId, serverId, action, index);
    if (action.actionId !== expectedActionId || seenActionIds.has(action.actionId)) {
      throw new Error('Protocol execution envelope action identity mismatch');
    }
    seenActionIds.add(action.actionId);
    if (action.destructive === true) {
      const rootKey = String(envelope.idempotencyKey || '').trim();
      if (!/^[A-Za-z0-9:_-]{8,128}$/.test(rootKey) || action.idempotencyKey !== `${rootKey}:${index}`) {
        throw new Error('Protocol execution envelope has invalid idempotency binding');
      }
    } else if (action.idempotencyKey !== null) {
      throw new Error('Protocol execution envelope has unexpected idempotency binding');
    }
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
  assertExecutable,
  buildExecutionEnvelope,
  validateExecutionEnvelope
};
