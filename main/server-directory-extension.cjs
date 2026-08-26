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
const SECRET_FIELDS = Object.freeze(['joinPassword', 'realmInviteCode', 'realmShareLink']);

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function ensureConfig(store) {
  store.config.serverDirectory ||= {};
  store.config.serverDirectory.servers ||= [];
  store.config.serverDirectory.offlinePolicy ||= { warnAfterHours: 24, markOfflineAfterHours: 48, delistAfterHours: 72, suspendAfterHours: 168 };
  store.config.serverDirectory.version ||= 1;
  store.secrets.serverDirectoryProtected ||= {};
  return store.config.serverDirectory;
}

function splitProtected(record) {
  const stored = clone(record);
  const protectedValues = {};
  for (const field of SECRET_FIELDS) {
    if (stored[field]) protectedValues[field] = stored[field];
    delete stored[field];
  }
  return { stored, protectedValues };
}

function hydrate(store, record) {
  const protectedValues = store.secrets.serverDirectoryProtected?.[record.id] || {};
  return { ...clone(record), ...clone(protectedValues) };
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosServerDirectoryStorePatched) return;

  class ServerDirectoryConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      ensureConfig(this);
      setImmediate(registerIpc);
    }

    getServerDirectoryRecords() {
      const config = ensureConfig(this);
      return config.servers.map((record) => hydrate(this, record));
    }

    getPublicConfig() {
      const config = super.getPublicConfig();
      const directory = ensureConfig(this);
      config.serverDirectory = {
        version: directory.version,
        offlinePolicy: clone(directory.offlinePolicy),
        servers: directory.servers
          .filter((record) => record.applicationState === 'listed' && record.publicVisibility !== 'hidden')
          .map(sanitizePublic)
      };
      return config;
    }

    getSecretValues() {
      const protectedValues = Object.values(this.secrets.serverDirectoryProtected || {}).flatMap((entry) => Object.values(entry || {}));
      return [...super.getSecretValues(), ...protectedValues].filter(Boolean);
    }

    upsertServerDirectoryRecord(input, options = {}) {
      const directory = ensureConfig(this);
      const existingStored = input.id ? directory.servers.find((record) => record.id === input.id) : null;
      const existing = existingStored ? hydrate(this, existingStored) : null;
      const record = normalizeServerRecord({ ...existing, ...input }, options);
      const { stored, protectedValues } = splitProtected(record);
      const index = directory.servers.findIndex((item) => item.id === stored.id);
      if (index >= 0) directory.servers[index] = stored;
      else directory.servers.push(stored);
      if (Object.keys(protectedValues).length) this.secrets.serverDirectoryProtected[stored.id] = protectedValues;
      else delete this.secrets.serverDirectoryProtected[stored.id];
      this.saveConfig();
      this.saveSecrets();
      return hydrate(this, stored);
    }

    removeServerDirectoryRecord(id) {
      const directory = ensureConfig(this);
      directory.servers = directory.servers.filter((record) => record.id !== id);
      delete this.secrets.serverDirectoryProtected[id];
      this.saveConfig();
      this.saveSecrets();
    }
  }

  Object.defineProperty(ServerDirectoryConfigStore, '__khaosServerDirectoryStorePatched', { value: true });
  target.ConfigStore = ServerDirectoryConfigStore;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosServerDirectoryCapturePatched) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
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
function canCreateOfficial() { return ['owner', 'local-admin'].includes(accessRole()); }
function canReviewCommunity() { return ['operator', 'owner', 'local-admin'].includes(accessRole()); }
function actor() {
  const auth = refs.discordAuth?.getState?.() || {};
  return { id: auth.user?.id || '', name: auth.user?.globalName || auth.user?.username || 'Local operator', role: accessRole() };
}
function audit(action, outcome, record, summary) {
  const who = actor();
  refs.configStore?.appendDiscordAudit?.({ category: 'server-directory', action, outcome, targetType: 'server-listing', targetId: record?.id || '', targetName: record?.serverName || '', summary: String(summary || '').slice(0, 500), actorId: who.id, actorName: who.name, actorRole: who.role, time: new Date().toISOString() });
}
function directory() { return ensureConfig(refs.configStore); }
function records() { return refs.configStore?.getServerDirectoryRecords?.() || []; }
function privatePayload() {
  return {
    role: accessRole(),
    permissions: { canCreateOfficial: canCreateOfficial(), canReviewCommunity: canReviewCommunity() },
    schemas: { games: clone(GAME_TYPES), serverTypes: clone(SERVER_TYPES) },
    offlinePolicy: clone(directory().offlinePolicy),
    servers: records()
  };
}
function publicPayload() {
  return records().filter((record) => record.applicationState === 'listed' && record.publicVisibility !== 'hidden').map(sanitizePublic);
}
function broadcast() {
  if (!refs.configStore) return;
  const state = privatePayload();
  for (const window of electron.BrowserWindow.getAllWindows()) if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('server-directory:update', state);
}
function saveConfigOnly() { refs.configStore?.saveConfig?.(); broadcast(); }
function find(id) { return records().find((record) => record.id === id); }
function upsert(input = {}) {
  const existing = input.id ? find(input.id) : null;
  return refs.configStore.upsertServerDirectoryRecord({ ...existing, ...input, ownerType: input.ownerType || existing?.ownerType || 'community' }, { canCreateOfficial: canCreateOfficial() });
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
  if (['approved', 'denied', 'listed'].includes(state)) { record.vetting.reviewedAt = new Date().toISOString(); record.vetting.reviewedBy = actor().name; }
  const saved = refs.configStore.upsertServerDirectoryRecord(record, { canCreateOfficial: canCreateOfficial() });
  broadcast();
  audit(`server-application.${state}`, 'success', saved, notes || `Application moved to ${state}.`);
  return saved;
}

