'use strict';

const path = require('node:path');
const electron = require('electron');
const { normalizePlayerConsoleConfig } = require('../shared/player-console.cjs');
const { PlayerConsoleService } = require('./services/player-console-service.cjs');

const refs = { configStore: null, logger: null, autonomy: null, discordAuth: null, service: null };
let installed = false;
let ipcInstalled = false;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function promoteCatalog() {
  try {
    const { MODULE_CATALOG, MIGRATION_STEPS } = require('../shared/module-catalog.cjs');
    const module = MODULE_CATALOG.find((item) => item.id === 'players-console');
    if (module) Object.assign(module, {
      stage: 'live',
      launchView: 'players',
      description: 'Cross-server connected-player visibility and guarded moderation using short-lived internal action tokens instead of raw identifiers or RCON commands.',
      features: ['Cross-server player list', 'Name and server search', 'Safe kick workflow', 'Owner-confirmed ban workflow', 'Required action reasons', 'Moderation audit history']
    });
    return MIGRATION_STEPS?.map((step) => step.id) || [];
  } catch {
    return [];
  }
}

function ensureConfig(store) {
  const normalized = normalizePlayerConsoleConfig(store.config.playerConsole || {});
  const changed = JSON.stringify(store.config.playerConsole || null) !== JSON.stringify(normalized);
  store.config.playerConsole = normalized;
  const migration = store.config.general?.moduleMigration?.['players-console'];
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
  if (!Original || Original.__khaosPlayerConsolePatched) return;

  class PlayerConsoleConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      ensureConfig(this);
      ensureService();
    }

    getPlayerConsoleConfig() {
      ensureConfig(this);
      return clone(this.config.playerConsole);
    }

    setPlayerConsoleSettings(input = {}) {
      ensureConfig(this);
      this.config.playerConsole = normalizePlayerConsoleConfig({ settings: { ...this.config.playerConsole.settings, ...input } });
      this.saveConfig();
      return this.getPlayerConsoleConfig();
    }
  }

  Object.defineProperty(PlayerConsoleConfigStore, '__khaosPlayerConsolePatched', { value: true });
  target.ConfigStore = PlayerConsoleConfigStore;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosPlayerConsoleCapturePatched) return;

  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
      ensureService();
    }
  }

  Object.defineProperty(Captured, '__khaosPlayerConsoleCapturePatched', { value: true });
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
  refs.service = new PlayerConsoleService({
    dataDirectory: path.dirname(refs.configStore.configPath),
    configStore: refs.configStore,
    logger: refs.logger
  });
  refs.service.on('state', broadcast);
  setImmediate(registerIpc);
  return refs.service;
}

function publicServers() {
  return (refs.configStore?.getPublicConfig?.().servers || []).map((server) => ({
    id: server.id,
    name: server.name,
    game: server.game,
    enabled: server.enabled !== false,
    hasPassword: Boolean(server.hasPassword),
    connectionType: server.connectionType || (server.game === 'palworld' ? 'rest' : 'rcon')
  }));
}

function payload() {
  return {
    role: accessRole(),
    servers: publicServers(),
    ...(ensureService()?.getState?.() || {
      config: normalizePlayerConsoleConfig({}),
      snapshot: { refreshedAt: null, players: [], servers: [], errors: [] },
      history: []
    })
  };
}

function broadcast() {
  if (!refs.configStore || !refs.service) return;
  const state = payload();
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('player-console:update', state);
  }
}

function audit(action, outcome, target, summary) {
  const currentActor = actor();
  refs.configStore?.appendDiscordAudit?.({
    category: 'players-console',
    action,
    outcome,
    targetType: 'player',
    targetId: '',
    targetName: target?.playerName || target?.name || '',
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

  electron.ipcMain.handle('player-console:get', () => {
    assertAccess('viewer', 'View connected players');
    return payload();
  });

  electron.ipcMain.handle('player-console:refresh', async (_event, serverIds) => {
    assertAccess('viewer', 'Refresh connected players');
    await refs.service.refresh(Array.isArray(serverIds) ? serverIds : []);
    return payload();
  });

  electron.ipcMain.handle('player-console:settings', (_event, settings) => {
    assertAccess('owner', 'Change player console settings');
    refs.configStore.setPlayerConsoleSettings(settings || {});
    audit('player-console.settings', 'success', null, 'Player console settings updated.');
    broadcast();
    return payload();
  });

  electron.ipcMain.handle('player-console:kick', async (_event, input) => {
    assertAccess('operator', 'Kick connected players');
    try {
      const result = await refs.service.moderate({ token: input?.token, action: 'kick', reason: input?.reason, actor: actor() });
      audit('player-console.kick', 'success', result, `${result.playerName} was kicked from ${result.serverName}. Reason: ${result.reason}`);
      return { result, state: payload() };
    } catch (error) {
      audit('player-console.kick', 'failed', { playerName: input?.playerName || '' }, error.message);
      throw error;
    }
  });

  electron.ipcMain.handle('player-console:ban', async (_event, input) => {
    assertAccess('owner', 'Ban connected players');
    try {
      const result = await refs.service.moderate({ token: input?.token, action: 'ban', reason: input?.reason, actor: actor() });
      audit('player-console.ban', 'success', result, `${result.playerName} was banned from ${result.serverName}. Reason: ${result.reason}`);
      return { result, state: payload() };
    } catch (error) {
      audit('player-console.ban', 'failed', { playerName: input?.playerName || '' }, error.message);
      throw error;
    }
  });

  electron.ipcMain.handle('player-console:clear-history', () => {
    assertAccess('owner', 'Clear moderation history');
    refs.service.clearHistory();
    audit('player-console.history-cleared', 'success', null, 'Player moderation history cleared.');
    return payload();
  });
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosPlayerConsoleUiPatched) return;
  const original = prototype.loadFile;
  prototype.loadFile = function patchedLoadFile(...args) {
    this.webContents.once('did-finish-load', () => {
      if (this.isDestroyed() || this.webContents.isDestroyed()) return;
      this.webContents.executeJavaScript(`(() => {
        if (!document.querySelector('link[href="player-console.css"]')) {
          const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'player-console.css'; document.head.appendChild(link);
        }
        if (!document.querySelector('script[src="player-console.js"]')) {
          const script = document.createElement('script'); script.src = 'player-console.js'; script.defer = true; document.body.appendChild(script);
        }
      })();`).catch((error) => refs.logger?.warn?.('Player console renderer bootstrap failed.', { message: error.message }));
    });
    return original.apply(this, args);
  };
  Object.defineProperty(prototype, '__khaosPlayerConsoleUiPatched', { value: true });
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
  }).catch((error) => console.error('[Khaos Nexus] Player console initialization failed.', error));
}

module.exports = { install, refs, ensureConfig, promoteCatalog };
