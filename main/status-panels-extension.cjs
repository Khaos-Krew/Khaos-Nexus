'use strict';

const path = require('node:path');
const electron = require('electron');
const {
  normalizeStatusPanel,
  normalizeStatusPanelsConfig,
  dueForRefresh
} = require('../shared/status-panels.cjs');
const { StatusPanelService } = require('./services/status-panel-service.cjs');

const refs = { configStore: null, logger: null, autonomy: null, discordAuth: null, supervisor: null, service: null };
const refreshing = new Set();
let installed = false;
let refreshTimer = null;

function migrationStepIds() {
  try { return require('../shared/module-catalog.cjs').MIGRATION_STEPS.map((step) => step.id); }
  catch { return ['inventory', 'data', 'services', 'interface', 'access', 'validation']; }
}

function promoteCatalog() {
  try {
    const { MODULE_CATALOG } = require('../shared/module-catalog.cjs');
    const module = MODULE_CATALOG.find((item) => item.id === 'server-status-panels');
    if (module) Object.assign(module, {
      stage: 'live',
      launchView: 'status-panels',
      description: 'Persistent Discord game-server status panels with public-safe summaries, automatic refresh, and live member controls.',
      features: ['Persistent Discord messages', 'Automatic health refresh', 'Manual refresh button', 'Privacy-controlled player summaries', 'REST and RCON support', 'Operator audit history']
    });
  } catch {}
}

function ensureService() {
  if (!refs.service && refs.configStore && refs.logger) refs.service = new StatusPanelService({ configStore: refs.configStore, logger: refs.logger });
  return refs.service;
}

function ensureConfig(store) {
  const current = store.config.statusPanels;
  const normalized = normalizeStatusPanelsConfig(current || {});
  let changed = JSON.stringify(current || null) !== JSON.stringify(normalized);
  store.config.statusPanels = normalized;
  const state = store.config.general?.moduleMigration?.['server-status-panels'];
  if (state && state.completedSteps?.length !== migrationStepIds().length) {
    state.enabled = true;
    state.completedSteps = migrationStepIds();
    state.updatedAt = new Date().toISOString();
    changed = true;
  }
  if (changed) store.saveConfig();
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosStatusPanelsPatched) return;
  class StatusPanelConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      ensureConfig(this);
      ensureService();
    }

    getStatusPanels() {
      ensureConfig(this);
      return JSON.parse(JSON.stringify(this.config.statusPanels));
    }

    upsertStatusPanel(input) {
      ensureConfig(this);
      const panel = normalizeStatusPanel(input);
      const list = this.config.statusPanels.panels;
      const index = list.findIndex((item) => item.id === panel.id);
      if (index >= 0) list[index] = panel;
      else list.push(panel);
      this.config.statusPanels = normalizeStatusPanelsConfig(this.config.statusPanels);
      this.saveConfig();
      return panel;
    }

    patchStatusPanel(id, patch = {}) {
      ensureConfig(this);
      const index = this.config.statusPanels.panels.findIndex((item) => item.id === id);
      if (index < 0) throw new Error('The selected status panel was not found.');
      this.config.statusPanels.panels[index] = normalizeStatusPanel({ ...this.config.statusPanels.panels[index], ...patch, id });
      this.saveConfig();
      return this.config.statusPanels.panels[index];
    }

    removeStatusPanel(id) {
      ensureConfig(this);
      this.config.statusPanels.panels = this.config.statusPanels.panels.filter((item) => item.id !== id);
      this.saveConfig();
      return this.getStatusPanels();
    }
  }
  Object.defineProperty(StatusPanelConfigStore, '__khaosStatusPanelsPatched', { value: true });
  target.ConfigStore = StatusPanelConfigStore;
}

function activeRole() {
  try { return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'local-admin'; }
  catch { return 'local-admin'; }
}

function assertAccess(role, action) {
  if (refs.autonomy?.assertAccess) return refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), role, action);
  const rank = { locked: 0, viewer: 1, operator: 2, owner: 3, 'local-admin': 3 };
  if ((rank[activeRole()] || 0) < (rank[role] || 0)) throw new Error(`${action} requires ${role} access.`);
  return true;
}

async function audit(input) {
  const auth = refs.discordAuth?.getState?.() || {};
  const entry = {
    category: 'server-status-panels',
    actorId: String(input.actorId || auth.user?.id || ''),
    actorName: String(input.actorName || auth.user?.globalName || auth.user?.username || 'Local operator'),
    actorRole: input.actorRole || activeRole(),
    time: input.time || new Date().toISOString(),
    ...input
  };
  if (refs.configStore?.appendDiscordAudit) refs.configStore.appendDiscordAudit(entry);
  refs.logger?.write?.(entry.outcome === 'failed' ? 'error' : 'info', `Status panels: ${entry.action}`, { target: entry.targetName, summary: entry.summary }, 'status-panels');
}

