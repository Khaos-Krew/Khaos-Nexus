'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const {
  ensureEncounterPanelCollections,
  savePanel,
  saveTurnAction,
  removeTurnAction
} = require('../shared/dnd-encounter-panels.cjs');
const { advanceEncounter } = require('../shared/dnd-owner-workflows.cjs');

const refs = { configStore: null, supervisor: null, autonomy: null, discordAuth: null, logger: null };
let installed = false;
let registered = false;
let timer = null;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function nowIso() { return new Date().toISOString(); }
function actorId() { return String(refs.discordAuth?.getState?.().user?.id || 'local-owner'); }
function currentRole() {
  try { return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'locked'; }
  catch { return 'locked'; }
}
function assertOwner(action) {
  if (refs.autonomy?.assertAccess) return refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), 'owner', action);
  if (!['owner', 'local-admin'].includes(currentRole())) throw Object.assign(new Error(`${action} requires Khaos Nexus Owner access.`), { code: 'OWNER_ACCESS_REQUIRED' });
  return true;
}
function ensureEncounter(state, encounterId, campaignId = '') {
  const encounter = (state.encounters || []).find((item) => item.id === encounterId && (!campaignId || item.campaignId === campaignId));
  if (!encounter) throw Object.assign(new Error('Encounter was not found.'), { code: 'DND_ENCOUNTER_NOT_FOUND' });
  return encounter;
}
function payload() {
  const state = refs.configStore.getDndState();
  ensureEncounterPanelCollections(state);
  return {
    role: currentRole(),
    state,
    bot: refs.supervisor?.getState?.() || null,
    policy: {
      oneMessagePerEncounterBinding: true,
      automaticDamage: false,
      hiddenDataFiltered: true,
      actionLimit: 25,
      componentLimit: 20
    }
  };
}
function push() {
  refs.supervisor?.pushDndConfig?.();
  const value = payload();
  for (const window of electron.BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('dnd:encounter-panel-update', value);
}
function audit(action, value = {}, metadata = {}) {
  const entry = refs.configStore.appendDndAudit({ action, outcome: 'success', actorId: actorId(), campaignId: value.campaignId, targetId: value.id, metadata });
  refs.logger?.write?.('info', `D&D: ${action}`, { campaignId: entry.campaignId, targetId: entry.targetId }, 'dnd');
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDndEncounterPanelsPatched) return;
  class DndEncounterPanelsConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      this.mutateDnd((state) => { ensureEncounterPanelCollections(state); return true; });
      scheduleRegister();
    }

    saveDndEncounterPanel(input) {
      return this.mutateDnd((state) => {
        ensureEncounterPanelCollections(state);
        ensureEncounter(state, input.encounterId, input.campaignId);
        if (input.bindingId) {
          const binding = (state.bindings || []).find((item) => item.id === input.bindingId && item.campaignId === input.campaignId && item.active !== false);
          if (!binding) throw Object.assign(new Error('The selected Discord binding is not active for this campaign.'), { code: 'DND_BINDING_NOT_FOUND' });
          input.appId = binding.appId;
          input.guildId = binding.guildId;
        }
        return savePanel(state, input);
      });
    }

    saveDndEncounterTurnAction(input) {
      return this.mutateDnd((state) => {
        ensureEncounterPanelCollections(state);
        ensureEncounter(state, input.encounterId, input.campaignId);
        return saveTurnAction(state, input);
      });
    }

    removeDndEncounterTurnAction(actionId) {
      return this.mutateDnd((state) => removeTurnAction(state, actionId));
    }

    patchDndCombatant(input) {
      return this.mutateDnd((state) => {
        const combatant = (state.combatants || []).find((item) => item.id === input.combatantId && item.encounterId === input.encounterId);
        if (!combatant) throw Object.assign(new Error('Combatant was not found in this encounter.'), { code: 'DND_COMBATANT_NOT_FOUND' });
        if (Object.prototype.hasOwnProperty.call(input, 'hp')) {
          const hp = Math.trunc(Number(input.hp));
          if (!Number.isFinite(hp) || hp < 0 || combatant.maxHp !== null && combatant.maxHp !== undefined && hp > combatant.maxHp) throw Object.assign(new Error('Combatant HP is invalid.'), { code: 'DND_COMBATANT_HP_INVALID' });
          combatant.hp = hp;
        }
        if (Object.prototype.hasOwnProperty.call(input, 'maxHp')) {
          const maxHp = Math.trunc(Number(input.maxHp));
          if (!Number.isFinite(maxHp) || maxHp < 0 || combatant.hp !== null && combatant.hp !== undefined && combatant.hp > maxHp) throw Object.assign(new Error('Combatant maximum HP is invalid.'), { code: 'DND_COMBATANT_HP_INVALID' });
          combatant.maxHp = maxHp;
        }
        if (Object.prototype.hasOwnProperty.call(input, 'conditions')) {
          combatant.conditions = [...new Set((Array.isArray(input.conditions) ? input.conditions : String(input.conditions || '').split(',')).map((item) => String(item || '').trim().slice(0, 80)).filter(Boolean))];
        }
        combatant.updatedAt = nowIso();
        for (const panel of state.encounterPanels.filter((item) => item.encounterId === combatant.encounterId && item.autoRefresh)) panel.requestedAt = nowIso(), panel.updatedAt = nowIso();
        return clone(combatant);
      });
    }

    advanceDndEncounterPanel(input) {
      return this.mutateDnd((state) => {
        const result = advanceEncounter(state, input.encounterId);
        for (const panel of state.encounterPanels.filter((item) => item.encounterId === input.encounterId && item.autoRefresh)) panel.requestedAt = nowIso(), panel.updatedAt = nowIso();
        return clone(result);
      });
    }

    applyDndMutation(input = {}) {
      if (input.operation === 'encounter-panel.upsert') {
        return this.mutateDnd((state) => savePanel(state, input.data || {}));
      }
      if (input.operation === 'encounter-panel.stale') {
        return this.mutateDnd((state) => {
          ensureEncounterPanelCollections(state);
          const panel = state.encounterPanels.find((item) => item.id === input.data?.id || item.panelToken === input.data?.panelToken);
          if (!panel) return null;
          panel.status = 'stale';
          panel.lastError = String(input.data?.lastError || '').slice(0, 1000);
          panel.staleReason = String(input.data?.staleReason || 'Discord message or binding unavailable.').slice(0, 500);
          panel.updatedAt = nowIso();
          return clone(panel);
        });
      }
      return super.applyDndMutation(input);
    }
  }
  Object.defineProperty(DndEncounterPanelsConfigStore, '__khaosDndEncounterPanelsPatched', { value: true });
  target.ConfigStore = DndEncounterPanelsConfigStore;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosDndEncounterPanelsCapture) return;
  class Captured extends Original {
    constructor(...args) { super(...args); refs[refName] = this; scheduleRegister(); }
  }
  Object.defineProperty(Captured, '__khaosDndEncounterPanelsCapture', { value: true });
  target[exportName] = Captured;
}

