'use strict';

const path = require('node:path');
const electron = require('electron');
const {
  normalizeConfig,
  normalizeProfile,
  publicProfile
} = require('../shared/palworld-update-automation.cjs');
const { PalworldUpdateCoordinator } = require('./services/palworld-update-coordinator.cjs');

const refs = { configStore: null, logger: null, autonomy: null, discordAuth: null, coordinator: null };
let installed = false;
let ipcInstalled = false;

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function ensureConfig(store) {
  const normalized = normalizeConfig(store.config.palworldUpdateAutomation || {});
  const changed = JSON.stringify(store.config.palworldUpdateAutomation || null) !== JSON.stringify(normalized);
  store.config.palworldUpdateAutomation = normalized;
  if (changed) store.saveConfig();
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosPalworldUpdatePatched) return;

  class PalworldUpdateConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      ensureConfig(this);
      ensureCoordinator();
    }

    getPalworldUpdateConfig() {
      ensureConfig(this);
      return clone(this.config.palworldUpdateAutomation);
    }

    getPalworldUpdatePublicConfig() {
      ensureConfig(this);
      return {
        schemaVersion: 1,
        profiles: this.config.palworldUpdateAutomation.profiles.map((profile) => publicProfile(profile, Boolean(this.secrets.palworldNitradoTokens?.[profile.id])))
      };
    }

    getPublicConfig() {
      const config = super.getPublicConfig();
      config.palworldUpdateAutomation = this.getPalworldUpdatePublicConfig();
      return config;
    }

    getSecretValues() {
      return [
        ...super.getSecretValues(),
        ...Object.values(this.secrets.palworldNitradoTokens || {})
      ].filter(Boolean);
    }

    upsertPalworldUpdateProfile(input = {}) {
      ensureConfig(this);
      const profile = normalizeProfile(input);
      const list = this.config.palworldUpdateAutomation.profiles;
      const index = list.findIndex((item) => item.id === profile.id);
      if (index >= 0) list[index] = profile;
      else list.push(profile);
      this.config.palworldUpdateAutomation = normalizeConfig(this.config.palworldUpdateAutomation);
      this.saveConfig();
      return clone(profile);
    }

    removePalworldUpdateProfile(id) {
      ensureConfig(this);
      this.config.palworldUpdateAutomation.profiles = this.config.palworldUpdateAutomation.profiles.filter((profile) => profile.id !== id);
      if (this.secrets.palworldNitradoTokens) delete this.secrets.palworldNitradoTokens[id];
      this.saveConfig();
      if (electron.safeStorage.isEncryptionAvailable()) this.saveSecrets();
      return this.getPalworldUpdatePublicConfig();
    }

    setPalworldNitradoToken(profileId, token) {
      ensureConfig(this);
      if (!this.config.palworldUpdateAutomation.profiles.some((profile) => profile.id === profileId)) throw new Error('Save the Palworld update profile before storing its Nitrado token.');
      const value = String(token || '').trim();
      this.secrets.palworldNitradoTokens ||= {};
      if (value) this.secrets.palworldNitradoTokens[profileId] = value;
      else delete this.secrets.palworldNitradoTokens[profileId];
      this.saveSecrets();
      return { profileId, hasToken: Boolean(value) };
    }

    getPalworldUpdateRuntime(profileId) {
      ensureConfig(this);
      const profile = this.config.palworldUpdateAutomation.profiles.find((item) => item.id === profileId);
      return profile ? {
        profile: clone(profile),
        token: this.secrets.palworldNitradoTokens?.[profileId] || ''
      } : null;
    }
  }

  Object.defineProperty(PalworldUpdateConfigStore, '__khaosPalworldUpdatePatched', { value: true });
  target.ConfigStore = PalworldUpdateConfigStore;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosPalworldUpdateCapture) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
      ensureCoordinator();
    }
  }
  Object.defineProperty(Captured, '__khaosPalworldUpdateCapture', { value: true });
  target[exportName] = Captured;
}

function patchDiscordChannelOverride() {
  const target = require('./services/autonomy-service.cjs');
  const prototype = target.AutonomyService?.prototype;
  if (!prototype || prototype.__khaosChannelOverridePatched) return;
  const original = prototype.notify;

  prototype.notify = async function palworldChannelAwareNotify(title, message, level = 'info', options = {}) {
    const channelId = String(options?.channelId || '').trim();
    if (!channelId) return original.call(this, title, message, level);
    if (!/^\d{5,25}$/.test(channelId)) throw new Error('Discord notification channel ID must be numeric.');
    const runtime = this.configStore.getRuntimeBootstrap();
    if (!runtime.discordToken) return { skipped: true, reason: 'missing-token' };
    if (typeof this.fetchImpl !== 'function') return { skipped: true, reason: 'network-unavailable' };
    const content = `**${String(title).slice(0, 150)}**\n${String(message).slice(0, 1700)}\n\nLevel: ${level}`;
    const response = await this.fetchImpl(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${runtime.discordToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Khaos-Nexus-Palworld-Updates'
      },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } })
    });
    if (!response.ok) throw new Error(`Discord notification failed with status ${response.status}.`);
    const sentAt = new Date(this.now()).toISOString();
    this.updateState({ lastNotificationAt: sentAt });
    return { sent: true, sentAt, channelId };
  };

  Object.defineProperty(prototype, '__khaosChannelOverridePatched', { value: true });
}