function pushBotConfig() {
  if (refs.supervisor?.child) refs.supervisor.child.postMessage({ type: 'config-update', payload: refs.configStore.getRuntimeBootstrap() });
}

function payload() {
  const publicConfig = refs.configStore.getPublicConfig();
  return {
    role: activeRole(),
    guildId: publicConfig.discord?.guildId || '',
    botConfigured: Boolean(publicConfig.hasDiscordToken),
    bot: refs.supervisor?.getState?.() || null,
    servers: (publicConfig.servers || []).map((server) => ({
      id: server.id, name: server.name, game: server.game, enabled: server.enabled !== false,
      connectionType: server.connectionType || (server.game === 'palworld' ? 'rest' : 'rcon'), hasPassword: Boolean(server.hasPassword)
    })),
    statusPanels: refs.configStore.getStatusPanels()
  };
}

function broadcast() {
  if (!refs.configStore) return;
  const state = payload();
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('status-panels:update', state);
  }
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosStatusPanelsCapturePatched) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
      ensureService();
    }

    handleMessage(message) {
      if (refName === 'supervisor' && message?.type === 'status-panel-refreshed') {
        try {
          refs.configStore?.patchStatusPanel?.(message.payload.panelId, { lastRefreshedAt: message.payload.refreshedAt, lastError: '' });
          broadcast();
        } catch {}
        return;
      }
      return super.handleMessage(message);
    }
  }
  Object.defineProperty(Captured, '__khaosStatusPanelsCapturePatched', { value: true });
  target[exportName] = Captured;
}

async function refreshPanel(id, source = 'desktop') {
  if (refreshing.has(id)) return null;
  const panel = refs.configStore.getStatusPanels().panels.find((item) => item.id === id);
  if (!panel) throw new Error('The selected status panel was not found.');
  refreshing.add(id);
  try {
    const result = await ensureService().refresh(panel);
    refs.configStore.patchStatusPanel(id, { lastRefreshedAt: result.refreshedAt, lastError: '' });
    pushBotConfig();
    if (source !== 'scheduler') await audit({ action: 'status-panel.refreshed', outcome: 'success', targetType: 'status-panel', targetId: id, targetName: panel.name, summary: `Refreshed ${panel.name} from ${source}.` });
    broadcast();
    return result;
  } catch (error) {
    refs.configStore.patchStatusPanel(id, { lastError: error.message });
    if (source !== 'scheduler') await audit({ action: 'status-panel.refreshed', outcome: 'failed', targetType: 'status-panel', targetId: id, targetName: panel.name, summary: error.message });
    else refs.logger?.warn?.('Automatic status panel refresh failed.', { panelId: id, message: error.message });
    broadcast();
    throw error;
  } finally {
    refreshing.delete(id);
  }
}

async function refreshDuePanels() {
  if (!refs.configStore || !refs.service) return;
  const now = Date.now();
  const panels = refs.configStore.getStatusPanels().panels.filter((panel) => dueForRefresh(panel, now));
  for (const panel of panels) {
    try { await refreshPanel(panel.id, 'scheduler'); }
    catch {}
  }
}