function registerHandlers() {
  if (registered || !refs.configStore || !refs.autonomy || !refs.discordAuth) return false;
  registered = true;
  const ipc = electron.ipcMain;

  ipc.handle('dnd:encounter-panels-get', () => { assertOwner('View encounter panels'); return payload(); });
  ipc.handle('dnd:encounter-panel-save', (_event, input = {}) => {
    assertOwner('Configure an encounter panel');
    const panel = refs.configStore.saveDndEncounterPanel(input);
    audit('encounter-panel.saved', panel, { bindingId: panel.bindingId, healthMode: panel.healthMode, actionRevision: panel.actionRevision });
    push();
    return { panel, state: payload() };
  });
  ipc.handle('dnd:encounter-panel-request', (_event, input = {}) => {
    assertOwner('Publish or refresh an encounter panel');
    const current = refs.configStore.getDndState();
    ensureEncounterPanelCollections(current);
    const existing = current.encounterPanels.find((item) => item.id === input.panelId);
    if (!existing) throw Object.assign(new Error('Encounter panel was not found.'), { code: 'DND_ENCOUNTER_PANEL_NOT_FOUND' });
    const panel = refs.configStore.saveDndEncounterPanel({ ...existing, status: 'active', requestedAt: nowIso(), lastError: '', staleReason: '' });
    audit('encounter-panel.publish-requested', panel, { repair: Boolean(input.repair), bindingId: panel.bindingId });
    push();
    return { panel, state: payload() };
  });
  ipc.handle('dnd:encounter-panel-end', (_event, input = {}) => {
    assertOwner('End an encounter panel');
    const current = refs.configStore.getDndState();
    ensureEncounterPanelCollections(current);
    const existing = current.encounterPanels.find((item) => item.id === input.panelId);
    if (!existing) throw Object.assign(new Error('Encounter panel was not found.'), { code: 'DND_ENCOUNTER_PANEL_NOT_FOUND' });
    const panel = refs.configStore.saveDndEncounterPanel({ ...existing, status: 'completed', requestedAt: nowIso() });
    audit('encounter-panel.ended', panel);
    push();
    return { panel, state: payload() };
  });
  ipc.handle('dnd:encounter-action-save', (_event, input = {}) => {
    assertOwner('Configure encounter turn actions');
    const action = refs.configStore.saveDndEncounterTurnAction(input);
    audit('encounter-action.saved', action, { rollType: action.rollType, privacy: action.privacy, revision: action.revision });
    push();
    return { action, state: payload() };
  });
  ipc.handle('dnd:encounter-action-remove', (_event, input = {}) => {
    assertOwner('Remove encounter turn actions');
    const action = refs.configStore.removeDndEncounterTurnAction(String(input.actionId || ''));
    audit('encounter-action.removed', action, { revision: action.revision });
    push();
    return { action, state: payload() };
  });
  ipc.handle('dnd:encounter-combatant-patch', (_event, input = {}) => {
    assertOwner('Adjust encounter combatant state');
    const combatant = refs.configStore.patchDndCombatant(input);
    audit('encounter-combatant.patched', combatant, { encounterId: combatant.encounterId, hp: combatant.hp, maxHp: combatant.maxHp, conditions: combatant.conditions });
    push();
    return { combatant, state: payload() };
  });
  ipc.handle('dnd:encounter-panel-advance', (_event, input = {}) => {
    assertOwner('Advance encounter initiative');
    const result = refs.configStore.advanceDndEncounterPanel(input);
    audit('encounter-panel.initiative-advanced', result.encounter, { round: result.encounter.round, currentTurnIndex: result.encounter.currentTurnIndex, currentCombatantId: result.currentCombatant?.id || '' });
    push();
    return { result, state: payload() };
  });
  return true;
}

function scheduleRegister() {
  clearTimeout(timer);
  timer = setTimeout(() => { if (!registerHandlers()) scheduleRegister(); }, 100);
  timer.unref?.();
}
function installRendererAssets() {
  const cssPath = path.join(__dirname, '..', 'renderer', 'dnd-encounter-panels.css');
  const jsPath = path.join(__dirname, '..', 'renderer', 'dnd-encounter-panels.js');
  electron.app.on('browser-window-created', (_event, window) => window.webContents.on('did-finish-load', async () => {
    try {
      await window.webContents.insertCSS(fs.readFileSync(cssPath, 'utf8'));
      await window.webContents.executeJavaScript(fs.readFileSync(jsPath, 'utf8'), true);
    } catch (error) {
      refs.logger?.error?.('D&D encounter panel assets failed to load.', { message: error.message });
    }
  }));
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

module.exports = { install, payload };
