'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const { MIGRATION_STEPS, catalogForRole, getModule, mergeModuleStates, summarizeMigration, moduleProgress, roleAtLeast } = require('../shared/module-catalog.cjs');

const refs = { configStore: null, autonomy: null, discordAuth: null, logger: null };
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

function ensureModuleConfig(store) {
  if (!store?.config?.general) return;
  const previous = store.config.general.moduleMigration;
  const merged = mergeModuleStates(previous, store.config.general.modules || {});
  const changed = JSON.stringify(previous || {}) !== JSON.stringify(merged);
  store.config.general.moduleMigration = merged;
  if (changed) store.saveConfig();
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosModuleFoundationPatched) return;
  class ModuleConfigStore extends Original {
    constructor(...args) { super(...args); refs.configStore = this; ensureModuleConfig(this); }
    getModuleStates() { ensureModuleConfig(this); return mergeModuleStates(this.config.general.moduleMigration, this.config.general.modules || {}); }
    setModuleState(id, patch = {}) {
      if (!getModule(id)) throw new Error('The selected Nexus module was not found.');
      const states = this.getModuleStates();
      const current = states[id];
      const validSteps = new Set(MIGRATION_STEPS.map((step) => step.id));
      const completedSteps = Object.prototype.hasOwnProperty.call(patch, 'completedSteps')
        ? [...new Set((Array.isArray(patch.completedSteps) ? patch.completedSteps : []).filter((step) => validSteps.has(step)))]
        : current.completedSteps;
      states[id] = {
        enabled: Object.prototype.hasOwnProperty.call(patch, 'enabled') ? Boolean(patch.enabled) : current.enabled,
        completedSteps,
        notes: Object.prototype.hasOwnProperty.call(patch, 'notes') ? String(patch.notes || '').slice(0, 2000) : current.notes,
        updatedAt: new Date().toISOString()
      };
      this.config.general.moduleMigration = states;
      this.saveConfig();
      return states[id];
    }
  }
  Object.defineProperty(ModuleConfigStore, '__khaosModuleFoundationPatched', { value: true });
  target.ConfigStore = ModuleConfigStore;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosModuleCapturePatched) return;
  class Captured extends Original { constructor(...args) { super(...args); refs[refName] = this; } }
  Object.defineProperty(Captured, '__khaosModuleCapturePatched', { value: true });
  target[exportName] = Captured;
}

function payload() {
  const role = activeRole();
  const states = refs.configStore?.getModuleStates?.() || mergeModuleStates({});
  const catalog = catalogForRole(role).map((module) => ({ ...module, state: states[module.id], progress: moduleProgress(states[module.id]) }));
  return { role, steps: MIGRATION_STEPS, catalog, summary: summarizeMigration(states, role), states };
}

function lockedPayload() {
  const access = refs.autonomy?.accessState?.(refs.discordAuth?.getState?.()) || {};
  return {
    role: 'locked',
    locked: true,
    reason: access.reason || 'Sign in with an authorized Discord account.',
    steps: [],
    catalog: [],
    summary: { overallProgress: 0, completed: 0, enabled: 0, total: 0, byStage: {} },
    states: {}
  };
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosModuleUiPatched) return;
  const original = prototype.loadFile;
  prototype.loadFile = function patchedLoadFile(...args) {
    this.webContents.once('did-finish-load', () => {
      this.webContents.executeJavaScript(`(() => {
        if (!document.querySelector('link[href="module-hub.css"]')) { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'module-hub.css'; document.head.appendChild(link); }
        if (!document.querySelector('script[src="module-hub.js"]')) { const script = document.createElement('script'); script.src = 'module-hub.js'; script.defer = true; document.body.appendChild(script); }
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
    if (!roleAtLeast(activeRole(), 'viewer')) return lockedPayload();
    return payload();
  });
  electron.ipcMain.handle('modules:update', (_event, request = {}) => {
    assertAccess('owner', 'Change module migration settings');
    const result = refs.configStore.setModuleState(String(request.id || ''), request.patch || {});
    refs.logger?.info?.('Nexus module migration state updated.', { moduleId: request.id, enabled: result.enabled, progress: moduleProgress(result) });
    return payload();
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
    return payload();
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
  patchBrowserLoader();
  electron.app.whenReady().then(() => {
    const wait = () => { if (refs.configStore) registerIpc(); else setTimeout(wait, 100); };
    wait();
  });
}

module.exports = { install, refs, ensureModuleConfig };
