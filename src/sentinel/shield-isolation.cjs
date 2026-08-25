'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');

const MANAGED_PERMISSION_NAMES = Object.freeze([
  'ViewChannel',
  'SendMessages',
  'SendMessagesInThreads',
  'CreatePublicThreads',
  'CreatePrivateThreads',
  'AddReactions',
  'Connect',
  'Speak'
]);

function emptyIsolationState() {
  return { version: 1, guilds: {} };
}

function cleanId(value) {
  return String(value || '').trim();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizedPermissionState(value) {
  return ['allow', 'deny', 'unset'].includes(String(value || '')) ? String(value) : 'unset';
}

function normalizedBaseline(value = {}) {
  const permissions = {};
  for (const name of MANAGED_PERMISSION_NAMES) permissions[name] = normalizedPermissionState(value.permissions?.[name]);
  return {
    existed: Boolean(value.existed),
    permissions
  };
}

function permissionState(overwrite, bit) {
  if (overwrite?.allow?.has?.(bit)) return 'allow';
  if (overwrite?.deny?.has?.(bit)) return 'deny';
  return 'unset';
}

function captureManagedBaseline(overwrite) {
  const permissions = {};
  for (const name of MANAGED_PERMISSION_NAMES) {
    permissions[name] = permissionState(overwrite, PermissionFlagsBits[name]);
  }
  return normalizedBaseline({ existed: Boolean(overwrite), permissions });
}

function isolationDenyPatch() {
  return Object.fromEntries(MANAGED_PERMISSION_NAMES.map((name) => [name, false]));
}

function restorePatch(baseline = {}) {
  const normalized = normalizedBaseline(baseline);
  return Object.fromEntries(MANAGED_PERMISSION_NAMES.map((name) => {
    const state = normalized.permissions[name];
    return [name, state === 'allow' ? true : state === 'deny' ? false : null];
  }));
}

function overwriteIsEmpty(overwrite) {
  if (!overwrite) return true;
  try {
    return BigInt(overwrite.allow?.bitfield ?? 0) === 0n && BigInt(overwrite.deny?.bitfield ?? 0) === 0n;
  } catch {
    return false;
  }
}

class ShieldIsolationStore {
  constructor(root = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..')) {
    this.dir = process.env.NEXUS_DATA_DIR ? path.resolve(root) : path.join(root, 'data');
    this.file = path.join(this.dir, 'sentinal-shield-isolation.json');
  }

  read() {
    let state = null;
    try { state = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    state ||= emptyIsolationState();
    state.version = 1;
    state.guilds ||= {};
    return state;
  }

  write(state) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, this.file);
  }

  getUser(guildId, userId) {
    const guild = this.read().guilds?.[cleanId(guildId)];
    return clone(guild?.users?.[cleanId(userId)] || null);
  }

  listUsers(guildId) {
    return clone(this.read().guilds?.[cleanId(guildId)]?.users || {});
  }

  setBaselineIfAbsent(guildId, userId, channelId, baseline) {
    const gid = cleanId(guildId);
    const uid = cleanId(userId);
    const cid = cleanId(channelId);
    if (!gid || !uid || !cid) return null;
    const state = this.read();
    state.guilds[gid] ||= { users: {} };
    state.guilds[gid].users ||= {};
    state.guilds[gid].users[uid] ||= { channels: {}, updatedAt: '' };
    const user = state.guilds[gid].users[uid];
    user.channels ||= {};
    if (!user.channels[cid]) user.channels[cid] = normalizedBaseline(baseline);
    user.updatedAt = new Date().toISOString();
    this.write(state);
    return clone(user.channels[cid]);
  }

  clearChannel(guildId, userId, channelId) {
    const gid = cleanId(guildId);
    const uid = cleanId(userId);
    const cid = cleanId(channelId);
    const state = this.read();
    const user = state.guilds?.[gid]?.users?.[uid];
    if (!user?.channels?.[cid]) return false;
    delete user.channels[cid];
    user.updatedAt = new Date().toISOString();
    if (!Object.keys(user.channels).length) delete state.guilds[gid].users[uid];
    if (state.guilds[gid] && !Object.keys(state.guilds[gid].users || {}).length) delete state.guilds[gid];
    this.write(state);
    return true;
  }

  clearUser(guildId, userId) {
    const gid = cleanId(guildId);
    const uid = cleanId(userId);
    const state = this.read();
    if (!state.guilds?.[gid]?.users?.[uid]) return false;
    delete state.guilds[gid].users[uid];
    if (!Object.keys(state.guilds[gid].users || {}).length) delete state.guilds[gid];
    this.write(state);
    return true;
  }
}

module.exports = {
  MANAGED_PERMISSION_NAMES,
  ShieldIsolationStore,
  emptyIsolationState,
  normalizedBaseline,
  permissionState,
  captureManagedBaseline,
  isolationDenyPatch,
  restorePatch,
  overwriteIsEmpty
};
