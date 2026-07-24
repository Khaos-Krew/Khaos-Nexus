'use strict';

const electron = require('electron');
const { DEFAULT_STATUS_TEMPLATE, normalizeDiscordStudioConfig, normalizeTemplate, normalizePanel } = require('../shared/discord-studio.cjs');
const { DiscordStudioService } = require('./services/discord-studio-service.cjs');

const refs = { configStore: null, logger: null, autonomy: null, discordAuth: null, service: null };
let installed = false;

function migrationStepIds() {
  try { return require('../shared/module-catalog.cjs').MIGRATION_STEPS.map((step) => step.id); }
  catch { return ['inventory', 'data', 'services', 'interface', 'access', 'validation']; }
}

function promoteCatalog() {
  const { MODULE_CATALOG } = require('../shared/module-catalog.cjs');
  const embed = MODULE_CATALOG.find((module) => module.id === 'embed-studio');
  if (embed) Object.assign(embed, {
    stage: 'live',
    launchView: 'discord-studio',
    description: 'Design, preview, publish and maintain reusable Discord embeds with protected local configuration.',
    features: ['Visual embed builder', 'Live desktop preview', 'Discord channel discovery', 'Link-button components', 'Reusable templates', 'Protected publishing']
  });
  const panels = MODULE_CATALOG.find((module) => module.id === 'server-status-panels');
  if (panels) Object.assign(panels, {
    stage: 'live',
    launchView: 'discord-studio',
    description: 'Persistent public-safe Discord server panels with scheduled refresh and offline-state reporting.',
    features: ['Persistent status messages', 'Automatic refresh', 'Public-safe player totals', 'Offline-state publishing', 'Manual refresh and replacement', 'Discord channel publishing']
  });
}

function ensureService() {
  if (!refs.service && refs.configStore && refs.logger) {
    refs.service = new DiscordStudioService({ configStore: refs.configStore, logger: refs.logger });
  }
  return refs.service;
}

function ensureConfig(store) {
  const current = store.config.discordStudio;
  const normalized = normalizeDiscordStudioConfig(current || {});
  let changed = JSON.stringify(current || null) !== JSON.stringify(normalized);
  store.config.discordStudio = normalized;

  const moduleStates = store.config.general?.moduleMigration;
  if (moduleStates && typeof moduleStates === 'object') {
    for (const id of ['embed-studio', 'server-status-panels']) {
      const state = moduleStates[id];
      if (state && !state.updatedAt) {
        state.enabled = true;
        state.completedSteps = migrationStepIds();
        changed = true;
      }
    }
  }
  if (changed) store.saveConfig();
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDiscordStudioPatched) return;

  class DiscordStudioConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      ensureConfig(this);
      ensureService();
    }

    getDiscordStudio() {
      ensureConfig(this);
      return JSON.parse(JSON.stringify(this.config.discordStudio));
    }

    upsertDiscordTemplate(input) {
      ensureConfig(this);
      const template = normalizeTemplate(input);
      const items = this.config.discordStudio.templates;
      const index = items.findIndex((item) => item.id === template.id);
      if (index >= 0) items[index] = template;
      else items.push(template);
      this.config.discordStudio = normalizeDiscordStudioConfig(this.config.discordStudio);
      this.saveConfig();
      return template;
    }

    removeDiscordTemplate(id) {
      ensureConfig(this);
      const value = String(id || '');
      if (['default-server-status', 'default-announcement'].includes(value)) throw new Error('Built-in Nexus templates cannot be removed. Duplicate and edit them instead.');
      this.config.discordStudio.templates = this.config.discordStudio.templates.filter((item) => item.id !== value);
      this.config.discordStudio.panels = this.config.discordStudio.panels.map((panel) => panel.templateId === value ? { ...panel, templateId: DEFAULT_STATUS_TEMPLATE.id } : panel);
      this.saveConfig();
      return this.getDiscordStudio();
    }

    upsertDiscordPanel(input) {
      ensureConfig(this);
      const panel = normalizePanel(input);
      if (!this.config.servers.some((server) => server.id === panel.serverId)) throw new Error('Choose a configured game server for this status panel.');
      if (!this.config.discordStudio.templates.some((template) => template.id === panel.templateId)) panel.templateId = DEFAULT_STATUS_TEMPLATE.id;
      const items = this.config.discordStudio.panels;
      const index = items.findIndex((item) => item.id === panel.id);
      if (index >= 0) items[index] = panel;
      else items.push(panel);
      this.config.discordStudio = normalizeDiscordStudioConfig(this.config.discordStudio);
      this.saveConfig();
      return panel;
    }

    setDiscordPanelPublication(id, patch = {}) {
      ensureConfig(this);
      const index = this.config.discordStudio.panels.findIndex((panel) => panel.id === id);
      if (index < 0) throw new Error('The selected status panel was not found.');
      this.config.discordStudio.panels[index] = normalizePanel({ ...this.config.discordStudio.panels[index], ...patch, id });
      this.saveConfig();
      return this.config.discordStudio.panels[index];
    }

    removeDiscordPanel(id) {
      ensureConfig(this);
      this.config.discordStudio.panels = this.config.discordStudio.panels.filter((panel) => panel.id !== id);
      this.saveConfig();
      return this.getDiscordStudio();
    }
  }

  Object.defineProperty(DiscordStudioConfigStore, '__khaosDiscordStudioPatched', { value: true });
  target.ConfigStore = DiscordStudioConfigStore;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosDiscordStudioCapturePatched) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
      ensureService();
    }
  }
  Object.defineProperty(Captured, '__khaosDiscordStudioCapturePatched', { value: true });
  target[exportName] = Captured;
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

