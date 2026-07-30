'use strict';

const crypto = require('node:crypto');
const electron = require('electron');
const { ServerConnection } = require('../bot/server-client.cjs');
const { createCurrentServerAdapter } = require('../bot/game-adapters/current-server-adapter.cjs');
const { executeAdapterOperation } = require('../shared/game-adapter-sdk.cjs');
const { SatisfactoryApiClient, normalizeHost, normalizePort, normalizeFingerprint, formatFingerprint } = require('../bot/satisfactory-api.cjs');

const refs = { configStore: null, autonomy: null, discordAuth: null, logger: null };
let installed = false;

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosSatisfactoryCaptured) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
    }
  }
  Object.defineProperty(Captured, '__khaosSatisfactoryCaptured', { value: true });
  target[exportName] = Captured;
}

function normalizeSatisfactoryServer(server = {}) {
  const id = String(server.id || crypto.randomUUID());
  const name = String(server.name || '').trim();
  const host = normalizeHost(server.host);
  const port = normalizePort(server.port);
  if (!name) throw new Error('A Satisfactory server name is required.');
  return {
    id,
    name,
    game: 'satisfactory',
    host,
    port,
    enabled: server.enabled !== false,
    connectionType: 'https-api',
    protocol: 'https',
    tlsFingerprint: normalizeFingerprint(server.tlsFingerprint),
    statusCommand: 'status',
    playersCommand: 'players',
    saveCommand: 'save',
    broadcastCommand: '',
    kickCommand: '',
    banCommand: ''
  };
}

function satisfactoryModuleEnabledFromRuntime(runtime) {
  const state = runtime?.config?.moduleRuntime?.['satisfactory-server-operations'];
  return state ? Boolean(state.effectiveEnabled) : true;
}

function satisfactoryModuleEnabled(configStore) {
  return satisfactoryModuleEnabledFromRuntime(configStore?.getRuntimeBootstrap?.());
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosSatisfactoryPatched) return;

  class SatisfactoryConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      let changed = false;
      for (const server of this.config?.servers || []) {
        if (String(server.game || '').toLowerCase() !== 'satisfactory') continue;
        if (server.connectionType !== 'https-api') { server.connectionType = 'https-api'; changed = true; }
        if (server.protocol !== 'https') { server.protocol = 'https'; changed = true; }
        const fingerprint = normalizeFingerprint(server.tlsFingerprint);
        if (server.tlsFingerprint !== fingerprint) { server.tlsFingerprint = fingerprint; changed = true; }
      }
      if (changed) this.saveConfig();
    }

    upsertServer(server, password) {
      if (String(server?.game || '').toLowerCase() !== 'satisfactory') return super.upsertServer(server, password);
      const normalized = normalizeSatisfactoryServer(server);
      const index = this.config.servers.findIndex((item) => item.id === normalized.id);
      if (index >= 0) this.config.servers[index] = normalized;
      else this.config.servers.push(normalized);
      if (password) {
        this.secrets.serverPasswords ||= {};
        this.secrets.serverPasswords[normalized.id] = String(password).trim();
        this.saveSecrets();
      }
      this.saveConfig();
      return normalized.id;
    }

    trustSatisfactoryCertificate(id, fingerprint) {
      const server = this.config.servers.find((item) => String(item.id) === String(id));
      if (!server || String(server.game || '').toLowerCase() !== 'satisfactory') throw new Error('The selected Satisfactory server was not found.');
      server.tlsFingerprint = normalizeFingerprint(fingerprint);
      this.saveConfig();
      return formatFingerprint(server.tlsFingerprint);
    }
  }

  Object.defineProperty(SatisfactoryConfigStore, '__khaosSatisfactoryPatched', { value: true });
  target.ConfigStore = SatisfactoryConfigStore;
}

function patchAutonomyService() {
  const target = require('./services/autonomy-service.cjs');
  const Original = target.AutonomyService;
  if (!Original || Original.__khaosSatisfactoryPatched) return;
  class SatisfactoryAutonomyService extends Original {
    constructor(...args) {
      super(...args);
      refs.autonomy = this;
      const originalFactory = this.rconFactory;
      this.rconFactory = (server) => String(server?.game || '').toLowerCase() === 'satisfactory'
        ? new ServerConnection(server)
        : originalFactory(server);
    }
  }
  Object.defineProperty(SatisfactoryAutonomyService, '__khaosSatisfactoryPatched', { value: true });
  target.AutonomyService = SatisfactoryAutonomyService;
}