function patchSharedScheduler() {
  const target = require('./services/server-scheduler-service.cjs');
  const prototype = target.ServerSchedulerService?.prototype;
  if (!prototype || prototype.__khaosPalworldUpdateTickPatched) return;
  const original = prototype.tick;
  prototype.tick = async function palworldUpdateSharedTick(...args) {
    const result = await original.apply(this, args);
    try { await ensureCoordinator()?.tick?.(); }
    catch (error) { refs.logger?.warn?.('Palworld update coordinator shared-scheduler tick failed.', { message: error.message }); }
    return result;
  };
  Object.defineProperty(prototype, '__khaosPalworldUpdateTickPatched', { value: true });
}

function accessRole() {
  try { return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'local-admin'; }
  catch { return 'local-admin'; }
}

function assertAccess(minimumRole, action) {
  if (refs.autonomy?.assertAccess) return refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), minimumRole, action);
  const rank = { locked: 0, viewer: 1, operator: 2, owner: 3, 'local-admin': 4 };
  if ((rank[accessRole()] || 0) < (rank[minimumRole] || 0)) throw new Error(`${action} requires ${minimumRole} access.`);
  return true;
}

function ensureCoordinator() {
  if (refs.coordinator || !refs.configStore || !refs.logger || !refs.autonomy) return refs.coordinator;
  refs.coordinator = new PalworldUpdateCoordinator({
    dataDirectory: path.dirname(refs.configStore.configPath),
    configStore: refs.configStore,
    autonomy: refs.autonomy,
    logger: refs.logger
  });
  refs.coordinator.on('state', broadcast);
  setImmediate(registerIpc);
  return refs.coordinator;
}

function payload() {
  const state = ensureCoordinator()?.getState?.() || { config: { schemaVersion: 1, profiles: [] }, profiles: {}, steamAppId: 2394010 };
  const publicConfig = refs.configStore?.getPublicConfig?.() || {};
  return {
    role: accessRole(),
    servers: (publicConfig.servers || []).filter((server) => String(server.game || '').toLowerCase() === 'palworld').map((server) => ({
      id: server.id,
      name: server.name,
      enabled: server.enabled !== false,
      connectionType: server.connectionType || 'rest',
      hasPassword: Boolean(server.hasPassword)
    })),
    ...state
  };
}

function broadcast() {
  if (!refs.coordinator) return;
  const state = payload();
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('palworld-updates:update', state);
  }
}

function audit(action, outcome, target, summary) {
  const auth = refs.discordAuth?.getState?.() || {};
  refs.configStore?.appendDiscordAudit?.({
    category: 'palworld-updates',
    action,
    outcome,
    targetType: 'palworld-update-profile',
    targetId: target?.id || '',
    targetName: target?.name || '',
    summary: String(summary || '').slice(0, 500),
    actorId: auth.user?.id || '',
    actorName: auth.user?.globalName || auth.user?.username || 'Local operator',
    actorRole: accessRole(),
    time: new Date().toISOString()
  });
}