function registerIpc() {
  if (ipcInstalled || !refs.configStore) return;
  ipcInstalled = true;
  electron.ipcMain.handle('server-directory:get', () => privatePayload());
  electron.ipcMain.handle('server-directory:get-public', () => publicPayload());
  electron.ipcMain.handle('server-directory:schemas', (_event, gameId) => ({ gameId: String(gameId || 'other'), types: clone(availableServerTypes(gameId)) }));
  electron.ipcMain.handle('server-directory:save', (_event, input) => {
    const record = upsert(input || {}); broadcast();
    audit(record.ownerType === 'nexus-official' ? 'official-server.saved' : 'community-server.draft-saved', 'success', record, 'Server record saved.');
    return privatePayload();
  });
  electron.ipcMain.handle('server-directory:submit', (_event, input) => {
    let record = upsert({ ...(input || {}), ownerType: 'community', applicationState: 'submitted' });
    record.vetting = { ...record.vetting, ...monetizationRisk(record.monetization) };
    record.applicationState = record.vetting.pass ? 'staff-review' : 'changes-required';
    record = refs.configStore.upsertServerDirectoryRecord(record, { canCreateOfficial: false }); broadcast();
    audit('community-server.submitted', record.vetting.pass ? 'success' : 'blocked', record, record.vetting.pass ? 'Community server submitted for staff review.' : `Application blocked: ${record.vetting.blockers.join('; ')}`);
    return privatePayload();
  });
  electron.ipcMain.handle('server-directory:transition', (_event, input) => { transition(input?.id, input?.state, input?.notes); return privatePayload(); });
  electron.ipcMain.handle('server-directory:remove', (_event, id) => {
    if (!canReviewCommunity()) throw new Error('Removing server records requires staff access.');
    const record = find(id); if (!record) throw new Error('Server record not found.');
    refs.configStore.removeServerDirectoryRecord(id); broadcast(); audit('server-record.removed', 'success', record, 'Server record removed from the directory store.'); return privatePayload();
  });
  electron.ipcMain.handle('server-directory:set-offline-policy', (_event, policy) => {
    if (!canCreateOfficial()) throw new Error('Changing server directory policy requires owner access.');
    const config = directory();
    config.offlinePolicy = { warnAfterHours: Math.max(1, Number(policy?.warnAfterHours) || 24), markOfflineAfterHours: Math.max(1, Number(policy?.markOfflineAfterHours) || 48), delistAfterHours: Math.max(1, Number(policy?.delistAfterHours) || 72), suspendAfterHours: Math.max(1, Number(policy?.suspendAfterHours) || 168) };
    saveConfigOnly(); audit('offline-policy.updated', 'success', null, 'Community server offline thresholds updated.'); return privatePayload();
  });
  electron.ipcMain.handle('server-directory:evaluate-offline', () => {
    if (!canReviewCommunity()) throw new Error('Offline enforcement requires staff access.');
    const actions = [];
    for (const record of records().filter((item) => item.ownerType === 'community')) {
      const result = offlinePolicy(record, Date.now(), directory().offlinePolicy);
      if (result.action === 'delist' && record.applicationState === 'listed') transition(record.id, 'delisted', result.reason);
      if (result.action === 'suspend' && !['denied', 'suspended'].includes(record.applicationState)) transition(record.id, 'suspended', result.reason);
      if (result.action !== 'none') actions.push({ id: record.id, serverName: record.serverName, ...result });
    }
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
      this.webContents.executeJavaScript(`(() => { if (!document.querySelector('link[href="server-directory.css"]')) { const link=document.createElement('link'); link.rel='stylesheet'; link.href='server-directory.css'; document.head.appendChild(link); } if (!document.querySelector('script[src="server-directory.js"]')) { const script=document.createElement('script'); script.src='server-directory.js'; script.defer=true; document.body.appendChild(script); } })();`).catch((error) => refs.logger?.warn?.('Server directory renderer bootstrap failed.', { message: error.message }));
    });
    return original.apply(this, args);
  };
  Object.defineProperty(prototype, '__khaosServerDirectoryUiPatched', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  patchBrowserLoader();
  electron.app.whenReady().then(() => { const wait = () => refs.configStore ? registerIpc() : setTimeout(wait, 100); wait(); }).catch((error) => console.error('[Khaos Nexus] Server directory initialization failed.', error));
}

module.exports = { install, refs, ensureConfig, privatePayload, publicPayload };
