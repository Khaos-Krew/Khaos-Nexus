'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const { normalizeAttendance } = require('../shared/dnd-discord.cjs');
const {
  normalizeSource,
  normalizeQuest,
  activateQuest,
  saveEncounter,
  saveCombatant,
  removeCombatant,
  advanceEncounter
} = require('../shared/dnd-owner-workflows.cjs');

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

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDndOwnerWorkflowsPatched) return;
  class DndOwnerWorkflowConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      scheduleRegister();
    }

    existingDndItem(collection, input = {}) {
      if (!input.id) return null;
      return this.getDndState()[collection]?.find((item) => item.id === input.id) || null;
    }

    upsertDndCampaign(input) {
      const value = super.upsertDndCampaign(input);
      if (!Object.prototype.hasOwnProperty.call(input, 'activeQuestId')) return value;
      return this.mutateDnd((state) => {
        const result = activateQuest(state, value.id, value.activeQuestId);
        return clone(result.campaign);
      });
    }

    upsertDndSource(input) {
      const existing = this.existingDndItem('sources', input);
      return this.upsertDndItem('sources', { ...existing, ...input }, normalizeSource);
    }

    upsertDndQuest(input) {
      const existing = this.existingDndItem('quests', input);
      return this.upsertDndItem('quests', { ...existing, ...input }, normalizeQuest);
    }

    upsertDndEncounter(input) {
      const existing = this.existingDndItem('encounters', input);
      return this.mutateDnd((state) => saveEncounter(state, { ...existing, ...input }));
    }

    upsertDndCombatant(input) {
      const existing = this.existingDndItem('combatants', input);
      return this.mutateDnd((state) => saveCombatant(state, { ...existing, ...input }));
    }

    upsertDndAttendance(input) {
      if (!input.userId && !input.discordUserId) {
        const error = new Error('Attendance requires a linked Nexus user or Discord user.');
        error.code = 'DND_ATTENDANCE_IDENTITY_REQUIRED';
        throw error;
      }
      return this.mutateDnd((state) => {
        const index = state.attendance.findIndex((item) =>
          item.id === input.id || item.sessionId === input.sessionId && (
            input.userId && item.userId === input.userId ||
            input.discordUserId && item.discordUserId === input.discordUserId
          )
        );
        const existing = index >= 0 ? state.attendance[index] : null;
        const value = normalizeAttendance({ ...existing, ...input, id: existing?.id || input.id });
        if (index >= 0) state.attendance[index] = value;
        else state.attendance.push(value);
        return clone(value);
      });
    }

    removeDndCombatant(input) { return this.mutateDnd((state) => removeCombatant(state, input.combatantId)); }
    advanceDndEncounter(input) { return this.mutateDnd((state) => clone(advanceEncounter(state, input.encounterId))); }
  }
  Object.defineProperty(DndOwnerWorkflowConfigStore, '__khaosDndOwnerWorkflowsPatched', { value: true });
  target.ConfigStore = DndOwnerWorkflowConfigStore;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosDndOwnerWorkflowCapture) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
      scheduleRegister();
    }
  }
  Object.defineProperty(Captured, '__khaosDndOwnerWorkflowCapture', { value: true });
  target[exportName] = Captured;
}

function registerHandlers() {
  if (registered || !refs.configStore || !refs.supervisor || !refs.autonomy || !refs.discordAuth) return false;
  registered = true;
  const ipc = electron.ipcMain;

  ipc.handle('dnd:source-save', (_event, input = {}) => {
    assertOwner('Manage D&D source metadata');
    const value = refs.configStore.upsertDndSource(input);
    audit('source.saved', value, { licenseType: value.licenseType, isFullTextAllowed: value.isFullTextAllowed });
    pushConfig();
    return payload();
  });

  ipc.handle('dnd:quest-save', (_event, input = {}) => {
    assertOwner('Manage D&D quests');
    const value = refs.configStore.upsertDndQuest(input);
    audit('quest.saved', value, { status: value.status, visibleToPlayers: value.visibleToPlayers });
    pushConfig();
    return payload();
  });

  ipc.handle('dnd:encounter-save', (_event, input = {}) => {
    assertOwner('Manage D&D encounters');
    const value = refs.configStore.upsertDndEncounter(input);
    audit('encounter.saved', value, { status: value.status, sessionId: value.sessionId });
    pushConfig();
    return payload();
  });

  ipc.handle('dnd:combatant-save', (_event, input = {}) => {
    assertOwner('Manage D&D initiative combatants');
    const value = refs.configStore.upsertDndCombatant(input);
    audit('combatant.saved', value, { encounterId: value.encounterId, hidden: value.hidden });
    pushConfig();
    return payload();
  });

  ipc.handle('dnd:combatant-remove', (_event, input = {}) => {
    assertOwner('Remove a D&D initiative combatant');
    const value = refs.configStore.removeDndCombatant(input);
    audit('combatant.removed', value, { encounterId: value.encounterId });
    pushConfig();
    return payload();
  });

  ipc.handle('dnd:encounter-advance', (_event, input = {}) => {
    assertOwner('Advance D&D initiative');
    const result = refs.configStore.advanceDndEncounter(input);
    audit('initiative.advanced', result.encounter, {
      round: result.encounter.round,
      currentTurnIndex: result.encounter.currentTurnIndex,
      currentCombatantId: result.currentCombatant?.id || ''
    });
    pushConfig();
    return { result, state: payload() };
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
  const cssPath = path.join(__dirname, '..', 'renderer', 'dnd-owner-workflows.css');
  const jsPath = path.join(__dirname, '..', 'renderer', 'dnd-owner-workflows.js');
  const attendancePath = path.join(__dirname, '..', 'renderer', 'dnd-owner-attendance-stability.js');
  electron.app.on('browser-window-created', (_event, window) => {
    window.webContents.on('did-finish-load', async () => {
      try {
        await window.webContents.insertCSS(fs.readFileSync(cssPath, 'utf8'));
        await window.webContents.executeJavaScript(fs.readFileSync(jsPath, 'utf8'), true);
        await window.webContents.executeJavaScript(fs.readFileSync(attendancePath, 'utf8'), true);
      } catch (error) {
        refs.logger?.error?.('D&D Owner workflow assets failed to load.', { message: error.message });
      }
    });
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

module.exports = { install };
