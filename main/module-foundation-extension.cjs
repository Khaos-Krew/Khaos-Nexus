'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const {
  MIGRATION_STEPS,
  VIEW_RULES,
  catalog,
  catalogForRole,
  getModule,
  mergeModuleStates,
  normalizeModuleOverrides,
  summarizeMigration,
  moduleProgress,
  buildModuleRuntime,
  roleAtLeast
} = require('../shared/module-registry.cjs');

const refs = { configStore: null, autonomy: null, discordAuth: null, logger: null, supervisor: null };
let installed = false;

function activeRole() {
  try { return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'local-admin'; }
  catch { return 'local-admin'; }
}

function assertAccess(requiredRole, action) {
  if (refs.autonomy?.assertAccess) return refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), requiredRole, action);
  if (!roleAtLeast(activeRole(), requiredRole)) throw new Error(`${action} requires ${requiredRole} access.`);
  return true;
}

function reconcileModuleConfig(store) {
  if (!store?.config?.general) return false;
  const previousStates = store.config.general.moduleMigration;
  const previousOverrides = store.config.general.moduleOverrides;
  const overrides = normalizeModuleOverrides(previousOverrides || {});
  const merged = mergeModuleStates(previousStates, store.config.general.modules || {}, overrides);
  const changed = JSON.stringify(previousStates || {}) !== JSON.stringify(merged)
    || JSON.stringify(previousOverrides || {}) !== JSON.stringify(overrides);
  store.config.general.moduleMigration = merged;
  store.config.general.moduleOverrides = overrides;
  return changed;
}

function ensureModuleConfig(store) {
  if (reconcileModuleConfig(store)) store.saveConfig();
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosModuleFoundationPatched) return;

  class ModuleConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      ensureModuleConfig(this);
    }

    saveConfig(...args) {
      reconcileModuleConfig(this);
      return super.saveConfig(...args);
    }

    getModuleStates() {
      reconcileModuleConfig(this);
      return mergeModuleStates(
        this.config.general.moduleMigration,
        this.config.general.modules || {},
        this.config.general.moduleOverrides || {}
      );
    }

    getModuleRuntime() {
      return buildModuleRuntime(this.getModuleStates());
    }

    getRuntimeBootstrap(...args) {
      const runtime = super.getRuntimeBootstrap(...args);
      runtime.config.moduleStates = this.getModuleStates();
      runtime.config.moduleRuntime = this.getModuleRuntime();
      return runtime;
    }

    setModuleState(id, patch = {}) {
      const module = getModule(id);
      if (!module) throw new Error('The selected Nexus module was not found.');
      const states = this.getModuleStates();
      const current = states[id];
      const validSteps = new Set(MIGRATION_STEPS.map((step) => step.id));
      const completedSteps = Object.prototype.hasOwnProperty.call(patch, 'completedSteps')
        ? [...new Set((Array.isArray(patch.completedSteps) ? patch.completedSteps : []).filter((step) => validSteps.has(step)))]
        : current.completedSteps;

      if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) {
        const enabled = Boolean(patch.enabled);
        if (enabled && module.availability === 'planned') {
          throw new Error(`${module.name} is inventoried but has no runnable desktop implementation yet.`);
        }
        this.config.general.moduleOverrides ||= {};
        this.config.general.moduleOverrides[id] = { enabled, updatedAt: new Date().toISOString() };
        current.enabled = enabled;
      }

      states[id] = {
        enabled: current.enabled,
        completedSteps,
        notes: Object.prototype.hasOwnProperty.call(patch, 'notes') ? String(patch.notes || '').slice(0, 2000) : current.notes,
        updatedAt: new Date().toISOString()
      };
      this.config.general.moduleMigration = states;
      this.saveConfig();
      return this.getModuleStates()[id];
    }

    setModuleBulkMode(mode) {
      const value = String(mode || '');
      const items = catalog();
      const enabledByMode = (module) => {
        if (value === 'validated') return module.availability === 'implemented';
        if (value === 'safe-mode') return ['application-monitor', 'backup-update-center'].includes(module.id);
        if (value === 'disable-optional') return false;
        throw new Error('Unknown module bulk mode.');
      };
      const now = new Date().toISOString();
      this.config.general.moduleOverrides ||= {};
      for (const module of items) this.config.general.moduleOverrides[module.id] = { enabled: enabledByMode(module), updatedAt: now };
      this.saveConfig();
      return this.getModuleStates();
    }
  }

  Object.defineProperty(ModuleConfigStore, '__khaosModuleFoundationPatched', { value: true });
  target.ConfigStore = ModuleConfigStore;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosModuleCapturePatched) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
    }
  }
  Object.defineProperty(Captured, '__khaosModuleCapturePatched', { value: true });
  target[exportName] = Captured;
}

function payload() {
  const role = activeRole();
  const states = refs.configStore?.getModuleStates?.() || mergeModuleStates({});
  const runtime = buildModuleRuntime(states);
  const visible = catalogForRole(role).map((module) => ({
    ...module,
    state: states[module.id],
    runtime: runtime[module.id],
    progress: moduleProgress(states[module.id])
  }));
  return {
    role,
    ownerControls: ['owner', 'local-admin'].includes(role),
    steps: MIGRATION_STEPS,
    catalog: visible,
    summary: summarizeMigration(states, role),
    states,
    runtime,
    viewRules: VIEW_RULES
  };
}