function registerIpc() {
  if (ipcInstalled || !refs.coordinator) return;
  ipcInstalled = true;

  electron.ipcMain.handle('palworld-updates:get', () => {
    assertAccess('viewer', 'View Palworld update automation');
    return payload();
  });

  electron.ipcMain.handle('palworld-updates:save-profile', (_event, input = {}) => {
    assertAccess('owner', 'Configure Palworld update automation');
    const profile = refs.configStore.upsertPalworldUpdateProfile(input);
    audit('palworld-updates.profile-saved', 'success', profile, `Saved Nitrado update policy; automatic apply ${profile.autoApply ? 'enabled' : 'disabled'}.`);
    broadcast();
    return payload();
  });

  electron.ipcMain.handle('palworld-updates:set-token', (_event, input = {}) => {
    assertAccess('owner', 'Change Nitrado credentials');
    const result = refs.configStore.setPalworldNitradoToken(input.profileId, input.token);
    audit('palworld-updates.token', 'success', { id: input.profileId, name: 'Palworld update profile' }, result.hasToken ? 'Encrypted Nitrado API token saved.' : 'Nitrado API token removed.');
    broadcast();
    return payload();
  });

  electron.ipcMain.handle('palworld-updates:remove-profile', (_event, id) => {
    assertAccess('owner', 'Remove Palworld update automation');
    const profile = refs.configStore.getPalworldUpdateConfig().profiles.find((item) => item.id === id);
    if (!profile) throw new Error('The selected Palworld update profile was not found.');
    refs.configStore.removePalworldUpdateProfile(id);
    audit('palworld-updates.profile-removed', 'success', profile, 'Removed the Palworld update profile and encrypted Nitrado token.');
    broadcast();
    return payload();
  });

  electron.ipcMain.handle('palworld-updates:test-nitrado', async (_event, id) => {
    assertAccess('owner', 'Test Nitrado server control');
    try {
      const result = await refs.coordinator.testNitrado(id);
      const profile = refs.configStore.getPalworldUpdateConfig().profiles.find((item) => item.id === id);
      audit('palworld-updates.nitrado-test', 'success', profile, `Nitrado status: ${result.status.status}${result.status.version ? `; version ${result.status.version}` : ''}.`);
      return { ...result, state: payload() };
    } catch (error) {
      audit('palworld-updates.nitrado-test', 'failed', { id, name: 'Palworld update profile' }, error.message);
      throw error;
    }
  });

  electron.ipcMain.handle('palworld-updates:check-now', async (_event, id) => {
    assertAccess('operator', 'Check for Palworld server updates');
    const result = await refs.coordinator.checkNow(id);
    return { ...result, state: payload() };
  });

  electron.ipcMain.handle('palworld-updates:start-workflow', async (_event, id) => {
    assertAccess('owner', 'Start Palworld update maintenance');
    const profile = refs.configStore.getPalworldUpdateConfig().profiles.find((item) => item.id === id);
    const result = await refs.coordinator.startCountdown(id, { source: 'manual' });
    audit('palworld-updates.workflow-started', 'success', profile, 'Guarded Palworld update countdown started.');
    return { result, state: payload() };
  });

  electron.ipcMain.handle('palworld-updates:cancel', async (_event, id) => {
    assertAccess('operator', 'Cancel Palworld update countdown');
    const profile = refs.configStore.getPalworldUpdateConfig().profiles.find((item) => item.id === id);
    const result = await refs.coordinator.cancel(id);
    audit('palworld-updates.workflow-cancelled', 'success', profile, 'Palworld update workflow cancelled before the destructive stage.');
    return { result, state: payload() };
  });

  electron.ipcMain.handle('palworld-updates:restart-now', async (_event, id) => {
    assertAccess('owner', 'Restart the Nitrado Palworld server');
    const profile = refs.configStore.getPalworldUpdateConfig().profiles.find((item) => item.id === id);
    const result = await refs.coordinator.manualRestart(id);
    audit('palworld-updates.manual-restart', 'success', profile, 'Immediate Nitrado restart requested through Nexus Core.');
    return { ...result, state: payload() };
  });
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosPalworldUpdatesUiPatched) return;
  const original = prototype.loadFile;
  prototype.loadFile = function patchedLoadFile(...args) {
    this.webContents.once('did-finish-load', () => {
      if (this.isDestroyed() || this.webContents.isDestroyed()) return;
      this.webContents.executeJavaScript(`(() => {
        if (!document.querySelector('link[href="palworld-update-automation.css"]')) {
          const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'palworld-update-automation.css'; document.head.appendChild(link);
        }
        if (!document.querySelector('script[src="palworld-update-automation.js"]')) {
          const script = document.createElement('script'); script.src = 'palworld-update-automation.js'; script.defer = true; document.body.appendChild(script);
        }
      })();`).catch((error) => refs.logger?.warn?.('Palworld update renderer bootstrap failed.', { message: error.message }));
    });
    return original.apply(this, args);
  };
  Object.defineProperty(prototype, '__khaosPalworldUpdatesUiPatched', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  patchDiscordChannelOverride();
  patchSharedScheduler();
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  patchBrowserLoader();
  electron.app.whenReady().then(() => {
    const wait = () => {
      if (refs.configStore && refs.logger && refs.autonomy) {
        ensureCoordinator();
        registerIpc();
      } else setTimeout(wait, 100);
    };
    wait();
  }).catch((error) => console.error('[Khaos Nexus] Palworld update automation initialization failed.', error));
}

module.exports = {
  install,
  refs,
  ensureConfig,
  ensureCoordinator,
  patchSharedScheduler,
  patchDiscordChannelOverride
};
