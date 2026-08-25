'use strict';

const fs = require('node:fs');
const path = require('node:path');

function emptyState() {
  return {
    consoles: {},
    moduleSetups: {},
    tempLobbies: {},
    accessRoles: {},
    roleMenu: null,
    selfRoleMenus: {},
    roadmapPatchNotes: {},
    suggestions: {},
    suggestionMeta: { nextNumber: 1, channelId: '', panelMessageId: '' },
    adminSettings: { rankRoles: {}, rankSkus: {}, moduleEnabled: {} }
  };
}

class StateStore {
  constructor(root = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..')) {
    this.dir = process.env.NEXUS_DATA_DIR ? path.resolve(root) : path.join(root, 'data');
    this.file = path.join(this.dir, 'sentinal-state.json');
    this.legacyFile = path.join(this.dir, 'sentinel-state.json');
  }

  read() {
    let state = null;
    for (const file of [this.file, this.legacyFile]) {
      try { state = JSON.parse(fs.readFileSync(file, 'utf8')); break; } catch {}
    }
    state ||= emptyState();
    state.consoles ||= {};
    state.moduleSetups ||= {};
    state.tempLobbies ||= {};
    state.accessRoles ||= {};
    state.roleMenu ??= null;
    state.selfRoleMenus ||= {};
    state.roadmapPatchNotes ||= {};
    state.suggestions ||= {};
    state.suggestionMeta ||= { nextNumber: 1, channelId: '', panelMessageId: '' };
    state.suggestionMeta.nextNumber = Math.max(1, Number(state.suggestionMeta.nextNumber) || 1);
    state.suggestionMeta.channelId ||= '';
    state.suggestionMeta.panelMessageId ||= '';
    state.adminSettings ||= {};
    state.adminSettings.rankRoles ||= {};
    state.adminSettings.rankSkus ||= {};
    state.adminSettings.moduleEnabled ||= {};
    return state;
  }

  write(state) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, this.file);
  }

  getConsole(moduleId) { return this.read().consoles?.[moduleId] || null; }
  setConsole(moduleId, value) {
    const state = this.read();
    state.consoles[moduleId] = value;
    this.write(state);
    return value;
  }

  getModuleSetup(moduleId) { return this.read().moduleSetups?.[moduleId] || null; }
  listModuleSetups() { return { ...this.read().moduleSetups }; }
  setModuleSetup(moduleId, value) {
    const state = this.read();
    state.moduleSetups[moduleId] = value;
    this.write(state);
    return value;
  }

  getAccessRole(moduleId) { return this.read().accessRoles?.[moduleId] || null; }
  listAccessRoles() { return { ...this.read().accessRoles }; }
  setAccessRole(moduleId, value) {
    const state = this.read();
    state.accessRoles[moduleId] = value;
    this.write(state);
    return value;
  }

  getRoleMenu() { return this.read().roleMenu || null; }
  setRoleMenu(value) {
    const state = this.read();
    state.roleMenu = value;
    this.write(state);
    return value;
  }

  getSelfRoleMenu(menuId) { return this.read().selfRoleMenus?.[menuId] || null; }
  listSelfRoleMenus() { return { ...this.read().selfRoleMenus }; }
  setSelfRoleMenu(menuId, value) {
    const state = this.read();
    state.selfRoleMenus[menuId] = value;
    this.write(state);
    return value;
  }

  getRoadmapPatchNote(key) { return this.read().roadmapPatchNotes?.[key] || null; }
  listRoadmapPatchNotes() { return { ...this.read().roadmapPatchNotes }; }
  setRoadmapPatchNote(key, value) {
    const state = this.read();
    state.roadmapPatchNotes[key] = value;
    this.write(state);
    return value;
  }

  getSuggestion(id) { return this.read().suggestions?.[id] || null; }
  listSuggestions() { return JSON.parse(JSON.stringify(this.read().suggestions || {})); }
  setSuggestion(id, value) {
    const state = this.read();
    state.suggestions[id] = value;
    this.write(state);
    return value;
  }
  getSuggestionMeta() { return JSON.parse(JSON.stringify(this.read().suggestionMeta)); }
  setSuggestionMeta(value = {}) {
    const state = this.read();
    state.suggestionMeta = {
      nextNumber: Math.max(1, Number(value.nextNumber) || Number(state.suggestionMeta?.nextNumber) || 1),
      channelId: String(value.channelId ?? state.suggestionMeta?.channelId ?? ''),
      panelMessageId: String(value.panelMessageId ?? state.suggestionMeta?.panelMessageId ?? '')
    };
    this.write(state);
    return this.getSuggestionMeta();
  }
  allocateSuggestionId() {
    const state = this.read();
    const number = Math.max(1, Number(state.suggestionMeta?.nextNumber) || 1);
    const id = `SUG-${String(number).padStart(4, '0')}`;
    state.suggestionMeta.nextNumber = number + 1;
    this.write(state);
    return { id, number };
  }

  getAdminSettings() {
    const settings = this.read().adminSettings;
    return JSON.parse(JSON.stringify(settings));
  }

  setAdminSettings(value = {}) {
    const state = this.read();
    state.adminSettings = {
      rankRoles: { ...(value.rankRoles || {}) },
      rankSkus: Object.fromEntries(Object.entries(value.rankSkus || {}).map(([key, items]) => [key, Array.isArray(items) ? [...items] : []])),
      moduleEnabled: { ...(value.moduleEnabled || {}) }
    };
    this.write(state);
    return this.getAdminSettings();
  }

  getTempLobby(channelId) { return this.read().tempLobbies?.[channelId] || null; }
  listTempLobbies() { return { ...this.read().tempLobbies }; }
  findTempLobbyByOwner(moduleId, ownerId) {
    return Object.values(this.read().tempLobbies).find((item) => item.moduleId === moduleId && item.ownerId === ownerId) || null;
  }
  setTempLobby(channelId, value) {
    const state = this.read();
    state.tempLobbies[channelId] = value;
    this.write(state);
    return value;
  }
  removeTempLobby(channelId) {
    const state = this.read();
    const existing = state.tempLobbies[channelId] || null;
    delete state.tempLobbies[channelId];
    this.write(state);
    return existing;
  }
}

module.exports = { StateStore, emptyState };
