'use strict';

const crypto = require('node:crypto');
const electron = require('electron');
const { ServerConnection } = require('../bot/server-client.cjs');
const { createCurrentServerAdapter } = require('../bot/game-adapters/current-server-adapter.cjs');
const { executeAdapterOperation } = require('../shared/game-adapter-sdk.cjs');
const { normalizeRustHost } = require('../bot/rust-webrcon.cjs');

const refs = { configStore: null, autonomy: null, discordAuth: null, logger: null };
let installed = false;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

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

function rustModuleEnabledFromRuntime(runtime) {
  const state = runtime?.config?.moduleRuntime?.['rust-server-operations'];
  return state ? Boolean(state.effectiveEnabled) : true;
}

function rustModuleEnabled(configStore) {
  return rustModuleEnabledFromRuntime(configStore?.getRuntimeBootstrap?.());
}

function filterRustWhenDisabled(runtime) {
  if (rustModuleEnabledFromRuntime(runtime)) return runtime;
  return {
    ...runtime,
    config: {
      ...runtime.config,
      servers: (runtime.config?.servers || []).filter((server) => String(server.game || '').toLowerCase() !== 'rust')
    }
  };
}

function autonomyCommand(server, action, value = '') {
  const game = String(server?.game || 'generic').toLowerCase();
  const commands = {
    rust: {
      status: 'status',
      save: 'save-all',
      broadcast: `broadcast ${value}`
    },
    ark: {
      status: 'ListPlayers',
      save: 'SaveWorld',
      broadcast: `Broadcast ${value}`
    },
    palworld: {
      status: 'Info',
      save: 'Save',
      broadcast: `Broadcast ${value}`
    },
    generic: {
      status: server.statusCommand || 'status',
      save: server.saveCommand || 'save-all',
      broadcast: `${server.broadcastCommand || 'broadcast'} ${value}`
    }
  };
  return (commands[game] || commands.generic)[action];
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

function rustAutonomyConnection(server) {
  if (String(server?.game || '').toLowerCase() !== 'rust') return new ServerConnection(server);
  const connection = new ServerConnection(server);
  return {
    async execute(command) {
      const text = String(command || '').trim();
      if (/^status$/i.test(text)) return JSON.stringify(await connection.action('status'), null, 2);
      if (/^save-all$/i.test(text)) return connection.action('save');
      const broadcast = text.match(/^broadcast\s+(.+)$/i);
      if (broadcast) return connection.action('announce', { message: broadcast[1] });
      return connection.action('raw', { command: text });
    }
  };
}

function patchAutonomyService() {
  const target = require('./services/autonomy-service.cjs');
  const Original = target.AutonomyService;
  if (!Original || Original.__khaosRustPatched) return;

  class RustAutonomyService extends Original {
    constructor(...args) {
      super(...args);
      refs.autonomy = this;
      const originalFactory = this.rconFactory;
      this.rconFactory = (server) => String(server?.game || '').toLowerCase() === 'rust'
        ? rustAutonomyConnection(server)
        : originalFactory(server);
    }

    async checkServers() {
      if (this.healthRunning) return { skipped: true, reason: 'already-running' };
      this.healthRunning = true;
      try {
        const runtime = filterRustWhenDisabled(this.configStore.getRuntimeBootstrap());
        const enabledServers = runtime.config.servers.filter((server) => server.enabled !== false);
        const activeIds = new Set(enabledServers.map((server) => server.id));
        const health = Object.fromEntries(Object.entries(this.state.serverHealth || {}).filter(([id]) => activeIds.has(id)));
        const checkedAt = new Date(this.now()).toISOString();

        for (const server of enabledServers) {
          try {
            const detail = await this.testServer(server);
            health[server.id] = { name: server.name, game: server.game, status: 'online', checkedAt, failures: 0, detail };
          } catch (error) {
            const previous = health[server.id] || {};
            health[server.id] = {
              name: server.name,
              game: server.game,
              status: 'offline',
              checkedAt,
              failures: Number(previous.failures || 0) + 1,
              detail: error.message
            };
          }
        }

        const offline = Object.values(health).filter((entry) => entry.status === 'offline');
        const attention = offline.map((entry) => `A configured game server is unreachable: ${entry.detail}`);
        this.updateState({
          status: attention.length ? 'attention' : 'ready',
          lastHealthCheckAt: checkedAt,
          serverHealth: health,
          attention,
          lastError: attention[0] || null
        });
        if (offline.some((entry) => entry.failures >= 3)) {
          await this.notify('Khaos Nexus server attention required', `${offline.length} configured server connection(s) are failing repeatedly.`, 'warning').catch(() => {});
        }
        return { checkedAt, health: clone(health), offline: offline.length };
      } finally {
        this.healthRunning = false;
      }
    }

    async runMaintenance() {
      if (this.maintenanceRunning) throw new Error('Maintenance Mode is already running.');
      this.maintenanceRunning = true;
      const startedAt = new Date(this.now()).toISOString();
      this.updateState({ status: 'maintenance', maintenanceActive: true, lastError: null });
      const results = [];
      try {
        this.createAutomaticBackup('pre-maintenance');
        results.push({ step: 'backup', ok: true, detail: 'Verified backup created.' });
        await this.notify('Khaos Nexus maintenance starting', this.settings.maintenanceWarning, 'warning').catch(() => {});

        const runtime = filterRustWhenDisabled(this.configStore.getRuntimeBootstrap());
        for (const server of runtime.config.servers.filter((item) => item.enabled !== false)) {
          if (!server.password) {
            results.push({ step: 'server', server: server.name, ok: false, detail: 'RCON password missing.' });
            continue;
          }
          const rcon = this.rconFactory(server);
          try {
            await rcon.execute(autonomyCommand(server, 'broadcast', this.settings.maintenanceWarning));
            await rcon.execute(autonomyCommand(server, 'save'));
            results.push({ step: 'server', server: server.name, ok: true, detail: 'Players warned and world save requested.' });
          } catch (error) {
            results.push({ step: 'server', server: server.name, ok: false, detail: error.message });
          }
        }

        if (this.settings.maintenanceRestartBot) {
          await this.supervisor.restart();
          results.push({ step: 'bot', ok: true, detail: 'Supervised bot restart requested.' });
        }

        const failed = results.filter((item) => !item.ok);
        const summary = { ok: failed.length === 0, startedAt, completedAt: new Date(this.now()).toISOString(), results };
        this.updateState({
          status: summary.ok ? 'ready' : 'attention',
          maintenanceActive: false,
          lastMaintenanceAt: summary.completedAt,
          lastMaintenanceSummary: summary,
          lastError: failed[0]?.detail || null
        });
        await this.notify('Khaos Nexus maintenance completed', summary.ok ? 'All maintenance steps completed.' : `${failed.length} maintenance step(s) need attention.`, summary.ok ? 'info' : 'warning').catch(() => {});
        return summary;
      } catch (error) {
        this.updateState({ status: 'attention', maintenanceActive: false, lastError: error.message });
        await this.notify('Khaos Nexus maintenance failed', error.message, 'error').catch(() => {});
        throw error;
      } finally {
        this.maintenanceRunning = false;
      }
    }
  }

  Object.defineProperty(RustAutonomyService, '__khaosRustPatched', { value: true });
  target.AutonomyService = RustAutonomyService;
}

function patchSchedulerService() {
  const target = require('./services/server-scheduler-service.cjs');
  const prototype = target.ServerSchedulerService?.prototype;
  if (!prototype || prototype.__khaosRustPatched) return;
  const original = prototype.runtimeServers;
  prototype.runtimeServers = function rustAwareRuntimeServers(schedule) {
    return original.call(this, schedule).filter((server) => {
      if (String(server.game || '').toLowerCase() !== 'rust') return true;
      return rustModuleEnabled(this.configStore);
    });
  };
  Object.defineProperty(prototype, '__khaosRustPatched', { value: true });
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
  normalizeRustServer,
  executeRust,
  rustModuleEnabled,
  rustModuleEnabledFromRuntime,
  filterRustWhenDisabled,
  rustAutonomyConnection,
  autonomyCommand
};