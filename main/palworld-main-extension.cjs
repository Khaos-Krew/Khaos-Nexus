'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const { ServerConnection, isPalworldRest } = require('../bot/server-client.cjs');
const { normalizeServerAddress, summarizeGameData } = require('../bot/palworld-rest.cjs');
const { createCurrentServerAdapter } = require('../bot/game-adapters/current-server-adapter.cjs');
const { executeAdapterOperation } = require('../shared/game-adapter-sdk.cjs');
const { getNexusCoreService } = require('./services/nexus-core-service.cjs');

const refs = { configStore: null, autonomy: null, discordAuth: null, logger: null };
let installed = false;
let coreActionRegistered = false;

const MUTATION_CAPABILITIES = Object.freeze({
  announce: 'game.server.broadcast',
  save: 'game.server.save',
  kick: 'game.player.moderate',
  ban: 'game.player.ban',
  unban: 'game.player.ban',
  shutdown: 'game.server.shutdown',
  stop: 'game.server.stop'
});

function captureClass(modulePath, exportName, refName, enhance) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosPalworldPatched) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
      enhance?.call(this);
    }
  }
  Object.defineProperty(Captured, '__khaosPalworldPatched', { value: true });
  target[exportName] = Captured;
}

function migrateConfig() {
  let changed = false;
  if (this.config?.monitor?.reportRepository === 'Khaos-Krew/Khaos-Nexus-Bot-Manager') {
    this.config.monitor.reportRepository = 'Khaos-Krew/Khaos-Nexus';
    changed = true;
  }
  for (const server of this.config?.servers || []) {
    if (String(server.game).toLowerCase() !== 'palworld') continue;
    if (!server.connectionType) { server.connectionType = 'rest'; changed = true; }
    if (!server.protocol) { server.protocol = 'http'; changed = true; }
    if (!server.username) { server.username = 'admin'; changed = true; }
    if (!server.apiPath) { server.apiPath = '/v1/api'; changed = true; }
  }
  if (changed) this.saveConfig();
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (Original.__khaosPalworldPatched) return;
  class PalworldConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      migrateConfig.call(this);
    }

    upsertServer(server, password) {
      const normalized = normalizeServerAddress(server || {});
      const id = super.upsertServer(normalized, password);
      const saved = this.config.servers.find((item) => item.id === id);
      if (saved) {
        saved.connectionType = String(server?.game).toLowerCase() === 'palworld'
          ? (String(server?.connectionType || 'rest').toLowerCase() === 'rcon' ? 'rcon' : 'rest')
          : 'rcon';
        saved.protocol = normalized.protocol;
        saved.username = normalized.username;
        saved.apiPath = normalized.apiPath;
        this.saveConfig();
      }
      return id;
    }
  }
  Object.defineProperty(PalworldConfigStore, '__khaosPalworldPatched', { value: true });
  target.ConfigStore = PalworldConfigStore;
}

function patchServerTransport() {
  const target = require('../bot/rcon.cjs');
  target.SourceRcon = ServerConnection;
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosPalworldPatched) return;
  const original = prototype.loadFile;
  prototype.loadFile = function patchedLoadFile(...args) {
    this.webContents.once('did-finish-load', () => {
      this.webContents.executeJavaScript(`(() => {
        if (!document.querySelector('script[src="palworld-rest-ui.js"]')) {
          const script = document.createElement('script');
          script.src = 'palworld-rest-ui.js';
          script.defer = true;
          document.body.appendChild(script);
        }
      })();`).catch(() => {});
    });
    return original.apply(this, args);
  };
  Object.defineProperty(prototype, '__khaosPalworldPatched', { value: true });
}

function requireAccess(role, action) {
  if (!refs.autonomy) throw new Error('Desktop access control is still initializing.');
  return refs.autonomy.assertAccess(refs.discordAuth?.getState(), role, action);
}

function getPalworldServer(id) {
  const server = refs.configStore?.getRuntimeBootstrap()?.config?.servers?.find((item) => item.id === id);
  if (!server) throw new Error('Server configuration was not found.');
  if (String(server.game).toLowerCase() !== 'palworld') throw new Error('This action requires a Palworld server.');
  if (!isPalworldRest(server)) throw new Error('This Palworld entry is configured for legacy RCON. Change Connection type to Palworld REST API.');
  if (!server.password) throw new Error('Save the Palworld AdminPassword before using REST operations.');
  return server;
}

function cleanText(value, max, label) {
  const result = String(value || '').trim();
  if (!result) throw new Error(`${label} is required.`);
  return result.slice(0, max);
}

function normalizedActionPayload(server, action, input = {}) {
  const payload = { ...(input || {}) };
  if (action === 'announce') payload.message = cleanText(payload.message, 500, 'Announcement message');
  if (['kick', 'ban', 'unban'].includes(action)) payload.player = cleanText(payload.player || payload.userid, 150, 'Player name or user ID');
  if (['kick', 'ban'].includes(action) && payload.message) payload.message = String(payload.message).trim().slice(0, 300);
  if (action === 'shutdown') {
    if (String(payload.confirmation || '') !== server.name) throw new Error(`Type the exact server name “${server.name}” to confirm shutdown.`);
    payload.waittime = Math.min(3600, Math.max(5, Math.round(Number(payload.waittime) || 30)));
    payload.message = String(payload.message || 'Server maintenance is starting.').trim().slice(0, 500);
  }
  if (action === 'stop' && String(payload.confirmation || '').trim().toUpperCase() !== 'FORCE STOP') {
    throw new Error('Type FORCE STOP to confirm an immediate server stop.');
  }
  return payload;
}

