'use strict';

const electron = require('electron');
const foundation = require('./module-foundation-extension.cjs');
const { moduleDecisionForChannel, decisionEnabled, getModule } = require('../shared/module-registry.cjs');

let installed = false;

function configStoreFor(subject = null) {
  return subject?.configStore || foundation.refs.configStore || null;
}

function runtimeFor(subject = null) {
  const store = configStoreFor(subject);
  return store?.getModuleRuntime?.() || {};
}

function moduleEnabled(id, subject = null) {
  return Boolean(runtimeFor(subject)[id]?.effectiveEnabled);
}

function moduleError(ids, action, subject = null) {
  const runtime = runtimeFor(subject);
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  const names = list.map((id) => getModule(id)?.name || id);
  const blocked = list.map((id) => runtime[id]).filter((state) => state && !state.effectiveEnabled);
  const detail = blocked.map((state) => {
    if (state.reason === 'not-implemented') return `${getModule(state.id)?.name || state.id} is not implemented`;
    if (state.reason === 'dependency-disabled') return `${getModule(state.id)?.name || state.id} is blocked by ${state.blockedBy.map((id) => getModule(id)?.name || id).join(', ')}`;
    return `${getModule(state.id)?.name || state.id} is disabled by the owner`;
  }).join('; ');
  const error = new Error(`${action || 'This action'} requires an enabled Nexus module: ${names.join(' or ')}.${detail ? ` ${detail}.` : ''}`);
  error.code = 'MODULE_DISABLED';
  return error;
}

function assertModule(id, action, subject = null) {
  if (!moduleEnabled(id, subject)) throw moduleError([id], action, subject);
  return true;
}

function assertDecision(decision, action, subject = null) {
  if (!decision) return true;
  const runtime = runtimeFor(subject);
  if (!decisionEnabled(runtime, decision)) throw moduleError([...(decision.allOf || []), ...(decision.anyOf || [])], action, subject);
  return true;
}

function patchIpcHandlers() {
  const ipcMain = electron.ipcMain;
  if (!ipcMain || ipcMain.__khaosModuleRuntimePatched) return;
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = function moduleAwareHandle(channel, listener) {
    return originalHandle(channel, (event, ...args) => {
      const decision = moduleDecisionForChannel(channel, args, foundation.refs.configStore);
      assertDecision(decision, String(channel || 'Nexus action'));
      return listener(event, ...args);
    });
  };
  Object.defineProperty(ipcMain, '__khaosModuleRuntimePatched', { value: true });
}

function wrapMethod(prototype, method, wrapper, marker) {
  if (!prototype || typeof prototype[method] !== 'function') return;
  const key = marker || `__khaosModuleRuntime_${method}`;
  if (prototype[key]) return;
  const original = prototype[method];
  prototype[method] = wrapper(original);
  Object.defineProperty(prototype, key, { value: true });
}

function patchBotSupervisor() {
  const prototype = require('./services/bot-supervisor.cjs').BotSupervisor?.prototype;
  wrapMethod(prototype, 'start', (original) => function moduleAwareStart(...args) {
    assertModule('discord-runtime', 'Start Discord Runtime', this);
    return original.apply(this, args);
  });
}

function patchApplicationMonitor() {
  const prototype = require('./services/application-monitor.cjs').ApplicationMonitor?.prototype;
  wrapMethod(prototype, 'processAutomaticBatch', (original) => async function moduleAwareBatch(...args) {
    if (!moduleEnabled('application-monitor', this)) return { skipped: true, reason: 'module-disabled', remaining: this.state?.queue?.length || 0 };
    return original.apply(this, args);
  });
  wrapMethod(prototype, 'verifyConnection', (original) => async function moduleAwareVerify(...args) {
    assertModule('application-monitor', 'Verify Application Monitor', this);
    return original.apply(this, args);
  });
}