function broadcast(payload) {
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('discord-studio:update', payload);
  }
}

function studioPayload() {
  const service = ensureService();
  const publicConfig = refs.configStore.getPublicConfig();
  return {
    role: activeRole(),
    guildId: publicConfig.discord?.guildId || '',
    botConfigured: Boolean(publicConfig.hasDiscordToken),
    servers: publicConfig.servers || [],
    studio: refs.configStore.getDiscordStudio(),
    runtime: service?.getState() || { panels: {}, schedulerActive: false }
  };
}

function registerIpc() {
  if (registerIpc.done || !refs.configStore) return;
  registerIpc.done = true;

  electron.ipcMain.handle('discord-studio:get', () => { assertAccess('viewer', 'View Discord Studio'); return studioPayload(); });
  electron.ipcMain.handle('discord-studio:list-channels', async (_event, guildId) => {
    assertAccess('operator', 'Load Discord channels');
    return ensureService().listChannels(guildId);
  });
  electron.ipcMain.handle('discord-studio:save-template', (_event, template) => {
    assertAccess('operator', 'Save Discord embed templates');
    const saved = refs.configStore.upsertDiscordTemplate(template);
    refs.logger?.info?.('Discord embed template saved.', { templateId: saved.id, name: saved.name });
    const payload = studioPayload(); broadcast(payload); return payload;
  });
  electron.ipcMain.handle('discord-studio:remove-template', (_event, id) => {
    assertAccess('operator', 'Remove Discord embed templates');
    refs.configStore.removeDiscordTemplate(id);
    refs.logger?.warn?.('Discord embed template removed.', { templateId: id });
    const payload = studioPayload(); broadcast(payload); return payload;
  });
  electron.ipcMain.handle('discord-studio:preview', async (_event, request = {}) => {
    assertAccess('operator', 'Publish Discord embed previews');
    return ensureService().previewTemplate(request.channelId, request.template);
  });
  electron.ipcMain.handle('discord-studio:save-panel', (_event, panel) => {
    assertAccess('operator', 'Save Discord server status panels');
    const saved = refs.configStore.upsertDiscordPanel(panel);
    refs.logger?.info?.('Discord status-panel configuration saved.', { panelId: saved.id, serverId: saved.serverId });
    const payload = studioPayload(); broadcast(payload); return payload;
  });
  electron.ipcMain.handle('discord-studio:remove-panel', (_event, id) => {
    assertAccess('operator', 'Remove Discord server status panels');
    refs.configStore.removeDiscordPanel(id);
    refs.logger?.warn?.('Discord status-panel configuration removed.', { panelId: id });
    const payload = studioPayload(); broadcast(payload); return payload;
  });
  electron.ipcMain.handle('discord-studio:publish-panel', async (_event, id) => {
    assertAccess('operator', 'Publish Discord server status panels');
    const result = await ensureService().refreshPanel(id);
    const payload = studioPayload(); broadcast(payload);
    return { result, state: payload };
  });
  electron.ipcMain.handle('discord-studio:refresh-panel', async (_event, id) => {
    assertAccess('operator', 'Refresh Discord server status panels');
    const result = await ensureService().refreshPanel(id);
    const payload = studioPayload(); broadcast(payload);
    return { result, state: payload };
  });
  electron.ipcMain.handle('discord-studio:refresh-all', async () => {
    assertAccess('operator', 'Refresh all Discord server status panels');
    const results = await ensureService().refreshAll();
    const payload = studioPayload(); broadcast(payload);
    return { results, state: payload };
  });
  electron.ipcMain.handle('discord-studio:delete-published-panel', async (_event, id) => {
    assertAccess('operator', 'Delete published Discord server status panels');
    const result = await ensureService().deletePublishedPanel(id);
    const payload = studioPayload(); broadcast(payload);
    return { result, state: payload };
  });
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosDiscordStudioUiPatched) return;
  const original = prototype.loadFile;
  prototype.loadFile = function patchedLoadFile(...args) {
    this.webContents.once('did-finish-load', () => {
      this.webContents.executeJavaScript(`(() => {
        if (!document.querySelector('link[href="discord-studio.css"]')) { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'discord-studio.css'; document.head.appendChild(link); }
        if (!document.querySelector('script[src="discord-studio.js"]')) { const script = document.createElement('script'); script.src = 'discord-studio.js'; script.defer = true; document.body.appendChild(script); }
      })();`).catch(() => {});
    });
    return original.apply(this, args);
  };
  Object.defineProperty(prototype, '__khaosDiscordStudioUiPatched', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  promoteCatalog();
  patchConfigStore();
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  patchBrowserLoader();
  electron.app.whenReady().then(() => {
    const wait = () => {
      if (refs.configStore && refs.logger) { ensureService(); registerIpc(); }
      else setTimeout(wait, 100);
    };
    wait();
  });
  electron.app.on('before-quit', () => refs.service?.stop?.());
}

module.exports = { install, refs, ensureConfig };
