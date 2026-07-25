'use strict';

const path = require('node:path');
const electron = require('electron');
const {
  normalizeProvider,
  normalizeHostedControlConfig,
  normalizePowerSignal
} = require('../shared/hosted-server-control.cjs');
const { HostedServerService } = require('./services/hosted-server-service.cjs');

const refs = { configStore: null, logger: null, autonomy: null, discordAuth: null, service: null };
let installed = false;
let ipcInstalled = false;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function promoteCatalog() {
  try {
    const { MODULE_CATALOG, MIGRATION_STEPS } = require('../shared/module-catalog.cjs');
    const module = MODULE_CATALOG.find((item) => item.id === 'pterodactyl-control');
    if (module) Object.assign(module, {
      name: 'Hosted Server Control',
      stage: 'live',
      launchView: 'hosted-servers',
      description: 'Secure Pterodactyl Client API integration for provider-backed server discovery, resources and guarded power controls.',
      features: ['Encrypted provider credentials', 'Server discovery', 'Live CPU, memory, disk and uptime', 'Start, restart and stop', 'Owner-only emergency kill', 'Provider action history']
    });
    return MIGRATION_STEPS?.map((step) => step.id) || [];
  } catch {
    return [];
  }
}

function ensureConfig(store) {
  const normalized = normalizeHostedControlConfig(store.config.hostedControl || {});
  const changed = JSON.stringify(store.config.hostedControl || null) !== JSON.stringify(normalized);
  store.config.hostedControl = normalized;
  const migration = store.config.general?.moduleMigration?.['pterodactyl-control'];
  const steps = promoteCatalog();
  if (migration && steps.length) {
    migration.enabled = true;
    migration.completedSteps = steps;
    migration.updatedAt = new Date().toISOString();
  }
  if (changed) store.saveConfig();
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosHostedControlPatched) return;

  class HostedControlConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      ensureConfig(this);
      ensureService();
    }

    getHostedControlConfig() {
      ensureConfig(this);
      return clone(this.config.hostedControl);
    }

    getHostedControlPublicConfig() {
      ensureConfig(this);
      return {
        ...clone(this.config.hostedControl),
        providers: this.config.hostedControl.providers.map((provider) => ({
          ...clone(provider),
          hasToken: Boolean(this.secrets.hostedProviderTokens?.[provider.id])
        }))
      };
    }

    getPublicConfig() {
      const config = super.getPublicConfig();
      config.hostedControl = this.getHostedControlPublicConfig();
      return config;
    }

    getSecretValues() {
      return [
        ...super.getSecretValues(),
        ...Object.values(this.secrets.hostedProviderTokens || {})
      ].filter(Boolean);
    }

    upsertHostedProvider(input) {
      ensureConfig(this);
      const provider = normalizeProvider(input);
      const providers = this.config.hostedControl.providers;
      const index = providers.findIndex((item) => item.id === provider.id);
      if (index >= 0) providers[index] = provider;
      else providers.push(provider);
      this.config.hostedControl = normalizeHostedControlConfig(this.config.hostedControl);
      this.saveConfig();
      return clone(provider);
    }

    patchHostedProvider(id, patch = {}) {
      ensureConfig(this);
      const index = this.config.hostedControl.providers.findIndex((item) => item.id === id);
      if (index < 0) throw new Error('The selected hosted provider was not found.');
      const provider = normalizeProvider({ ...this.config.hostedControl.providers[index], ...patch, id });
      this.config.hostedControl.providers[index] = provider;
      this.saveConfig();
      return clone(provider);
    }

    removeHostedProvider(id) {
      ensureConfig(this);
      this.config.hostedControl.providers = this.config.hostedControl.providers.filter((provider) => provider.id !== id);
      if (this.secrets.hostedProviderTokens) delete this.secrets.hostedProviderTokens[id];
      this.saveConfig();
      if (electron.safeStorage.isEncryptionAvailable()) this.saveSecrets();
      return this.getHostedControlPublicConfig();
    }

    setHostedProviderToken(id, token) {
      ensureConfig(this);
      if (!this.config.hostedControl.providers.some((provider) => provider.id === id)) throw new Error('Save the hosted provider before storing its API key.');
      const value = String(token || '').trim();
      this.secrets.hostedProviderTokens ||= {};
      if (value) this.secrets.hostedProviderTokens[id] = value;
      else delete this.secrets.hostedProviderTokens[id];
      this.saveSecrets();
      return { providerId: id, hasToken: Boolean(value) };
    }

    hasHostedProviderToken(id) {
      return Boolean(this.secrets.hostedProviderTokens?.[id]);
    }

    getHostedProviderRuntime(id) {
      ensureConfig(this);
      const provider = this.config.hostedControl.providers.find((item) => item.id === id);
      return provider ? { provider: clone(provider), token: this.secrets.hostedProviderTokens?.[id] || '' } : null;
    }

    setHostedControlSettings(input = {}) {
      ensureConfig(this);
      this.config.hostedControl = normalizeHostedControlConfig({
        ...this.config.hostedControl,
        settings: { ...this.config.hostedControl.settings, ...input }
      });
      this.saveConfig();
      return this.getHostedControlPublicConfig();
    }
  }

  Object.defineProperty(HostedControlConfigStore, '__khaosHostedControlPatched', { value: true });
  target.ConfigStore = HostedControlConfigStore;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosHostedControlCapturePatched) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
      ensureService();
    }
  }
  Object.defineProperty(Captured, '__khaosHostedControlCapturePatched', { value: true });
  target[exportName] = Captured;
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