function patchAutonomyService() {
  const prototype = require('./services/autonomy-service.cjs').AutonomyService?.prototype;
  for (const [method, action] of [
    ['checkServers', 'Run game-server health checks'],
    ['runRecovery', 'Run Safe Recovery'],
    ['runMaintenance', 'Run Maintenance Mode']
  ]) {
    wrapMethod(prototype, method, (original) => async function moduleAwareAutonomy(...args) {
      assertModule('operator-console', action, this);
      return original.apply(this, args);
    });
  }
  wrapMethod(prototype, 'createAutomaticBackup', (original) => function moduleAwareBackup(...args) {
    assertModule('backup-update-center', 'Create a Khaos Nexus backup', this);
    return original.apply(this, args);
  });
  wrapMethod(prototype, 'schedulerTick', (original) => async function moduleAwareAutonomyTick(...args) {
    const operatorEnabled = moduleEnabled('operator-console', this);
    const backupsEnabled = moduleEnabled('backup-update-center', this);
    if (!operatorEnabled) {
      if (backupsEnabled && this.backupDue?.()) this.createAutomaticBackup('scheduled');
      return { skipped: true, reason: 'operator-console-disabled' };
    }
    if (backupsEnabled) return original.apply(this, args);
    const savedBackupDue = this.backupDue;
    this.backupDue = () => false;
    try { return await original.apply(this, args); }
    finally { this.backupDue = savedBackupDue; }
  });
}

function patchUpdateService() {
  const prototype = require('./services/update-service.cjs').UpdateService?.prototype;
  for (const [method, action] of [
    ['check', 'Check for Khaos Nexus updates'],
    ['download', 'Download a Khaos Nexus update'],
    ['install', 'Install a Khaos Nexus update'],
    ['checkIfDue', 'Run a scheduled Khaos Nexus update check']
  ]) {
    wrapMethod(prototype, method, (original) => function moduleAwareUpdate(...args) {
      assertModule('backup-update-center', action, this);
      return original.apply(this, args);
    });
  }
  wrapMethod(prototype, 'configureAutomaticChecks', (original) => function moduleAwareAutomaticUpdates(enabled, ...args) {
    return original.call(this, Boolean(enabled && moduleEnabled('backup-update-center', this)), ...args);
  });
}

function patchServerScheduler() {
  const prototype = require('./services/server-scheduler-service.cjs').ServerSchedulerService?.prototype;
  wrapMethod(prototype, 'tick', (original) => async function moduleAwareSchedulerTick(...args) {
    if (!moduleEnabled('server-scheduler', this)) return { skipped: true, reason: 'module-disabled' };
    return original.apply(this, args);
  });
  wrapMethod(prototype, 'runNow', (original) => function moduleAwareRunNow(...args) {
    assertModule('server-scheduler', 'Run a server schedule', this);
    return original.apply(this, args);
  });
}

function patchStatusPanels() {
  const prototype = require('./services/status-panel-service.cjs').StatusPanelService?.prototype;
  for (const method of ['resources', 'snapshot', 'publish', 'refresh', 'removePublished']) {
    wrapMethod(prototype, method, (original) => function moduleAwareStatusPanel(...args) {
      assertModule('server-status-panels', 'Use server status panels', this);
      return original.apply(this, args);
    });
  }
  const studio = require('./services/discord-studio-service.cjs').DiscordStudioService?.prototype;
  wrapMethod(studio, 'refreshDuePanels', (original) => async function moduleAwareStudioRefresh(...args) {
    if (!moduleEnabled('server-status-panels', this)) return [];
    return original.apply(this, args);
  });
}

function patchDiscordObservability() {
  const prototype = require('./services/discord-observability-service.cjs').DiscordObservabilityService?.prototype;
  wrapMethod(prototype, 'deliver', (original) => async function moduleAwareObservability(...args) {
    if (!moduleEnabled('discord-observability', this)) return { skipped: true, reason: 'module-disabled' };
    return original.apply(this, args);
  });
  wrapMethod(prototype, 'tick', (original) => async function moduleAwareObservabilityTick(...args) {
    if (!moduleEnabled('discord-observability', this)) return { skipped: true, reason: 'module-disabled' };
    return original.apply(this, args);
  });
}

function install() {
  if (installed) return;
  installed = true;
  patchIpcHandlers();
  patchBotSupervisor();
  patchApplicationMonitor();
  patchAutonomyService();
  patchUpdateService();
  patchServerScheduler();
  patchStatusPanels();
  patchDiscordObservability();
}

module.exports = {
  install,
  moduleEnabled,
  assertModule,
  assertDecision,
  moduleError,
  runtimeFor,
  patchIpcHandlers
};