'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const solo = require('../shared/dnd-solo-combat.cjs');

const refs = { configStore: null, autonomy: null, discordAuth: null, supervisor: null, logger: null };
let installed = false;
let registered = false;
let timer = null;

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const actorId = () => String(refs.discordAuth?.getState?.().user?.id || 'local-owner');
const currentRole = () => {
  try { return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'locked'; }
  catch { return 'locked'; }
};
function assertOwner(action) {
  if (refs.autonomy?.assertAccess) return refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), 'owner', action);
  if (!['owner', 'local-admin'].includes(currentRole())) throw Object.assign(new Error(`${action} requires Khaos Nexus Owner access.`), { code: 'OWNER_ACCESS_REQUIRED' });
  return true;
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDndSoloCombat) return;
  class DndSoloCombatStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      this.mutateDnd((state) => { solo.ensureSoloCombatState(state); return true; });
      scheduleRegister();
    }
    mutateSoloCombat(mutator) {
      return this.mutateDnd((state) => { solo.ensureSoloCombatState(state); return mutator(state); });
    }
  }
  Object.defineProperty(DndSoloCombatStore, '__khaosDndSoloCombat', { value: true });
  target.ConfigStore = DndSoloCombatStore;
}
function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosDndSoloCombatCapture) return;
  class Captured extends Original {
    constructor(...args) { super(...args); refs[refName] = this; scheduleRegister(); }
  }
  Object.defineProperty(Captured, '__khaosDndSoloCombatCapture', { value: true });
  target[exportName] = Captured;
}

function payload(campaignId = '') {
  const state = refs.configStore.getDndState();
  solo.ensureSoloCombatState(state);
  const selected = String(campaignId || '').trim() || state.campaigns?.find((item) => item.active !== false)?.id || '';
  const filter = (list) => clone((list || []).filter((item) => !selected || item.campaignId === selected));
  const combats = filter(state.runtimeCombats);
  return {
    role: currentRole(), selectedCampaignId: selected,
    characters: filter(state.characters).filter((item) => item.active !== false).map((item) => ({ id: item.id, name: item.name, hp: item.hp, maxHp: item.maxHp, armorClass: item.armorClass, level: item.level, className: item.className })),
    seats: filter(state.playerSeats).filter((item) => item.active !== false), profiles: filter(state.playProfiles),
    adventures: filter(state.soloAdventures), runs: filter(state.campaignRuns), scenes: filter(state.scenes),
    activeCombat: combats.find((item) => item.status === 'active') || null,
    recentCombats: combats.filter((item) => item.status !== 'active').slice(-10),
    memories: filter(state.runtimeMemories).slice(-100),
    policy: { privateDevelopmentOnly: false, releaseAuthorized: true, automaticDiscordPublication: false }
  };
}
function push(campaignId = '') {
  refs.supervisor?.pushDndConfig?.();
  const next = payload(campaignId);
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('dnd:solo-combat-update', next);
  }
  return next;
}
function mutate(action, input, fn) {
  let result;
  refs.configStore.mutateSoloCombat((state) => { result = fn(state); return true; });
  refs.configStore.appendDndAudit?.({
    action: `solo-combat.${action}`, outcome: 'success', actorId: actorId(),
    campaignId: String(input?.campaignId || result?.campaignId || result?.combat?.campaignId || '').slice(0, 100),
    targetId: String(result?.id || result?.combat?.id || input?.combatId || '').slice(0, 100),
    metadata: { privateDevelopmentOnly: false, releaseAuthorized: true }
  });
  return result;
}

function buildCombatants(state, input) {
  const result = [];
  const scene = state.scenes.find((item) => item.id === input.sceneId && item.campaignId === input.campaignId);
  const requestedSeats = new Set((input.seatIds?.length ? input.seatIds : scene?.participantSeatIds || []).map(String));
  for (const seat of state.playerSeats.filter((item) => item.campaignId === input.campaignId && item.active !== false && requestedSeats.has(item.id))) {
    const character = state.characters.find((item) => item.id === seat.characterId && item.campaignId === input.campaignId);
    if (!character) continue;
    result.push({
      seatId: seat.id, characterId: character.id, name: character.name,
      actorType: seat.type === 'ai_companion' ? 'companion' : 'player',
      hp: character.hp, maxHp: character.maxHp, armorClass: character.armorClass,
      initiativeModifier: character.initiativeModifier || 0,
      savingThrows: character.savingThrows || {}, spellSlots: character.spellSlots || {}, conditions: character.conditions || []
    });
  }
  for (const enemy of input.enemies || []) result.push({ ...enemy, actorType: enemy.actorType || 'enemy' });
  return result;
}

