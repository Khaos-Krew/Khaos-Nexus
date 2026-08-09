'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const { registerRendererBundle } = require('./renderer-asset-loader.cjs');
const {
  ensureWorldCollections,
  normalizeWorldRecord,
  normalizeLoot,
  normalizeContentEntry,
  saveHomebrew,
  createDesktopRoll
} = require('../shared/dnd-world-content.cjs');

const refs = { configStore: null, supervisor: null, autonomy: null, discordAuth: null, logger: null };
let installed = false;
let registered = false;
let timer = null;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function actorId() { return String(refs.discordAuth?.getState?.().user?.id || 'local-owner'); }
function currentRole() {
  try { return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'locked'; }
  catch { return 'locked'; }
}
function assertOwner(action) {
  if (refs.autonomy?.assertAccess) return refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), 'owner', action);
  if (!['owner', 'local-admin'].includes(currentRole())) {
    const error = new Error(`${action} requires Khaos Nexus Owner access.`);
    error.code = 'OWNER_ACCESS_REQUIRED';
    throw error;
  }
  return true;
}

function payload() {
  return {
    role: currentRole(),
    state: refs.configStore.getDndState(),
    registeredApps: refs.configStore.getRegisteredAppsPublic(),
    bot: refs.supervisor?.getState?.() || null,
    policy: {
      defaultSetupMode: 'none',
      categoryCreationEnabled: false,
      fullCampaignCategoryStatus: 'planned',
      message: 'Khaos Nexus will not automatically generate categories or extra campaign channels.'
    }
  };
}

function pushConfig() {
  refs.supervisor?.pushDndConfig?.();
  const value = payload();
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('dnd:update', value);
  }
}

function audit(action, value, metadata = {}) {
  const entry = refs.configStore.appendDndAudit({
    action,
    outcome: 'success',
    actorId: actorId(),
    campaignId: value?.campaignId,
    targetId: value?.id,
    metadata
  });
  refs.logger?.write?.('info', `D&D: ${action}`, { campaignId: entry.campaignId, targetId: entry.targetId }, 'dnd');
}

function collectionForWorldType(type) {
  if (type === 'npc') return 'npcs';
  if (type === 'location') return 'locations';
  if (type === 'faction') return 'factions';
  throw Object.assign(new Error('World record type is invalid.'), { code: 'DND_WORLD_TYPE_INVALID' });
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDndWorldContentPatched) return;
  class DndWorldContentConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      this.mutateDnd((state) => clone(ensureWorldCollections(state)));
      scheduleRegister();
    }

    existingDndWorldItem(collection, input = {}) {
      if (!input.id) return null;
      return this.getDndState()[collection]?.find((item) => item.id === input.id) || null;
    }

    upsertDndWorld(type, input) {
      const collection = collectionForWorldType(type);
      const existing = this.existingDndWorldItem(collection, input);
      return this.upsertDndItem(collection, { ...existing, ...input }, (value) => normalizeWorldRecord(type, value));
    }

    upsertDndLoot(input) {
      const existing = this.existingDndWorldItem('loot', input);
      return this.upsertDndItem('loot', { ...existing, ...input }, normalizeLoot);
    }

    upsertDndContentEntry(input) {
      return this.mutateDnd((state) => {
        ensureWorldCollections(state);
        const existing = input.id ? state.contentEntries.find((item) => item.id === input.id) || null : null;
        const value = normalizeContentEntry(state, { ...existing, ...input });
        const index = state.contentEntries.findIndex((item) => item.id === value.id);
        if (index >= 0) state.contentEntries[index] = value;
        else state.contentEntries.push(value);
        return clone(value);
      });
    }

    saveDndHomebrew(input) {
      return this.mutateDnd((state) => clone(saveHomebrew(state, input, actorId())));
    }

    createDndDesktopRoll(input) {
      return this.mutateDnd((state) => createDesktopRoll(state, input, actorId()));
    }
  }
  Object.defineProperty(DndWorldContentConfigStore, '__khaosDndWorldContentPatched', { value: true });
  target.ConfigStore = DndWorldContentConfigStore;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosDndWorldContentCapture) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
      scheduleRegister();
    }
  }
  Object.defineProperty(Captured, '__khaosDndWorldContentCapture', { value: true });
  target[exportName] = Captured;
}

function registerHandlers() {
  if (registered || !refs.configStore || !refs.supervisor || !refs.autonomy || !refs.discordAuth) return false;
  registered = true;
  const ipc = electron.ipcMain;

  ipc.handle('dnd:world-save', (_event, input = {}) => {
    assertOwner('Manage D&D world records');
    const value = refs.configStore.upsertDndWorld(String(input.type || ''), input);
    audit(`${value.type}.saved`, value, { revealed: value.revealed });
    pushConfig();
    return payload();
  });

  ipc.handle('dnd:loot-save', (_event, input = {}) => {
    assertOwner('Manage D&D loot');
    const value = refs.configStore.upsertDndLoot(input);
    audit('loot.saved', value, { quantity: value.quantity, shared: value.shared, gmOnly: value.gmOnly, assignedCharacterId: value.assignedCharacterId });
    pushConfig();
    return payload();
  });

  ipc.handle('dnd:content-save', (_event, input = {}) => {
    assertOwner('Manage D&D content metadata');
    const value = refs.configStore.upsertDndContentEntry(input);
    audit('content.saved', value, { sourceId: value.sourceId, contentOrigin: value.contentOrigin, contentHash: value.contentHash, hasFullText: Boolean(value.fullText) });
    pushConfig();
    return payload();
  });

  ipc.handle('dnd:homebrew-save', (_event, input = {}) => {
    assertOwner('Manage D&D homebrew');
    const result = refs.configStore.saveDndHomebrew(input);
    audit(result.createdRevision ? 'homebrew.revision-created' : 'homebrew.saved', result.record, {
      status: result.record.status,
      revision: result.record.revision,
      previousId: result.previousId
    });
    pushConfig();
    return payload();
  });

  ipc.handle('dnd:dice-roll', (_event, input = {}) => {
    assertOwner('Roll D&D dice from the desktop');
    const value = refs.configStore.createDndDesktopRoll(input);
    audit('dice.rolled', value, { expression: value.normalizedExpression, total: value.total, privacy: value.privacy, source: 'desktop' });
    pushConfig();
    return { roll: value, state: payload() };
  });

  return true;
}

function scheduleRegister() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!registerHandlers()) scheduleRegister();
  }, 100);
  timer.unref?.();
}

function installRendererAssets() {
  registerRendererBundle({
    id: 'dnd-world-content',
    styles: [path.join(__dirname, '..', 'renderer', 'dnd-world-content.css')],
    scripts: [path.join(__dirname, '..', 'renderer', 'dnd-world-content.js')],
    source: 'dnd-world-content-extension.cjs'
  });
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  captureClass('./services/bot-supervisor.cjs', 'BotSupervisor', 'supervisor');
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  installRendererAssets();
  scheduleRegister();
}

module.exports = { install, collectionForWorldType };
