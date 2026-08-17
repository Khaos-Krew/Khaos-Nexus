'use strict';

const crypto = require('node:crypto');
const { getNexusCoreService } = require('./services/nexus-core-service.cjs');

let installed = false;
const registered = new WeakSet();

function stableDigest(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 24);
}

function roleSubject(actor = {}) {
  return { role: String(actor.role || 'locked') };
}

function coreFor(service) {
  return getNexusCoreService({
    dataDirectory: service.dataDirectory || require('node:path').dirname(service.configStore.configPath),
    logger: service.logger
  });
}

function registerServiceActions(service, core, originals) {
  if (registered.has(service)) return;
  registered.add(service);

  if (originals.moderate) {
    core.registerAction('game.player.moderation', {
      requiredCapabilities: (request) => request.input.action === 'ban'
        ? ['game.player.ban']
        : ['game.player.moderate'],
      execute: (request) => originals.moderate.call(service, request.input)
    });
  }

  if (originals.power) {
    core.registerAction('hosted.server.power', {
      requiredCapabilities: (request) => String(request.input.signal || '').toLowerCase() === 'kill'
        ? ['hosted.kill']
        : ['hosted.power'],
      execute: (request) => originals.power.call(service, request.input)
    });
  }

  if (originals.maintenance) {
    core.registerAction('nexus.maintenance.run', {
      requiredCapabilities: ['backup.create', 'game.server.save', 'game.server.broadcast'],
      execute: () => originals.maintenance.call(service)
    });
  }
}

function duplicateModerationResult(input, action) {
  return {
    id: `duplicate-${action.operationId}`,
    action: input.action,
    playerName: 'Previously completed player action',
    serverName: 'See moderation history',
    reason: String(input.reason || '').slice(0, 300),
    actorId: input.actor?.id || '',
    actorName: input.actor?.name || '',
    actorRole: input.actor?.role || '',
    outcome: 'success',
    message: 'Nexus Core suppressed a duplicate moderation request.',
    duplicate: true,
    time: new Date().toISOString()
  };
}

function duplicateHostedResult(input, action) {
  return {
    id: `duplicate-${action.operationId}`,
    providerName: 'Previously completed hosted action',
    serverName: 'See hosted action history',
    signal: input.signal,
    actorId: input.actor?.id || '',
    actorName: input.actor?.name || '',
    actorRole: input.actor?.role || '',
    outcome: 'success',
    message: 'Nexus Core suppressed a duplicate hosted power request.',
    duplicate: true,
    time: new Date().toISOString()
  };
}

function patchPlayerConsole() {
  const target = require('./services/player-console-service.cjs');
  const prototype = target.PlayerConsoleService?.prototype;
  if (!prototype || prototype.__khaosNexusCoreLivePatched) return;
  const original = prototype.moderate;

  prototype.moderate = async function nexusCoreModerate(input = {}) {
    const core = coreFor(this);
    registerServiceActions(this, core, { moderate: original });
    const tokenDigest = stableDigest(input.token);
    const operationId = `player:${String(input.action || 'unknown')}:${tokenDigest}`;
    const request = {
      operationId,
      action: 'game.player.moderation',
      requestedAt: new Date(this.now()).toISOString(),
      scope: { kind: 'player-action', id: tokenDigest },
      actor: { kind: 'user', id: String(input.actor?.id || 'local') },
      source: { kind: 'desktop', id: 'player-console' },
      correlationId: operationId,
      idempotencyKey: operationId,
      requiredCapabilities: [],
      input
    };
    const result = await core.commandGateway.dispatch(request, roleSubject(input.actor));
    if (result.status === 'succeeded') return result.output;
    if (result.status === 'duplicate' && result.output?.originalResultStatus === 'succeeded') {
      return duplicateModerationResult(input, request);
    }
    const error = new Error(result.error?.message || `Player moderation was blocked by Nexus Core (${result.status}).`);
    error.code = result.error?.code || 'NEXUS_PLAYER_ACTION_BLOCKED';
    throw error;
  };

  Object.defineProperty(prototype, '__khaosNexusCoreLivePatched', { value: true });
}

