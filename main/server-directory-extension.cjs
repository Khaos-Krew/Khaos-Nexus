'use strict';

const electron = require('electron');
const {
  SERVER_TYPES,
  GAME_TYPES,
  availableServerTypes,
  normalizeServerRecord,
  sanitizePublic,
  monetizationRisk,
  offlinePolicy
} = require('../shared/server-directory-model.cjs');

const refs = { configStore: null, autonomy: null, discordAuth: null, logger: null };
let installed = false;
let ipcInstalled = false;

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function ensureConfig(store) {
  store.config.serverDirectory ||= {};
  store.config.serverDirectory.servers ||= [];
  store.config.serverDirectory.offlinePolicy ||= {
    warnAfterHours: 24,
    markOfflineAfterHours: 48,
    delistAfterHours: 72,
    suspendAfterHours: 168
  };
  store.config.serverDirectory.version ||= 1;
  return store.config.serverDirectory;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosServerDirectoryCapturePatched) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
      if (refName === 'configStore') ensureConfig(this);
      setImmediate(registerIpc);
    }
  }
  Object.defineProperty(Captured, '__khaosServerDirectoryCapturePatched', { value: true });
  target[exportName] = Captured;
}

function accessRole() {
  try { return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'local-admin'; }
  catch { return 'local-admin'; }
}

function canCreateOfficial() {
  return ['owner', 'local-admin'].includes(accessRole());
}

function canReviewCommunity() {
  return ['operator', 'owner', 'local-admin'].includes(accessRole());
}

function actor() {
  const auth = refs.discordAuth?.getState?.() || {};
  return {
    id: auth.user?.id || '',
    name: auth.user?.globalName || auth.user?.username || 'Local operator',
    role: accessRole()
  };
}

function audit(action, outcome, record, summary) {
  const who = actor();
  refs.configStore?.appendDiscordAudit?.({
    category: 'server-directory',
    action,
    outcome,
    targetType: 'server-listing',
    targetId: record?.id || '',
    targetName: record?.serverName || '',
    summary: String(summary || '').slice(0, 500),
    actorId: who.id,
    actorName: who.name,
    actorRole: who.role,
    time: new Date().toISOString()
  });
}

function save() {
  refs.configStore?.saveConfig?.();
  broadcast();
}

function directory() {
  return ensureConfig(refs.configStore);
}

function privatePayload() {
  const config = directory();
  return {
    role: accessRole(),
    permissions: {
      canCreateOfficial: canCreateOfficial(),
      canReviewCommunity: canReviewCommunity()
    },
    schemas: {
      games: clone(GAME_TYPES),
      serverTypes: clone(SERVER_TYPES)
    },
    offlinePolicy: clone(config.offlinePolicy),
    servers: clone(config.servers)
  };
}

function publicPayload() {
  return directory().servers
    .filter((record) => record.applicationState === 'listed' && record.publicVisibility !== 'hidden')
    .map(sanitizePublic);
}

function broadcast() {
  if (!refs.configStore) return;
  const state = privatePayload();
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('server-directory:update', state);
  }
}

function find(id) {
  return directory().servers.find((record) => record.id === id);
}

function upsert(input = {}) {
  const config = directory();
  const existing = input.id ? find(input.id) : null;
  const ownership = input.ownerType || existing?.ownerType || 'community';
  const record = normalizeServerRecord({ ...existing, ...input, ownerType: ownership }, { canCreateOfficial: canCreateOfficial() });
  const index = config.servers.findIndex((item) => item.id === record.id);
  if (index >= 0) config.servers[index] = record;
  else config.servers.push(record);
  save();
  return record;
}

function transition(id, state, notes = '') {
  if (!canReviewCommunity()) throw new Error('Community server review requires staff access.');
  const record = find(id);
  if (!record) throw new Error('Server application not found.');
  const allowed = new Set(['automated-review', 'staff-review', 'changes-required', 'approved', 'denied', 'listed', 'suspended', 'delisted']);
  if (!allowed.has(state)) throw new Error(`Unsupported application state: ${state}`);
  record.applicationState = state;
  record.updatedAt = new Date().toISOString();
  if (notes) record.vetting.notes = String(notes).trim().slice(0, 2000);
  if (['approved', 'denied', 'listed'].includes(state)) {
    record.vetting.reviewedAt = new Date().toISOString();
    record.vetting.reviewedBy = actor().name;
  }
  save();
  audit(`server-application.${state}`, 'success', record, notes || `Application moved to ${state}.`);
  return record;
}