function patchSchedulerService() {
  const target = require('./services/server-scheduler-service.cjs');
  const prototype = target.ServerSchedulerService?.prototype;
  if (!prototype || prototype.__khaosSatisfactoryPatched) return;
  const originalRuntimeServers = prototype.runtimeServers;
  prototype.runtimeServers = function satisfactoryAwareRuntimeServers(schedule) {
    return originalRuntimeServers.call(this, schedule).filter((server) => {
      if (String(server.game || '').toLowerCase() !== 'satisfactory') return true;
      return satisfactoryModuleEnabled(this.configStore);
    });
  };
  Object.defineProperty(prototype, '__khaosSatisfactoryPatched', { value: true });
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosSatisfactoryUiPatched) return;
  const original = prototype.loadFile;
  prototype.loadFile = function patchedSatisfactoryLoadFile(...args) {
    this.webContents.once('did-finish-load', () => {
      this.webContents.executeJavaScript(`(() => {
        if (!document.querySelector('script[src="satisfactory-api-ui.js"]')) {
          const script = document.createElement('script');
          script.src = 'satisfactory-api-ui.js';
          script.defer = true;
          document.body.appendChild(script);
        }
      })();`).catch(() => {});
    });
    return original.apply(this, args);
  };
  Object.defineProperty(prototype, '__khaosSatisfactoryUiPatched', { value: true });
}

function requireAccess(role, action) {
  if (!refs.autonomy) throw new Error('Desktop access control is still initializing.');
  return refs.autonomy.assertAccess(refs.discordAuth?.getState(), role, action);
}

function runtimeServer(id, { requireToken = true } = {}) {
  const runtime = refs.configStore?.getRuntimeBootstrap();
  const server = runtime?.config?.servers?.find((item) => String(item.id) === String(id));
  if (!server || server.enabled === false) throw new Error('The selected Satisfactory server is not configured or enabled.');
  if (String(server.game || '').toLowerCase() !== 'satisfactory') throw new Error('This action requires a Satisfactory server.');
  if (requireToken && !server.password) throw new Error('Save the protected Satisfactory application token before using server operations.');
  const moduleState = runtime?.config?.moduleRuntime?.['satisfactory-server-operations'];
  if (moduleState && !moduleState.effectiveEnabled) throw new Error('Satisfactory Server Operations are disabled or blocked by a module dependency.');
  return server;
}

function actorRole() {
  return refs.autonomy?.accessState(refs.discordAuth?.getState())?.role || 'local-admin';
}

async function executeSatisfactory(server, action, payload = {}) {
  const adapter = createCurrentServerAdapter(server, { logger: refs.logger });
  return executeAdapterOperation(adapter, action, payload, {
    role: actorRole(),
    explicitSecrets: [server.password]
  });
}

function registerIpc() {
  if (!refs.configStore || !refs.autonomy) {
    setTimeout(registerIpc, 100);
    return;
  }
  if (registerIpc.done) return;
  registerIpc.done = true;

  electron.ipcMain.handle('server:satisfactory-trust-certificate', async (_event, request = {}) => {
    requireAccess('owner', 'Trust a Satisfactory TLS certificate');
    const server = runtimeServer(request.id, { requireToken: false });
    const certificate = await new SatisfactoryApiClient(server).probeCertificate();
    const fingerprint = refs.configStore.trustSatisfactoryCertificate(server.id, certificate.fingerprint);
    refs.logger?.warn('Satisfactory TLS certificate trusted by the local owner.', { server: server.name, fingerprint });
    return { server: server.name, fingerprint, authorized: certificate.authorized, authorizationError: certificate.authorizationError };
  });

  electron.ipcMain.handle('server:satisfactory-action', async (_event, request = {}) => {
    const action = String(request.action || '').toLowerCase();
    const roleByAction = {
      status: 'viewer', health: 'viewer', info: 'viewer', players: 'viewer', settings: 'viewer', backup: 'operator',
      save: 'operator', shutdown: 'owner', stop: 'owner', raw: 'owner'
    };
    const role = roleByAction[action];
    if (!role) throw new Error(`Unsupported Satisfactory action: ${action}`);
    requireAccess(role, `Satisfactory ${action}`);
    const server = runtimeServer(request.id);
    const payload = { ...(request.payload || {}) };
    if (['shutdown', 'stop'].includes(action) && String(payload.confirmation || '') !== server.name) {
      throw new Error(`Type the exact server name “${server.name}” to confirm shutdown.`);
    }
    if (action === 'raw' && String(payload.confirmation || '').trim().toUpperCase() !== 'RUN RAW COMMAND') {
      throw new Error('Type RUN RAW COMMAND to confirm an unrestricted Owner console command.');
    }
    const result = await executeSatisfactory(server, action, payload);
    refs.logger?.info('Satisfactory API action completed.', { server: server.name, action, requestId: result.requestId, durationMs: result.durationMs });
    return { action, server: server.name, result };
  });
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  patchAutonomyService();
  patchSchedulerService();
  patchBrowserLoader();
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  electron.app.whenReady().then(() => setImmediate(registerIpc));
}

module.exports = {
  install,
  refs,
  normalizeSatisfactoryServer,
  satisfactoryModuleEnabled,
  satisfactoryModuleEnabledFromRuntime,
  executeSatisfactory
};