function patchHostedPower() {
  const target = require('./services/hosted-server-service.cjs');
  const prototype = target.HostedServerService?.prototype;
  if (!prototype || prototype.__khaosNexusCoreLivePatched) return;
  const original = prototype.power;

  prototype.power = async function nexusCoreHostedPower(input = {}) {
    const core = coreFor(this);
    registerServiceActions(this, core, { power: original });
    const tokenDigest = stableDigest(input.token);
    const signal = String(input.signal || '').toLowerCase();
    const operationId = `hosted:${signal || 'unknown'}:${tokenDigest}`;
    const request = {
      operationId,
      action: 'hosted.server.power',
      requestedAt: new Date(this.now()).toISOString(),
      scope: { kind: 'hosted-server-action', id: tokenDigest },
      actor: { kind: 'user', id: String(input.actor?.id || 'local') },
      source: { kind: 'desktop', id: 'hosted-server-control' },
      correlationId: operationId,
      idempotencyKey: operationId,
      requiredCapabilities: [],
      input
    };
    const result = await core.commandGateway.dispatch(request, roleSubject(input.actor));
    if (result.status === 'succeeded') return result.output;
    if (result.status === 'duplicate' && result.output?.originalResultStatus === 'succeeded') {
      return duplicateHostedResult(input, request);
    }
    const error = new Error(result.error?.message || `Hosted power action was blocked by Nexus Core (${result.status}).`);
    error.code = result.error?.code || 'NEXUS_HOSTED_ACTION_BLOCKED';
    throw error;
  };

  Object.defineProperty(prototype, '__khaosNexusCoreLivePatched', { value: true });
}

function patchMaintenance() {
  const target = require('./services/autonomy-service.cjs');
  const prototype = target.AutonomyService?.prototype;
  if (!prototype || prototype.__khaosNexusCoreMaintenancePatched || typeof prototype.runMaintenance !== 'function') return;
  const original = prototype.runMaintenance;

  prototype.runMaintenance = async function nexusCoreMaintenance() {
    const core = coreFor(this);
    registerServiceActions(this, core, { maintenance: original });
    const bucket = Math.floor(Number(this.now()) / (5 * 60 * 1000));
    const operationId = `maintenance:${bucket}`;
    const request = {
      operationId,
      action: 'nexus.maintenance.run',
      requestedAt: new Date(this.now()).toISOString(),
      scope: { kind: 'nexus-maintenance', id: String(bucket) },
      actor: { kind: 'system', id: 'desktop-operator' },
      source: { kind: 'desktop', id: 'maintenance-mode' },
      correlationId: operationId,
      idempotencyKey: operationId,
      requiredCapabilities: [],
      input: {}
    };
    const role = this.accessState?.()?.role || 'local-admin';
    const result = await core.commandGateway.dispatch(request, { role });
    if (result.status === 'succeeded') return result.output;
    if (result.status === 'duplicate' && result.output?.originalResultStatus === 'succeeded') {
      return {
        ok: true,
        duplicate: true,
        startedAt: null,
        completedAt: new Date(this.now()).toISOString(),
        results: [{ step: 'core', ok: true, detail: 'Nexus Core suppressed a duplicate maintenance request.' }]
      };
    }
    const error = new Error(result.error?.message || `Maintenance was blocked by Nexus Core (${result.status}).`);
    error.code = result.error?.code || 'NEXUS_MAINTENANCE_BLOCKED';
    throw error;
  };

  Object.defineProperty(prototype, '__khaosNexusCoreMaintenancePatched', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  patchPlayerConsole();
  patchHostedPower();
  patchMaintenance();
}

module.exports = {
  install,
  patchPlayerConsole,
  patchHostedPower,
  patchMaintenance,
  stableDigest
};