function actor() {
  const auth = refs.discordAuth?.getState?.() || {};
  return {
    id: auth.user?.id || '',
    name: auth.user?.globalName || auth.user?.username || 'Local operator',
    role: accessRole()
  };
}

function ensureService() {
  if (refs.service || !refs.configStore || !refs.logger) return refs.service;
  refs.service = new HostedServerService({
    dataDirectory: path.dirname(refs.configStore.configPath),
    configStore: refs.configStore,
    logger: refs.logger
  });
  refs.service.on('state', broadcast);
  setImmediate(registerIpc);
  return refs.service;
}

function payload() {
  return {
    role: accessRole(),
    ...(ensureService()?.getState?.() || {
      config: normalizeHostedControlConfig({}),
      snapshot: { refreshedAt: null, providers: [], servers: [], errors: [] },
      history: []
    })
  };
}

function broadcast() {
  if (!refs.configStore || !refs.service) return;
  const state = payload();
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('hosted-server:update', state);
  }
}

function audit(action, outcome, target, summary) {
  const currentActor = actor();
  refs.configStore?.appendDiscordAudit?.({
    category: 'hosted-server-control',
    action,
    outcome,
    targetType: target?.serverName ? 'hosted-server' : 'hosted-provider',
    targetId: target?.providerId || target?.id || '',
    targetName: target?.serverName || target?.name || '',
    summary: String(summary || '').slice(0, 500),
    actorId: currentActor.id,
    actorName: currentActor.name,
    actorRole: currentActor.role,
    time: new Date().toISOString()
  });
}