function registerHandlers() {
  if (registered || !refs.configStore || !refs.autonomy || !refs.discordAuth) return false;
  registered = true;
  const ipc = electron.ipcMain;
  ipc.handle('dnd:solo-combat-get', (_event, input = {}) => { assertOwner('View D&D solo and combat runtime'); return payload(input.campaignId); });
  ipc.handle('dnd:solo-adventure-start', (_event, input = {}) => {
    assertOwner('Start solo adventure');
    const result = mutate('adventure-started', input, (state) => solo.startSoloAdventure(state, { ...input, actorId: actorId() }));
    return { ...result, state: push(input.campaignId) };
  });
  ipc.handle('dnd:solo-memory-save', (_event, input = {}) => {
    assertOwner('Save D&D campaign memory');
    const memory = mutate('memory-saved', input, (state) => solo.recordMemory(state, input));
    return { memory, state: push(input.campaignId) };
  });
  ipc.handle('dnd:combat-start', (_event, input = {}) => {
    assertOwner('Start deterministic D&D combat');
    const result = mutate('combat-started', input, (state) => solo.startCombat(state, { ...input, actorId: actorId(), combatants: buildCombatants(state, input) }));
    return { ...result, state: push(input.campaignId) };
  });
  ipc.handle('dnd:combat-attack', (_event, input = {}) => {
    assertOwner('Resolve D&D combat attack');
    const result = mutate('attack-resolved', input, (state) => solo.resolveAttack(state, input));
    return { ...result, state: push(input.campaignId) };
  });
  ipc.handle('dnd:combat-action', (_event, input = {}) => {
    assertOwner('Resolve D&D combat action');
    const result = mutate('action-resolved', input, (state) => solo.useCombatAction(state, input));
    return { result, state: push(input.campaignId) };
  });
  ipc.handle('dnd:combat-spell', (_event, input = {}) => {
    assertOwner('Resolve D&D spell resource use');
    const result = mutate('spell-resolved', input, (state) => solo.castSpell(state, input));
    return { result, state: push(input.campaignId) };
  });
  ipc.handle('dnd:combat-end-turn', (_event, input = {}) => {
    assertOwner('End D&D combat turn');
    const result = mutate('turn-ended', input, (state) => solo.endTurn(state, input));
    return { result, state: push(input.campaignId) };
  });
  ipc.handle('dnd:combat-death-save', (_event, input = {}) => {
    assertOwner('Resolve D&D death save');
    const result = mutate('death-save-resolved', input, (state) => solo.resolveDeathSave(state, input));
    return { result, state: push(input.campaignId) };
  });
  ipc.handle('dnd:combat-end', (_event, input = {}) => {
    assertOwner('End D&D combat');
    if (input.confirmed !== true) throw Object.assign(new Error('Confirm before ending combat.'), { code: 'CONFIRMATION_REQUIRED' });
    const result = mutate('combat-ended', input, (state) => solo.endCombat(state, { ...input, actorId: actorId() }));
    return { ...result, state: push(input.campaignId) };
  });
  return true;
}
function scheduleRegister() {
  clearTimeout(timer);
  timer = setTimeout(() => { if (!registerHandlers()) scheduleRegister(); }, 100);
  timer.unref?.();
}
function installRendererAssets() {
  const cssPath = path.join(__dirname, '..', 'renderer', 'dnd-solo-combat.css');
  const jsPath = path.join(__dirname, '..', 'renderer', 'dnd-solo-combat.js');
  electron.app.on('browser-window-created', (_event, window) => window.webContents.on('did-finish-load', async () => {
    try {
      await window.webContents.insertCSS(fs.readFileSync(cssPath, 'utf8'));
      await window.webContents.executeJavaScript(fs.readFileSync(jsPath, 'utf8'), true);
    } catch (error) { refs.logger?.error?.('D&D solo/combat assets failed to load.', { message: error.message }); }
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

module.exports = { install, payload, releaseAuthorized: true };
