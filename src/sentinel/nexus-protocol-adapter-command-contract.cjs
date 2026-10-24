'use strict';

const crypto = require('node:crypto');

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function classifyAdapterCommand(action = {}) {
  const plugin = String(action.plugin || '').trim();
  const command = String(action.command || '').trim();
  if (plugin === 'EventCountdown' && command === 'EventCountdown.Reload') {
    return Object.freeze({ plugin, operation: 'reload', mutating: false, requiresIdempotencyKey: false });
  }
  if (plugin === 'RewardsAscended' && command === 'RA.Reload') {
    return Object.freeze({ plugin, operation: 'reload', mutating: false, requiresIdempotencyKey: false });
  }
  if (plugin === 'RewardsAscended' && /^RA\.Reward [A-Za-z0-9_-]{4,96} [A-Za-z0-9:_-]{1,96}$/.test(command)) {
    return Object.freeze({ plugin, operation: 'grant_reward', mutating: true, requiresIdempotencyKey: true });
  }
  if (plugin === 'CousinCustomRates' && command === 'CousinCustomRates.Reload') {
    return Object.freeze({ plugin, operation: 'reload', mutating: false, requiresIdempotencyKey: false });
  }
  if (plugin === 'CousinCustomRates' && /^changerates [A-Za-z0-9_-]{1,64}$/.test(command)) {
    return Object.freeze({ plugin, operation: 'activate_preset', mutating: true, requiresIdempotencyKey: true });
  }
  throw new Error('Protocol adapter command is outside the approved plugin contract');
}

function buildAdapterCommandContract(permit, envelope, options = {}) {
  if (!permit || permit.allowed !== true || permit.executesCommand !== false || permit.requiresCommandRevalidation !== true) {
    throw new Error('Protocol adapter permit is not eligible for command-contract preparation');
  }
  const index = Number(permit.actionIndex);
  if (!Number.isInteger(index) || !envelope || !Array.isArray(envelope.actions) || !envelope.actions[index]) {
    throw new Error('Invalid Protocol adapter command-contract action');
  }
  const action = envelope.actions[index];
  if (action.actionId !== permit.actionId || action.plugin !== permit.adapter || digest(action.command) !== permit.commandDigest) {
    throw new Error('Protocol adapter command no longer matches permit');
  }
  const capability = classifyAdapterCommand(action);
  const key = String(action.idempotencyKey || '').trim();
  if (capability.requiresIdempotencyKey && !/^[A-Za-z0-9:_-]{8,160}$/.test(key)) {
    throw new Error('Protocol mutating adapter command requires a bound idempotency key');
  }
  if (!capability.requiresIdempotencyKey && action.idempotencyKey !== null) {
    throw new Error('Protocol read/reload adapter command has unexpected idempotency key');
  }
  const checkedAt = Number(options.checkedAt ?? Date.now());
  if (!Number.isSafeInteger(checkedAt) || checkedAt <= 0 || checkedAt < Number(permit.issuedAt) || checkedAt > Number(permit.expiresAt)) {
    throw new Error('Protocol adapter command-contract check is outside permit window');
  }
  return Object.freeze({
    version: 1,
    protocolId: permit.protocolId,
    serverId: permit.serverId,
    actionId: permit.actionId,
    actionIndex: index,
    plugin: capability.plugin,
    operation: capability.operation,
    commandDigest: permit.commandDigest,
    permitDigest: permit.permitDigest,
    mutating: capability.mutating,
    requiresIdempotencyKey: capability.requiresIdempotencyKey,
    idempotencyKeyDigest: capability.requiresIdempotencyKey ? digest(key) : null,
    checkedAt,
    expiresAt: permit.expiresAt,
    requiresFreshAdapterPermit: true,
    requiresReceiptPersistence: true,
    executesCommand: false,
    mutatesServerConfiguration: false,
    grantsRetryAuthority: false,
    readOnly: true
  });
}

module.exports = { classifyAdapterCommand, buildAdapterCommandContract };