function registerIpc() {
  if (ipcInstalled || !refs.service) return;
  ipcInstalled = true;

  electron.ipcMain.handle('hosted-server:get', () => {
    assertAccess('viewer', 'View hosted servers');
    return payload();
  });

  electron.ipcMain.handle('hosted-server:save-provider', (_event, input) => {
    assertAccess('owner', 'Create or change hosted providers');
    const provider = refs.configStore.upsertHostedProvider(input || {});
    audit('hosted-provider.saved', 'success', provider, `Saved ${provider.type} provider ${provider.name}.`);
    broadcast();
    return payload();
  });

  electron.ipcMain.handle('hosted-server:set-token', (_event, input) => {
    assertAccess('owner', 'Change hosted-provider credentials');
    const result = refs.configStore.setHostedProviderToken(input?.providerId, input?.token);
    audit('hosted-provider.token', 'success', { id: input?.providerId, name: 'Hosted provider' }, result.hasToken ? 'Encrypted Client API key saved.' : 'Client API key removed.');
    broadcast();
    return payload();
  });

  electron.ipcMain.handle('hosted-server:remove-provider', (_event, id) => {
    assertAccess('owner', 'Remove hosted providers');
    const provider = refs.configStore.getHostedControlConfig().providers.find((item) => item.id === id);
    if (!provider) throw new Error('The selected hosted provider was not found.');
    refs.configStore.removeHostedProvider(id);
    audit('hosted-provider.removed', 'success', provider, 'Hosted provider and encrypted API key removed.');
    broadcast();
    return payload();
  });

  electron.ipcMain.handle('hosted-server:settings', (_event, input) => {
    assertAccess('owner', 'Change hosted-server settings');
    refs.configStore.setHostedControlSettings(input || {});
    audit('hosted-server.settings', 'success', null, 'Hosted server control settings updated.');
    broadcast();
    return payload();
  });

  electron.ipcMain.handle('hosted-server:test-provider', async (_event, id) => {
    assertAccess('owner', 'Test hosted-provider connections');
    try {
      const result = await refs.service.testProvider(id);
      const provider = refs.configStore.getHostedControlConfig().providers.find((item) => item.id === id);
      audit('hosted-provider.test', 'success', provider, `Connected and discovered ${result.serverCount} server(s).`);
      broadcast();
      return { result, state: payload() };
    } catch (error) {
      const provider = refs.configStore.getHostedControlConfig().providers.find((item) => item.id === id);
      if (provider) refs.configStore.patchHostedProvider(id, { lastError: error.message });
      audit('hosted-provider.test', 'failed', provider, error.message);
      broadcast();
      throw error;
    }
  });

  electron.ipcMain.handle('hosted-server:refresh', async (_event, providerIds) => {
    assertAccess('viewer', 'Refresh hosted servers');
    await refs.service.refresh(Array.isArray(providerIds) ? providerIds : undefined);
    return payload();
  });

  electron.ipcMain.handle('hosted-server:power', async (_event, input) => {
    const signal = normalizePowerSignal(input?.signal);
    assertAccess(signal === 'kill' ? 'owner' : 'operator', `${signal} hosted servers`);
    try {
      const result = await refs.service.power({ token: input?.token, signal, actor: actor() });
      audit(`hosted-server.${signal}`, 'success', result, `${signal} signal accepted for ${result.serverName}.`);
      return { result, state: payload() };
    } catch (error) {
      audit(`hosted-server.${signal}`, 'failed', { serverName: input?.serverName || '' }, error.message);
      throw error;
    }
  });

  electron.ipcMain.handle('hosted-server:clear-history', () => {
    assertAccess('owner', 'Clear hosted-server history');
    refs.service.clearHistory();
    audit('hosted-server.history-cleared', 'success', null, 'Hosted server action history cleared.');
    return payload();
  });
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosHostedServerUiPatched) return;
  const original = prototype.loadFile;
  prototype.loadFile = function patchedLoadFile(...args) {
    this.webContents.once('did-finish-load', () => {
      if (this.isDestroyed() || this.webContents.isDestroyed()) return;
      this.webContents.executeJavaScript(`(() => {
        if (!document.querySelector('link[href="hosted-server.css"]')) {
          const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'hosted-server.css'; document.head.appendChild(link);
        }
        if (!document.querySelector('script[src="hosted-server.js"]')) {
          const script = document.createElement('script'); script.src = 'hosted-server.js'; script.defer = true; document.body.appendChild(script);
        }
      })();`).catch((error) => refs.logger?.warn?.('Hosted server renderer bootstrap failed.', { message: error.message }));
    });
    return original.apply(this, args);
  };
  Object.defineProperty(prototype, '__khaosHostedServerUiPatched', { value: true });
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
      if (refs.configStore && refs.logger) {
        ensureService();
        registerIpc();
      } else setTimeout(wait, 100);
    };
    wait();
  }).catch((error) => console.error('[Khaos Nexus] Hosted server control initialization failed.', error));
}

module.exports = { install, refs, ensureConfig, promoteCatalog };
