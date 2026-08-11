'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const electron = require('electron');
const { createCurrentServerAdapter } = require('../bot/game-adapters/current-server-adapter.cjs');
const { executeAdapterOperation } = require('../shared/game-adapter-sdk.cjs');
const { SatisfactoryApiClient, normalizeHost, normalizePort, normalizeFingerprint, formatFingerprint } = require('../bot/satisfactory-api.cjs');
const { serverModuleEnabled } = require('../shared/game-module-policy.cjs');
const { getNexusCoreService } = require('./services/nexus-core-service.cjs');

const refs = { configStore: null, autonomy: null, discordAuth: null, logger: null };
let installed = false;
let coreActionRegistered = false;

const SATISFACTORY_MUTATION_CAPABILITIES = Object.freeze({
  backup: 'backup.create',
  save: 'game.server.save',
  shutdown: 'game.server.shutdown',
  stop: 'game.server.stop',
  raw: 'game.console.raw'
});

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
  return serverModuleEnabled(runtime, { game: 'satisfactory' });
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

function runtimeServer(id, { requireToken = true, requireModule = true } = {}) {
  const runtime = refs.configStore?.getRuntimeBootstrap();
  const server = runtime?.config?.servers?.find((item) => String(item.id) === String(id));
  if (!server || server.enabled === false) throw new Error('The selected Satisfactory server is not configured or enabled.');
  if (String(server.game || '').toLowerCase() !== 'satisfactory') throw new Error('This action requires a Satisfactory server.');
  if (requireToken && !server.password) throw new Error('Save the protected Satisfactory application token before using server operations.');
  if (requireModule && !satisfactoryModuleEnabledFromRuntime(runtime)) throw new Error('Satisfactory Server Operations are disabled or blocked by a module dependency.');
  return server;
}

function actorRole() {
  return refs.autonomy?.accessState(refs.discordAuth?.getState())?.role || 'local-admin';
}

async function executeSatisfactoryAdapter(server, action, payload = {}, role = actorRole()) {
  const adapter = createCurrentServerAdapter(server, { logger: refs.logger });
  return executeAdapterOperation(adapter, action, payload, {
    role,
    explicitSecrets: [server.password]
  });
}

function coreForSatisfactory() {
  if (!refs.configStore?.configPath) throw new Error('Nexus Core is still initializing for Satisfactory operations.');
  const core = getNexusCoreService({ dataDirectory: path.dirname(refs.configStore.configPath), logger: refs.logger });
  if (!coreActionRegistered) {
    core.registerAction('satisfactory.server.mutation', {
      requiredCapabilities: (request) => {
        const capability = SATISFACTORY_MUTATION_CAPABILITIES[String(request.input.action || '')];
        return capability ? [capability] : ['satisfactory.unsupported-mutation'];
      },
      execute: async (request) => {
        const action = String(request.input.action || '');
        if (!SATISFACTORY_MUTATION_CAPABILITIES[action]) {
          const error = new Error(`Unsupported Satisfactory mutation: ${action}`);
          error.code = 'NEXUS_SATISFACTORY_MUTATION_UNSUPPORTED';
          throw error;
        }
        return executeSatisfactoryAdapter(runtimeServer(request.input.serverId), action, request.input.payload || {}, request.input.role || 'owner');
      }
    });
    coreActionRegistered = true;
  }
  return core;
}

function satisfactoryOperationId(server, action, payload, explicitId) {
  if (explicitId) return String(explicitId).slice(0, 190);
  const digest = crypto.createHash('sha256').update(JSON.stringify([server.id, action, payload || {}])).digest('hex').slice(0, 20);
  return `satisfactory:${action}:${server.id}:${Math.floor(Date.now() / 2000)}:${digest}`;
}

async function executeSatisfactory(server, action, payload = {}, options = {}) {
  const role = options.role || actorRole();
  const capability = SATISFACTORY_MUTATION_CAPABILITIES[action];
  if (!capability) return executeSatisfactoryAdapter(server, action, payload, role);
  const core = coreForSatisfactory();
  const operationId = satisfactoryOperationId(server, action, payload, options.operationId);
  const auth = refs.discordAuth?.getState?.() || {};
  const result = await core.commandGateway.dispatch({
    operationId,
    action: 'satisfactory.server.mutation',
    requestedAt: new Date().toISOString(),
    scope: { kind: 'server', id: String(server.id) },
    actor: { kind: 'user', id: String(auth.user?.id || 'local') },
    source: { kind: 'desktop', id: 'satisfactory-operations' },
    correlationId: operationId,
    idempotencyKey: operationId,
    requiredCapabilities: [],
    input: { serverId: String(server.id), action, payload, role }
  }, { role });
  if (result.status === 'succeeded') return result.output;
  if (result.status === 'duplicate' && result.output?.originalState === 'completed' && result.output?.originalResultStatus === 'succeeded') {
    return { ok: true, duplicate: true, data: { message: 'Nexus Core suppressed a duplicate Satisfactory mutation.' } };
  }
  const error = new Error(result.error?.message || `Satisfactory ${action} was blocked by Nexus Core (${result.status}).`);
  error.code = result.error?.code || 'NEXUS_SATISFACTORY_MUTATION_BLOCKED';
  throw error;
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
    const server = runtimeServer(request.id, { requireToken: false, requireModule: false });
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
    const result = await executeSatisfactory(server, action, payload, { role, operationId: request.operationId });
    refs.logger?.info('Satisfactory API action completed.', { server: server.name, action, requestId: result.requestId, durationMs: result.durationMs });
    return { action, server: server.name, result };
  });
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  patchBrowserLoader();
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
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
  executeSatisfactory,
  executeSatisfactoryAdapter,
  SATISFACTORY_MUTATION_CAPABILITIES,
  runtimeServer
};
