'use strict';

const { validateExecutionEnvelope } = require('./nexus-protocol-executors.cjs');
const { classifyExecutionAttempt } = require('./nexus-protocol-executor-receipts.cjs');

const DEFAULT_PLUGINS = Object.freeze(['EventCountdown', 'RewardsAscended', 'CousinCustomRates']);

function preflightExecutionEnvelope(envelope, receipts = [], options = {}) {
  validateExecutionEnvelope(envelope, options);
  if (!Array.isArray(receipts)) throw new Error('Protocol executor receipts must be an array');

  const allowedPlugins = new Set(options.allowedPlugins || DEFAULT_PLUGINS);
  if (allowedPlugins.size === 0) throw new Error('Protocol executor preflight has no allowed plugins');

  const actions = envelope.actions.map((action, index) => {
    if (!allowedPlugins.has(action.plugin)) {
      return Object.freeze({
        actionId: action.actionId,
        index,
        plugin: action.plugin,
        allowed: false,
        reason: 'plugin_not_allowed',
        priorStatus: null
      });
    }

    const attempt = classifyExecutionAttempt(envelope, index, receipts);
    return Object.freeze({
      actionId: action.actionId,
      index,
      plugin: action.plugin,
      allowed: attempt.allowed === true,
      reason: attempt.reason,
      priorStatus: attempt.prior?.status || null
    });
  });

  const blockers = actions
    .filter((action) => !action.allowed)
    .map((action) => `${action.index}:${action.reason}`);

  return Object.freeze({
    version: 1,
    protocolId: envelope.protocolId,
    serverId: envelope.serverId,
    envelopeCreatedAt: envelope.createdAt,
    actionCount: actions.length,
    actions: Object.freeze(actions),
    blockers: Object.freeze(blockers),
    ready: blockers.length === 0,
    executesCommands: false
  });
}

function assertPreflightReady(preflight) {
  if (!preflight || Number(preflight.version) !== 1
    || !Array.isArray(preflight.actions)
    || !Array.isArray(preflight.blockers)
    || preflight.executesCommands !== false) {
    throw new Error('Invalid Protocol executor preflight');
  }
  if (preflight.ready !== true || preflight.blockers.length > 0
    || preflight.actions.some((action) => action.allowed !== true)) {
    throw new Error('Protocol executor preflight is blocked');
  }
  return true;
}

module.exports = {
  preflightExecutionEnvelope,
  assertPreflightReady
};