function registerIpc() {
  if (ipcInstalled || !refs.configStore) return;
  ipcInstalled = true;

  electron.ipcMain.handle('server-directory:get', () => privatePayload());
  electron.ipcMain.handle('server-directory:get-public', () => publicPayload());
  electron.ipcMain.handle('server-directory:schemas', (_event, gameId) => ({
    gameId: String(gameId || 'other'),
    types: clone(availableServerTypes(gameId))
  }));

  electron.ipcMain.handle('server-directory:save', (_event, input) => {
    const record = upsert(input || {});
    audit(record.ownerType === 'nexus-official' ? 'official-server.saved' : 'community-server.draft-saved', 'success', record, 'Server record saved.');
    return privatePayload();
  });

  electron.ipcMain.handle('server-directory:submit', (_event, input) => {
    const record = upsert({ ...(input || {}), ownerType: 'community', applicationState: 'submitted' });
    record.vetting = { ...record.vetting, ...monetizationRisk(record.monetization) };
    record.applicationState = record.vetting.pass ? 'staff-review' : 'changes-required';
    save();
    audit('community-server.submitted', record.vetting.pass ? 'success' : 'blocked', record,
      record.vetting.pass ? 'Community server submitted for staff review.' : `Application blocked: ${record.vetting.blockers.join('; ')}`);
    return privatePayload();
  });

  electron.ipcMain.handle('server-directory:transition', (_event, input) => {
    transition(input?.id, input?.state, input?.notes);
    return privatePayload();
  });

  electron.ipcMain.handle('server-directory:remove', (_event, id) => {
    if (!canReviewCommunity()) throw new Error('Removing server records requires staff access.');
    const config = directory();
    const record = find(id);
    if (!record) throw new Error('Server record not found.');
    config.servers = config.servers.filter((item) => item.id !== id);
    save();
    audit('server-record.removed', 'success', record, 'Server record removed from the directory store.');
    return privatePayload();
  });

  electron.ipcMain.handle('server-directory:set-offline-policy', (_event, policy) => {
    if (!canCreateOfficial()) throw new Error('Changing server directory policy requires owner access.');
    const config = directory();
    config.offlinePolicy = {
      warnAfterHours: Math.max(1, Number(policy?.warnAfterHours) || 24),
      markOfflineAfterHours: Math.max(1, Number(policy?.markOfflineAfterHours) || 48),
      delistAfterHours: Math.max(1, Number(policy?.delistAfterHours) || 72),
      suspendAfterHours: Math.max(1, Number(policy?.suspendAfterHours) || 168)
    };
    save();
    audit('offline-policy.updated', 'success', null, 'Community server offline thresholds updated.');
    return privatePayload();
  });

  electron.ipcMain.handle('server-directory:evaluate-offline', () => {
    if (!canReviewCommunity()) throw new Error('Offline enforcement requires staff access.');
    const config = directory();
    const actions = [];
    for (const record of config.servers.filter((item) => item.ownerType === 'community')) {
      const result = offlinePolicy(record, Date.now(), config.offlinePolicy);
      if (result.action === 'delist' && record.applicationState === 'listed') record.applicationState = 'delisted';
      if (result.action === 'suspend' && !['denied', 'suspended'].includes(record.applicationState)) record.applicationState = 'suspended';
      if (result.action !== 'none') actions.push({ id: record.id, serverName: record.serverName, ...result });
    }
    if (actions.length) save();
    return { actions, state: privatePayload() };
  });
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosServerDirectoryUiPatched) return;
  const original = prototype.loadFile;
  prototype.loadFile = function patchedLoadFile(...args) {
    this.webContents.once('did-finish-load', () => {
      if (this.isDestroyed() || this.webContents.isDestroyed()) return;
      this.webContents.executeJavaScript(`(() => {
        if (!document.querySelector('link[href="server-directory.css"]')) {
          const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'server-directory.css'; document.head.appendChild(link);
        }
        if (!document.querySelector('script[src="server-directory.js"]')) {
          const script = document.createElement('script'); script.src = 'server-directory.js'; script.defer = true; document.body.appendChild(script);
        }
      })();`).catch((error) => refs.logger?.warn?.('Server directory renderer bootstrap failed.', { message: error.message }));
    });
    return original.apply(this, args);
  };
  Object.defineProperty(prototype, '__khaosServerDirectoryUiPatched', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  captureClass('./services/config-store.cjs', 'ConfigStore', 'configStore');
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  patchBrowserLoader();
  electron.app.whenReady().then(() => {
    const wait = () => refs.configStore ? registerIpc() : setTimeout(wait, 100);
    wait();
  }).catch((error) => console.error('[Khaos Nexus] Server directory initialization failed.', error));
}

module.exports = { install, refs, ensureConfig, privatePayload, publicPayload };
