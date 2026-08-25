'use strict';

const electron = require('electron');
const {
  normalizeDiscordHubConfig,
  normalizeHub
} = require('../shared/discord-hub-artwork.cjs');
const { DiscordHubService } = require('./services/discord-hub-service.cjs');

const refs = { configStore: null, logger: null, autonomy: null, discordAuth: null, service: null };
let installed = false;

function ensureConfig(store) {
  const current = store.config.discordHubs;
  const normalized = normalizeDiscordHubConfig(current || {});
  const changed = JSON.stringify(current || null) !== JSON.stringify(normalized);
  store.config.discordHubs = normalized;
  if (changed) store.saveConfig();
}
function ensureService() {
  if (!refs.service && refs.configStore && refs.logger) refs.service = new DiscordHubService({ configStore: refs.configStore, logger: refs.logger });
  return refs.service;
}
function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDiscordHubPatched) return;
  class DiscordHubConfigStore extends Original {
    constructor(...args) { super(...args); refs.configStore = this; ensureConfig(this); ensureService(); }
    getDiscordHubs() { ensureConfig(this); return JSON.parse(JSON.stringify(this.config.discordHubs)); }
    upsertDiscordHub(input) {
      ensureConfig(this);
      const hub = normalizeHub(input);
      const list = this.config.discordHubs.hubs;
      const index = list.findIndex((item) => item.id === hub.id);
      if (index >= 0) list[index] = hub; else list.push(hub);
      this.config.discordHubs = normalizeDiscordHubConfig(this.config.discordHubs);
      this.saveConfig();
      return hub;
    }
    setDiscordHubPublication(id, patch = {}) {
      ensureConfig(this);
      const index = this.config.discordHubs.hubs.findIndex((item) => item.id === id);
      if (index < 0) throw new Error('The selected Nexus hub was not found.');
      this.config.discordHubs.hubs[index] = normalizeHub({ ...this.config.discordHubs.hubs[index], ...patch, id });
      this.saveConfig();
      return this.config.discordHubs.hubs[index];
    }
    removeDiscordHub(id) {
      ensureConfig(this);
      this.config.discordHubs.hubs = this.config.discordHubs.hubs.filter((item) => item.id !== id);
      this.saveConfig();
      return this.getDiscordHubs();
    }
  }
  Object.defineProperty(DiscordHubConfigStore, '__khaosDiscordHubPatched', { value: true });
  target.ConfigStore = DiscordHubConfigStore;
}
function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosDiscordHubCapturePatched) return;
  class Captured extends Original {
    constructor(...args) { super(...args); refs[refName] = this; ensureService(); }
  }
  Object.defineProperty(Captured, '__khaosDiscordHubCapturePatched', { value: true });
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
function audit(action, outcome, hub, summary) {
  try {
    const auth = refs.discordAuth?.getState?.() || {};
    const entry = refs.configStore?.appendDiscordAudit?.({
      time: new Date().toISOString(),
      category: 'discord-hubs',
      action,
      outcome,
      actorId: String(auth.user?.id || ''),
      actorName: String(auth.user?.globalName || auth.user?.username || 'Local operator'),
      actorRole: activeRole(),
      targetType: 'discord-hub',
      targetId: hub?.id || '',
      targetName: hub?.name || hub?.id || 'Nexus hub',
      summary
    });
    refs.logger?.write?.(outcome === 'failed' ? 'error' : 'info', `Discord hub: ${action}`, { hubId: hub?.id, summary, auditId: entry?.id }, 'discord-hubs');
  } catch {}
}
function payload() {
  const publicConfig = refs.configStore.getPublicConfig();
  const manifest = ensureService().manifest();
  return {
    role: activeRole(),
    guildId: publicConfig.discord?.guildId || '',
    botConfigured: Boolean(publicConfig.hasDiscordToken),
    hubs: refs.configStore.getDiscordHubs(),
    manifest: {
      schemaVersion: manifest.schemaVersion,
      updatedAt: manifest.updatedAt,
      storage: manifest.storage,
      hubAssignments: manifest.hubAssignments,
      banners: manifest.banners
    }
  };
}
function broadcast() {
  const state = payload();
  for (const window of electron.BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('discord-hubs:update', state);
}
function hubById(id) { return refs.configStore.getDiscordHubs().hubs.find((item) => item.id === id); }
function registerIpc() {
  if (registerIpc.done || !refs.configStore) return;
  registerIpc.done = true;
  electron.ipcMain.handle('discord-hubs:get', () => { assertAccess('viewer', 'View Nexus hubs'); return payload(); });
  electron.ipcMain.handle('discord-hubs:resources', (_event, guildId) => { assertAccess('operator', 'Load Nexus hub channels'); return ensureService().resources(guildId); });
  electron.ipcMain.handle('discord-hubs:save', (_event, input) => {
    assertAccess('operator', 'Save Nexus hubs');
    const hub = refs.configStore.upsertDiscordHub(input);
    audit('hub.saved', 'success', hub, `Saved hub using manifest banner assignment “${hub.bannerKey || hub.id}”.`);
    broadcast();
    return payload();
  });
  electron.ipcMain.handle('discord-hubs:remove', (_event, id) => {
    assertAccess('operator', 'Remove Nexus hubs');
    const hub = hubById(id);
    if (!hub) throw new Error('The selected Nexus hub was not found.');
    if (hub.messageId) throw new Error('Delete the published Nexus hub message before removing its configuration.');
    refs.configStore.removeDiscordHub(id);
    audit('hub.removed', 'success', hub, 'Removed Nexus hub configuration.');
    broadcast();
    return payload();
  });
  electron.ipcMain.handle('discord-hubs:publish', async (_event, id) => {
    assertAccess('operator', 'Publish Nexus hubs');
    const hub = hubById(id);
    if (!hub) throw new Error('The selected Nexus hub was not found.');
    try {
      const result = await ensureService().publish(hub);
      refs.configStore.setDiscordHubPublication(id, {
        guildId: result.guildId,
        channelId: result.channelId,
        messageId: result.messageId,
        publishedAt: result.publishedAt,
        refreshedAt: result.refreshedAt
      });
      audit('hub.published', 'success', hub, `${result.replaced ? 'Published/rebuilt' : 'Refreshed'} persistent hub embed with banner ${result.banner.key || 'none'} (${result.banner.mode}).`);
      broadcast();
      return { result, state: payload() };
    } catch (error) { audit('hub.published', 'failed', hub, error.message); throw error; }
  });
  electron.ipcMain.handle('discord-hubs:refresh', async (_event, id) => {
    assertAccess('operator', 'Refresh Nexus hubs');
    const hub = hubById(id);
    if (!hub) throw new Error('The selected Nexus hub was not found.');
    try {
      const result = await ensureService().publish(hub);
      refs.configStore.setDiscordHubPublication(id, {
        messageId: result.messageId,
        publishedAt: result.publishedAt,
        refreshedAt: result.refreshedAt
      });
      audit('hub.refreshed', 'success', hub, `Refreshed hub and re-resolved banner ${result.banner.key || 'none'} (${result.banner.mode}).`);
      broadcast();
      return { result, state: payload() };
    } catch (error) { audit('hub.refreshed', 'failed', hub, error.message); throw error; }
  });
  electron.ipcMain.handle('discord-hubs:refresh-all', async () => {
    assertAccess('operator', 'Refresh all Nexus hubs');
    const results = [];
    for (const hub of refs.configStore.getDiscordHubs().hubs.filter((item) => item.enabled && item.channelId)) {
      try {
        const result = await ensureService().publish(hub);
        refs.configStore.setDiscordHubPublication(hub.id, { messageId: result.messageId, publishedAt: result.publishedAt, refreshedAt: result.refreshedAt });
        results.push({ id: hub.id, ok: true, banner: result.banner.key, mode: result.banner.mode, replaced: result.replaced });
      } catch (error) { results.push({ id: hub.id, ok: false, error: error.message }); }
    }
    broadcast();
    return { results, state: payload() };
  });
  electron.ipcMain.handle('discord-hubs:unpublish', async (_event, id) => {
    assertAccess('operator', 'Delete published Nexus hubs');
    const hub = hubById(id);
    if (!hub) throw new Error('The selected Nexus hub was not found.');
    await ensureService().removePublished(hub);
    refs.configStore.setDiscordHubPublication(id, { messageId: '', publishedAt: null, refreshedAt: null });
    audit('hub.unpublished', 'success', hub, 'Deleted the persistent Nexus hub message.');
    broadcast();
    return payload();
  });
}
function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  electron.app.whenReady().then(() => {
    const wait = () => {
      if (refs.configStore && refs.logger) { ensureService(); registerIpc(); }
      else setTimeout(wait, 100);
    };
    wait();
  });
}

module.exports = { install, refs, ensureConfig };