function registerIpc() {
  if (registerIpc.done || !refs.configStore) return;
  registerIpc.done = true;

  electron.ipcMain.handle('status-panels:get', () => {
    assertAccess('viewer', 'View server status panels');
    return payload();
  });

  electron.ipcMain.handle('status-panels:resources', (_event, guildId) => {
    assertAccess('operator', 'Load Discord channels for status panels');
    return ensureService().resources(guildId);
  });

  electron.ipcMain.handle('status-panels:save', async (_event, input) => {
    assertAccess('operator', 'Save server status panels');
    const saved = refs.configStore.upsertStatusPanel(input);
    pushBotConfig();
    await audit({ action: 'status-panel.saved', outcome: 'success', targetType: 'status-panel', targetId: saved.id, targetName: saved.name, summary: `Saved a ${saved.refreshMinutes}-minute status panel for server ${saved.serverId || 'not selected'}.` });
    broadcast();
    return payload();
  });

  electron.ipcMain.handle('status-panels:publish', async (_event, id) => {
    assertAccess('operator', 'Publish server status panels');
    const panel = refs.configStore.getStatusPanels().panels.find((item) => item.id === id);
    if (!panel) throw new Error('The selected status panel was not found.');
    try {
      const result = await ensureService().publish(panel);
      refs.configStore.patchStatusPanel(id, {
        guildId: result.guildId, channelId: result.channelId, messageId: result.messageId,
        publishedAt: result.publishedAt, lastRefreshedAt: result.refreshedAt, lastError: ''
      });
      pushBotConfig();
      await audit({ action: 'status-panel.published', outcome: 'success', targetType: 'status-panel', targetId: id, targetName: panel.name, summary: result.replaced ? 'Published a replacement persistent status message.' : 'Updated the existing persistent status message.' });
      broadcast();
      return { result, state: payload() };
    } catch (error) {
      refs.configStore.patchStatusPanel(id, { lastError: error.message });
      await audit({ action: 'status-panel.published', outcome: 'failed', targetType: 'status-panel', targetId: id, targetName: panel.name, summary: error.message });
      broadcast();
      throw error;
    }
  });

  electron.ipcMain.handle('status-panels:refresh', (_event, id) => {
    assertAccess('operator', 'Refresh server status panels');
    return refreshPanel(id, 'desktop');
  });

  electron.ipcMain.handle('status-panels:refresh-all', async () => {
    assertAccess('operator', 'Refresh all server status panels');
    const ids = refs.configStore.getStatusPanels().panels.filter((panel) => panel.messageId && panel.enabled).map((panel) => panel.id);
    const results = [];
    for (const id of ids) {
      try { results.push({ id, ok: true, result: await refreshPanel(id, 'desktop-batch') }); }
      catch (error) { results.push({ id, ok: false, error: error.message }); }
    }
    return { results, state: payload() };
  });

  electron.ipcMain.handle('status-panels:unpublish', async (_event, id) => {
    assertAccess('operator', 'Delete published server status panels');
    const panel = refs.configStore.getStatusPanels().panels.find((item) => item.id === id);
    if (!panel) throw new Error('The selected status panel was not found.');
    await ensureService().removePublished(panel);
    refs.configStore.patchStatusPanel(id, { messageId: '', publishedAt: null, lastRefreshedAt: null, lastError: '' });
    pushBotConfig();
    await audit({ action: 'status-panel.unpublished', outcome: 'success', targetType: 'status-panel', targetId: id, targetName: panel.name, summary: 'Deleted the persistent Discord status message.' });
    broadcast();
    return payload();
  });

  electron.ipcMain.handle('status-panels:remove', async (_event, id) => {
    assertAccess('operator', 'Remove server status panel configuration');
    const panel = refs.configStore.getStatusPanels().panels.find((item) => item.id === id);
    if (panel?.messageId) throw new Error('Delete the published Discord message before removing its configuration.');
    refs.configStore.removeStatusPanel(id);
    pushBotConfig();
    await audit({ action: 'status-panel.removed', outcome: 'success', targetType: 'status-panel', targetId: id, targetName: panel?.name || id, summary: 'Removed the status panel configuration.' });
    broadcast();
    return payload();
  });
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosStatusPanelsUiPatched) return;
  const original = prototype.loadFile;
  prototype.loadFile = function patchedLoadFile(...args) {
    this.webContents.once('did-finish-load', () => {
      this.webContents.executeJavaScript(`(() => {
        if (!document.querySelector('link[href="status-panels.css"]')) { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'status-panels.css'; document.head.appendChild(link); }
        if (!document.querySelector('script[src="status-panels.js"]')) { const script = document.createElement('script'); script.src = 'status-panels.js'; script.defer = true; document.body.appendChild(script); }
      })();`).catch(() => {});
    });
    return original.apply(this, args);
  };
  Object.defineProperty(prototype, '__khaosStatusPanelsUiPatched', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  promoteCatalog();
  patchConfigStore();
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  captureClass('./services/bot-supervisor.cjs', 'BotSupervisor', 'supervisor');
  patchBrowserLoader();
  electron.app.whenReady().then(() => {
    const wait = () => {
      if (refs.configStore && refs.logger) {
        ensureService();
        registerIpc();
        clearInterval(refreshTimer);
        refreshTimer = setInterval(() => refreshDuePanels().catch(() => {}), 60000);
        refreshTimer.unref();
        setTimeout(() => refreshDuePanels().catch(() => {}), 15000).unref();
      } else setTimeout(wait, 100);
    };
    wait();
  });
}

module.exports = { install, refs, ensureConfig, refreshDuePanels };