function broadcast(snapshot = payload()) {
  for (const window of electron.BrowserWindow.getAllWindows()) {
    try {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('modules:state', snapshot);
    } catch {}
  }
  return snapshot;
}

async function applyRuntimeChange(moduleId) {
  const snapshot = payload();
  const discordEnabled = snapshot.runtime['discord-runtime']?.effectiveEnabled;
  if (moduleId === 'discord-runtime' && !discordEnabled && refs.supervisor?.child) {
    await refs.supervisor.stop();
    refs.logger?.warn?.('Discord Runtime was stopped because the owner disabled its module.', { moduleId });
  }
  if (refs.supervisor?.child) {
    refs.supervisor.child.postMessage({ type: 'config-update', payload: refs.configStore.getRuntimeBootstrap() });
  }
  return broadcast(snapshot);
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosModuleUiPatched) return;
  const original = prototype.loadFile;
  prototype.loadFile = function patchedLoadFile(...args) {
    this.webContents.once('did-finish-load', () => {
      this.webContents.executeJavaScript(`(() => {
        const style = (href) => { if (document.querySelector('link[href="' + href + '"]')) return; const node = document.createElement('link'); node.rel = 'stylesheet'; node.href = href; document.head.appendChild(node); };
        const script = (src) => { if (document.querySelector('script[src="' + src + '"]')) return; const node = document.createElement('script'); node.src = src; node.defer = true; document.body.appendChild(node); };
        style('module-hub.css');
        style('module-runtime.css');
        script('module-hub.js');
        script('module-runtime.js');
        script('module-owner-controls.js');
      })();`).catch(() => {});
    });
    return original.apply(this, args);
  };
  Object.defineProperty(prototype, '__khaosModuleUiPatched', { value: true });
}

function registerIpc() {
  if (registerIpc.done || !refs.configStore) return;
  registerIpc.done = true;

  electron.ipcMain.handle('modules:get', () => {
    assertAccess('viewer', 'View the module migration center');
    return payload();
  });

  electron.ipcMain.handle('modules:update', async (_event, request = {}) => {
    assertAccess('owner', 'Change module runtime settings');
    const id = String(request.id || '');
    const result = refs.configStore.setModuleState(id, request.patch || {});
    refs.logger?.info?.('Owner module state updated.', {
      moduleId: id,
      requestedEnabled: result.enabled,
      effectiveEnabled: refs.configStore.getModuleRuntime()[id]?.effectiveEnabled,
      progress: moduleProgress(result)
    });
    return applyRuntimeChange(id);
  });

  electron.ipcMain.handle('modules:bulk-update', async (_event, mode) => {
    assertAccess('owner', 'Change all module runtime settings');
    refs.configStore.setModuleBulkMode(mode);
    refs.logger?.warn?.('Owner module bulk mode applied.', { mode: String(mode || '') });
    if (refs.supervisor?.child && !refs.configStore.getModuleRuntime()['discord-runtime']?.effectiveEnabled) await refs.supervisor.stop();
    if (refs.supervisor?.child) refs.supervisor.child.postMessage({ type: 'config-update', payload: refs.configStore.getRuntimeBootstrap() });
    return broadcast(payload());
  });

  electron.ipcMain.handle('modules:mark-step', (_event, request = {}) => {
    assertAccess('owner', 'Change module migration progress');
    const id = String(request.id || '');
    const stepId = String(request.stepId || '');
    const current = refs.configStore.getModuleStates()[id];
    if (!current) throw new Error('The selected Nexus module was not found.');
    if (!MIGRATION_STEPS.some((step) => step.id === stepId)) throw new Error('The selected migration step was not found.');
    const completed = new Set(current.completedSteps || []);
    if (request.completed === false) completed.delete(stepId); else completed.add(stepId);
    refs.configStore.setModuleState(id, { completedSteps: [...completed] });
    return broadcast(payload());
  });

  electron.ipcMain.handle('modules:export-roadmap', async () => {
    assertAccess('owner', 'Export the module migration roadmap');
    const snapshot = payload();
    const result = await electron.dialog.showSaveDialog({
      title: 'Export Khaos Nexus module roadmap',
      defaultPath: path.join(electron.app.getPath('documents'), `khaos-nexus-module-roadmap-${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: 'JSON roadmap', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, JSON.stringify({ exportedAt: new Date().toISOString(), ...snapshot }, null, 2), 'utf8');
    refs.logger?.info?.('Nexus module roadmap exported.', { filePath: result.filePath });
    return { canceled: false, filePath: result.filePath };
  });
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  captureClass('./services/bot-supervisor.cjs', 'BotSupervisor', 'supervisor');
  patchBrowserLoader();
  electron.app.whenReady().then(() => {
    const wait = () => { if (refs.configStore) registerIpc(); else setTimeout(wait, 100); };
    wait();
  });
}

module.exports = { install, refs, ensureModuleConfig, reconcileModuleConfig, payload, broadcast, applyRuntimeChange };