async function executeAdapterAction(server, action, payload = {}, role = 'owner') {
  const normalized = normalizedActionPayload(server, action, payload);
  const adapter = createCurrentServerAdapter(server, { logger: refs.logger });
  const result = await executeAdapterOperation(adapter, action, normalized, {
    role,
    explicitSecrets: [server.password]
  });
  return result.data;
}

function coreForPalworld() {
  if (!refs.configStore?.configPath) throw new Error('Nexus Core is still initializing for Palworld operations.');
  const core = getNexusCoreService({
    dataDirectory: path.dirname(refs.configStore.configPath),
    logger: refs.logger
  });
  if (!coreActionRegistered) {
    core.registerAction('palworld.server.mutation', {
      requiredCapabilities: (request) => {
        const capability = MUTATION_CAPABILITIES[String(request.input.action || '')];
        return capability ? [capability] : ['palworld.unsupported-mutation'];
      },
      execute: async (request) => {
        const action = String(request.input.action || '');
        if (!MUTATION_CAPABILITIES[action]) {
          const error = new Error(`Unsupported Palworld mutation: ${action}`);
          error.code = 'NEXUS_PALWORLD_MUTATION_UNSUPPORTED';
          throw error;
        }
        const server = getPalworldServer(request.input.serverId);
        return executeAdapterAction(server, action, request.input.payload || {}, request.input.role || 'owner');
      }
    });
    coreActionRegistered = true;
  }
  return core;
}

function palworldOperationId(server, action, payload, options = {}) {
  if (options.operationId) return String(options.operationId).slice(0, 190);
  const body = JSON.stringify([server.id, action, payload || {}]);
  const digest = crypto.createHash('sha256').update(body).digest('hex').slice(0, 20);
  const bucket = Math.floor(Date.now() / 2000);
  return `palworld:${action}:${server.id}:${bucket}:${digest}`;
}

async function executeAction(server, action, payload = {}, role = 'owner', options = {}) {
  const capability = MUTATION_CAPABILITIES[action];
  if (!capability) return executeAdapterAction(server, action, payload, role);

  const normalized = normalizedActionPayload(server, action, payload);
  const core = coreForPalworld();
  const operationId = palworldOperationId(server, action, normalized, options);
  const auth = refs.discordAuth?.getState?.() || {};
  const result = await core.commandGateway.dispatch({
    operationId,
    action: 'palworld.server.mutation',
    requestedAt: new Date().toISOString(),
    scope: { kind: 'server', id: String(server.id) },
    actor: { kind: 'user', id: String(auth.user?.id || 'local') },
    source: { kind: 'desktop', id: 'palworld-operations' },
    correlationId: operationId,
    idempotencyKey: operationId,
    requiredCapabilities: [],
    input: {
      serverId: String(server.id),
      action,
      payload: normalized,
      role
    }
  }, { role });

  if (result.status === 'succeeded') return result.output;
  if (result.status === 'duplicate' && result.output?.originalState === 'completed' && result.output?.originalResultStatus === 'succeeded') {
    return { duplicate: true, message: 'Nexus Core suppressed a duplicate Palworld mutation.' };
  }
  const error = new Error(result.error?.message || `Palworld ${action} was blocked by Nexus Core (${result.status}).`);
  error.code = result.error?.code || 'NEXUS_PALWORLD_MUTATION_BLOCKED';
  throw error;
}

function registerIpc() {
  if (!refs.configStore || !refs.autonomy) {
    setTimeout(registerIpc, 100);
    return;
  }
  if (registerIpc.done) return;
  registerIpc.done = true;

  electron.ipcMain.handle('server:palworld-action', async (_event, request = {}) => {
    const action = String(request.action || '');
    const roleByAction = {
      info: 'viewer', status: 'viewer', players: 'viewer', settings: 'viewer', metrics: 'viewer', 'game-data-summary': 'viewer',
      announce: 'operator', save: 'operator', kick: 'operator',
      ban: 'owner', unban: 'owner', shutdown: 'owner', stop: 'owner', 'game-data-export': 'owner'
    };
    const role = roleByAction[action];
    if (!role) throw new Error(`Unsupported Palworld action: ${action}`);
    requireAccess(role, `Palworld ${action}`);
    const server = getPalworldServer(request.id);

    if (action === 'game-data-export') {
      const snapshot = await executeAction(server, 'game-data', request.payload, role);
      const defaultPath = path.join(electron.app.getPath('documents'), `palworld-world-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      const choice = await electron.dialog.showSaveDialog({
        title: 'Export Palworld world actor snapshot',
        defaultPath,
        filters: [{ name: 'JSON snapshot', extensions: ['json'] }]
      });
      if (choice.canceled || !choice.filePath) return { canceled: true };
      fs.writeFileSync(choice.filePath, JSON.stringify(snapshot, null, 2), 'utf8');
      refs.logger?.info('Palworld world actor snapshot exported.', { server: server.name, filePath: choice.filePath });
      return { canceled: false, filePath: choice.filePath, summary: summarizeGameData(snapshot) };
    }

    const result = await executeAction(server, action, request.payload || {}, role, { operationId: request.operationId });
    refs.logger?.info('Palworld REST action completed.', { server: server.name, action });
    return { action, server: server.name, result };
  });
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  patchServerTransport();
  patchBrowserLoader();
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  electron.app.whenReady().then(() => setImmediate(registerIpc));
}

module.exports = {
  install,
  refs,
  executeAction,
  executeAdapterAction,
  normalizedActionPayload,
  MUTATION_CAPABILITIES,
  palworldOperationId
};
