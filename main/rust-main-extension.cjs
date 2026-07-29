'use strict';

const crypto = require('node:crypto');
const electron = require('electron');
const { createCurrentServerAdapter } = require('../bot/game-adapters/current-server-adapter.cjs');
const { executeAdapterOperation } = require('../shared/game-adapter-sdk.cjs');
const { normalizeRustHost } = require('../bot/rust-webrcon.cjs');

const refs = { configStore: null, autonomy: null, discordAuth: null, logger: null };
let installed = false;

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosRustCaptured) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
    }
  }
  Object.defineProperty(Captured, '__khaosRustCaptured', { value: true });
  target[exportName] = Captured;
}

function normalizeRustServer(server = {}) {
  const id = String(server.id || crypto.randomUUID());
  const name = String(server.name || '').trim();
  const host = normalizeRustHost(server.host);
  const port = Number(server.port);
  if (!name || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Rust server name, host, and a valid WebRCON port are required.');
  }
  return {
    id,
    name,
    game: 'rust',
    host,
    port,
    enabled: server.enabled !== false,
    connectionType: 'webrcon',
    protocol: String(server.protocol || 'ws').toLowerCase() === 'wss' ? 'wss' : 'ws',
    rconName: String(server.rconName || 'Khaos Nexus').replace(/[\u0000\r\n]/g, '').trim().slice(0, 60) || 'Khaos Nexus',
    statusCommand: '',
    playersCommand: '',
    saveCommand: '',
    broadcastCommand: '',
    kickCommand: '',
    banCommand: ''
  };
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosRustPatched) return;

  class RustConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      let changed = false;
      for (const server of this.config?.servers || []) {
        if (String(server.game || '').toLowerCase() !== 'rust') continue;
        if (server.connectionType !== 'webrcon') { server.connectionType = 'webrcon'; changed = true; }
        const protocol = String(server.protocol || 'ws').toLowerCase() === 'wss' ? 'wss' : 'ws';
        if (server.protocol !== protocol) { server.protocol = protocol; changed = true; }
        if (!server.rconName) { server.rconName = 'Khaos Nexus'; changed = true; }
      }
      if (changed) this.saveConfig();
    }

    upsertServer(server, password) {
      if (String(server?.game || '').toLowerCase() !== 'rust') return super.upsertServer(server, password);
      const normalized = normalizeRustServer(server);
      const index = this.config.servers.findIndex((item) => item.id === normalized.id);
      if (index >= 0) this.config.servers[index] = normalized;
      else this.config.servers.push(normalized);
      if (password) {
        this.secrets.serverPasswords ||= {};
        this.secrets.serverPasswords[normalized.id] = String(password);
        this.saveSecrets();
      }
      this.saveConfig();
      return normalized.id;
    }
  }

  Object.defineProperty(RustConfigStore, '__khaosRustPatched', { value: true });
  target.ConfigStore = RustConfigStore;
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosRustUiPatched) return;
  const original = prototype.loadFile;
  prototype.loadFile = function patchedRustLoadFile(...args) {
    this.webContents.once('did-finish-load', () => {
      this.webContents.executeJavaScript(`(() => {
        if (!document.querySelector('script[src="rust-webrcon-ui.js"]')) {
          const script = document.createElement('script');
          script.src = 'rust-webrcon-ui.js';
          script.defer = true;
          document.body.appendChild(script);
        }
      })();`).catch(() => {});
    });
    return original.apply(this, args);
  };
  Object.defineProperty(prototype, '__khaosRustUiPatched', { value: true });
}

function requireAccess(role, action) {
  if (!refs.autonomy) throw new Error('Desktop access control is still initializing.');
  return refs.autonomy.assertAccess(refs.discordAuth?.getState(), role, action);
}

function getRustServer(id) {
  const runtime = refs.configStore?.getRuntimeBootstrap();
  const server = runtime?.config?.servers?.find((item) => String(item.id) === String(id));
  if (!server || server.enabled === false) throw new Error('The selected Rust server is not configured or enabled.');
  if (String(server.game || '').toLowerCase() !== 'rust') throw new Error('This action requires a Rust server.');
  if (!server.password) throw new Error('Save the protected Rust WebRCON password before using server operations.');
  const moduleState = runtime?.config?.moduleRuntime?.['rust-server-operations'];
  if (moduleState && !moduleState.effectiveEnabled) throw new Error('Rust Server Operations are disabled or blocked by an Owner module dependency.');
  return server;
}

function actorRole() {
  return refs.autonomy?.accessState(refs.discordAuth?.getState())?.role || 'local-admin';
}

async function executeRust(server, action, payload = {}) {
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

  electron.ipcMain.handle('server:rust-action', async (_event, request = {}) => {
    const action = String(request.action || '').toLowerCase();
    const roleByAction = {
      status: 'viewer', info: 'viewer', players: 'viewer',
      announce: 'operator', save: 'operator', kick: 'operator',
      ban: 'owner', unban: 'owner', shutdown: 'owner', stop: 'owner', raw: 'owner'
    };
    const role = roleByAction[action];
    if (!role) throw new Error(`Unsupported Rust action: ${action}`);
    requireAccess(role, `Rust ${action}`);
    const server = getRustServer(request.id);
    const payload = { ...(request.payload || {}) };

    if (['shutdown', 'stop'].includes(action) && String(payload.confirmation || '') !== server.name) {
      throw new Error(`Type the exact server name “${server.name}” to confirm shutdown.`);
    }
    if (action === 'raw' && String(payload.confirmation || '').trim().toUpperCase() !== 'RUN RAW COMMAND') {
      throw new Error('Type RUN RAW COMMAND to confirm an unrestricted Owner console command.');
    }

    const result = await executeRust(server, action, payload);
    refs.logger?.info('Rust WebRCON action completed.', {
      server: server.name,
      action,
      requestId: result.requestId,
      durationMs: result.durationMs
    });
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

module.exports = { install, refs, normalizeRustServer, executeRust };