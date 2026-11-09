'use strict';

// One open join-to-create lobby for Nexus Sentinal.
//
// The game bots already create per-game rooms through src/game-bots/join-to-create.cjs
// (Cephalon squads, Ascended tribes, Sanctuary parties, Vanguard fireteams).
// This module does not call that installer. It keeps the same shape — persist
// the channel id, move the member, delete an empty room after a short grace,
// and reconcile leftovers on startup — and adds owner permissions, /vc, and
// an optional presence name. It runs only inside Sentinal, and only when
// SENTINAL_TEMP_VOICE=true.

const path = require('node:path');
const {
  ActivityType,
  ChannelType,
  OverwriteType,
  PermissionFlagsBits
} = require('discord.js');
const { Routes } = require('discord-api-types/v10');
const { OWNER_JTC_LOBBY_IDS } = require('../game-bots/join-to-create.cjs');
const { readJson, runtimeDataDir, writeJson } = require('../game-bots/panel-message.cjs');
const { denylistReason, policy } = require('./card/tag-validate.cjs');
const { LAYOUTS } = require('./module-layouts.cjs');
const {
  findPlayerVoiceCategory,
  isStaffCategoryName,
  isStaffLocated
} = require('./manual-layout.cjs');
const { isStaffModOrAbove } = require('./staff-roles.cjs');

const LOBBY_NAME = '➕ Create a Voice Chat';
const ROOM_STATUS = 'Sentinal temp room';
const LOBBY_STATUS = 'Sentinal temp lobby';
const TOPIC_MARK = 'nexus-sentinal:temp-voice';
const DEFAULT_VOICE_CATEGORY_ID = '1569266940508110928';
const DEFAULT_GRACE_MS = 45_000;
const MIN_GRACE_MS = 30_000;
const MAX_GRACE_MS = 60_000;
const RENAME_WINDOW_MS = 10 * 60 * 1000;
const RENAME_LIMIT = 2;
const MAX_ROOMS = 25;
const NAME_LIMIT = 100;

const PRESERVED_CHANNEL_IDS = new Set(Object.values(OWNER_JTC_LOBBY_IDS).map(String));
const PROTECTED_NAME_KEYS = new Set([
  'nexuslounge',
  'afk',
  'eventnight',
  'staffmeetingroom'
]);
const GAME_LOBBY_KEYS = new Set(
  Object.values(LAYOUTS).map((layout) => compactName(layout.lobbyBuilder)).filter(Boolean)
);

const TRACKED = new Map();

const OWNER_ALLOW = Object.freeze([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.Stream,
  PermissionFlagsBits.UseVAD,
  PermissionFlagsBits.PrioritySpeaker,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.MoveMembers,
  PermissionFlagsBits.MuteMembers,
  PermissionFlagsBits.DeafenMembers
]);

const EVERYONE_ALLOW = Object.freeze([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.Stream,
  PermissionFlagsBits.UseVAD
]);

function flagEnabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? '').trim());
}

function snowflake(value) {
  const text = String(value ?? '').trim();
  return /^\d{17,20}$/.test(text) ? text : '';
}

function compactName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function clampGrace(value) {
  if (value === undefined || String(value).trim() === '') return DEFAULT_GRACE_MS;
  const raw = Number(value);
  if (!Number.isFinite(raw)) return DEFAULT_GRACE_MS;
  return Math.max(MIN_GRACE_MS, Math.min(MAX_GRACE_MS, Math.round(raw)));
}

function storePath(env = process.env, dir = '') {
  const root = dir || runtimeDataDir(env);
  return path.join(root, 'sentinal-temp-voice.json');
}

function resolveTempVoiceConfig(env = process.env) {
  const enabled = flagEnabled(env.SENTINAL_TEMP_VOICE);
  const presence = flagEnabled(env.SENTINAL_TEMP_VOICE_PRESENCE);
  const lobbyRaw = env.SENTINAL_TEMP_VOICE_LOBBY_ID;
  let lobbyId = '';
  let lobbySource = 'unset';
  if (lobbyRaw !== undefined && String(lobbyRaw).trim() !== '') {
    lobbyId = snowflake(lobbyRaw);
    lobbySource = lobbyId ? 'env' : 'invalid';
  }
  const categoryRaw = env.SENTINAL_TEMP_VOICE_CATEGORY_ID;
  let categoryId = '';
  let categorySource = 'unset';
  if (categoryRaw !== undefined && String(categoryRaw).trim() !== '') {
    categoryId = snowflake(categoryRaw);
    categorySource = categoryId ? 'env' : 'invalid';
  } else if (enabled) {
    categoryId = DEFAULT_VOICE_CATEGORY_ID;
    categorySource = 'default';
  }
  let guildId = snowflake(env.NEXUS_DISCORD_GUILD_ID || env.DISCORD_GUILD_ID);
  if (!guildId && env === process.env) {
    try {
      const loaded = require('../shared/config.cjs').loadConfig();
      guildId = snowflake(loaded.discord?.guildId);
    } catch {
      guildId = '';
    }
  }
  const maxRoomsRaw = Number(env.SENTINAL_TEMP_VOICE_MAX_ROOMS);
  const maxRooms = Number.isFinite(maxRoomsRaw) && maxRoomsRaw > 0
    ? Math.min(50, Math.round(maxRoomsRaw))
    : MAX_ROOMS;
  return {
    enabled,
    presence,
    requestPresenceIntent: Boolean(enabled && presence),
    lobbyId,
    lobbySource,
    categoryId,
    categorySource,
    guildId,
    graceMs: clampGrace(env.SENTINAL_TEMP_VOICE_EMPTY_GRACE_MS),
    maxRooms
  };
}

function presenceIntentReport(config = resolveTempVoiceConfig()) {
  if (config.requestPresenceIntent) {
    return '[Nexus Sentinal] Guild Presences intent IS requested because SENTINAL_TEMP_VOICE=true and SENTINAL_TEMP_VOICE_PRESENCE=true. Enable the privileged Presence Intent in the Discord Developer Portal or login is rejected. Sentinal did not request Guild Presences before this feature.';
  }
  if (config.enabled) {
    return '[Nexus Sentinal] Guild Presences intent is NOT requested. Temporary voice is on, but room names stay "<name>\'s Chat" until SENTINAL_TEMP_VOICE_PRESENCE=true and the Developer Portal Presence Intent is enabled.';
  }
  if (config.presence) {
    return '[Nexus Sentinal] Guild Presences intent is NOT requested. SENTINAL_TEMP_VOICE_PRESENCE is set, but SENTINAL_TEMP_VOICE is off, so the privileged intent is not added and no lobby is created.';
  }
  return '[Nexus Sentinal] Guild Presences intent is NOT requested. Temporary voice is off (SENTINAL_TEMP_VOICE is not true), so no lobby is created and no presence intent is added.';
}

function cleanText(value) {
  let text = String(value ?? '');
  try { text = text.normalize('NFKC'); } catch { /* keep the raw string */ }
  return text
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/@everyone|@here/gi, '')
    .replace(/<@!?\d+>|<@&\d+>|<#\d+>/g, '')
    .replace(/[`#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function screenFragment(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return { ok: false, reason: 'empty' };
  try {
    if (denylistReason(cleaned, policy())) return { ok: false, reason: 'profanity' };
  } catch {
    return { ok: true, value: cleaned };
  }
  return { ok: true, value: cleaned };
}

function buildRoomName(displayName, gameName) {
  const displayResult = screenFragment(displayName);
  const gameResult = screenFragment(gameName);
  let display = (displayResult.ok ? displayResult.value : 'Player').slice(0, 80);
  let kind = (gameResult.ok ? gameResult.value : 'Chat').slice(0, 60);
  if (!display) display = 'Player';
  if (!kind) kind = 'Chat';
  let suffix = `'s ${kind}`;
  if (suffix.length > 80) {
    kind = 'Chat';
    suffix = "'s Chat";
  }
  if (display.length + suffix.length <= NAME_LIMIT) return `${display}${suffix}`;
  const room = NAME_LIMIT - suffix.length;
  const trimmed = display.slice(0, Math.max(1, room)).trim() || 'Player';
  return `${trimmed}${suffix}`.slice(0, NAME_LIMIT);
}

function screenCustomName(value) {
  const screened = screenFragment(value);
  if (!screened.ok) return screened;
  const name = screened.value.slice(0, NAME_LIMIT);
  if (!name) return { ok: false, reason: 'empty' };
  if (isLobbyName(name) || isPreservedVoiceName(name)) return { ok: false, reason: 'reserved' };
  return { ok: true, value: name };
}

function isLobbyName(value) {
  return compactName(value) === compactName(LOBBY_NAME);
}

function isPreservedVoiceName(value) {
  const key = compactName(value);
  if (!key) return false;
  if (PROTECTED_NAME_KEYS.has(key)) return true;
  if (key.startsWith('jointocreate')) return true;
  if (GAME_LOBBY_KEYS.has(key)) return true;
  return false;
}

function channelStatus(channel) {
  return String(channel?.voiceStatus || channel?.status || '');
}

function channelTopic(channel) {
  return String(channel?.topic || '');
}

function hasRoomMarker(channel) {
  const status = channelStatus(channel);
  const topic = channelTopic(channel);
  return status.includes(ROOM_STATUS)
    || status.includes(TOPIC_MARK)
    || topic.includes(ROOM_STATUS)
    || topic.includes(TOPIC_MARK);
}

function hasLobbyMarker(channel) {
  const status = channelStatus(channel);
  const topic = channelTopic(channel);
  return status.includes(LOBBY_STATUS) || topic.includes(LOBBY_STATUS) || isLobbyName(channel?.name);
}

function trackedIds(env = process.env, dir = '') {
  const file = storePath(env, dir);
  if (TRACKED.has(file)) return TRACKED.get(file);
  const state = readJson(file, { version: 1, lobbyId: '', rooms: {} });
  const ids = new Set();
  if (state.lobbyId) ids.add(String(state.lobbyId));
  for (const id of Object.keys(state.rooms || {})) ids.add(String(id));
  TRACKED.set(file, ids);
  return ids;
}

function isSentinalTempVoiceChannel(channel, env = process.env) {
  if (!channel) return false;
  if (hasRoomMarker(channel) || hasLobbyMarker(channel)) return true;
  const id = String(channel.id || '');
  if (!id) return false;
  return trackedIds(env).has(id);
}

function isHandsOffVoice(channel, guild = null) {
  if (!channel) return false;
  const id = String(channel.id || '');
  if (id && PRESERVED_CHANNEL_IDS.has(id)) return true;
  if (id && guild?.afkChannelId && id === String(guild.afkChannelId)) return true;
  if (isPreservedVoiceName(channel.name)) return true;
  if (isStaffLocated(channel, guild?.channels?.cache || null) || isStaffCategoryName(channel.parent?.name) || isStaffCategoryName(channel.name)) {
    return true;
  }
  return false;
}

function memberIds(channel) {
  const members = channel?.members;
  if (!members) return null;
  if (typeof members.keys === 'function' && Number.isInteger(members.size)) {
    return [...members.keys()].map(String);
  }
  if (Number.isInteger(members.cache?.size) && typeof members.cache.keys === 'function') {
    return [...members.cache.keys()].map(String);
  }
  if (Array.isArray(members)) return members.map((member) => String(member?.id || member));
  return null;
}

function memberCount(channel) {
  const ids = memberIds(channel);
  return ids ? ids.length : null;
}

function onlyOwner(channel, ownerId) {
  const ids = memberIds(channel);
  return Array.isArray(ids) && ids.length === 1 && ids[0] === String(ownerId);
}

function playingGameName(member) {
  try {
    const activities = member?.presence?.activities;
    if (!activities) return '';
    const list = Array.isArray(activities)
      ? activities
      : [...(typeof activities.values === 'function' ? activities.values() : activities)];
    const playing = list.find((activity) => Number(activity?.type) === ActivityType.Playing && String(activity?.name || '').trim());
    return playing ? String(playing.name).trim() : '';
  } catch {
    return '';
  }
}

function emptyState() {
  return { version: 1, lobbyId: '', rooms: {} };
}

class TempVoiceStore {
  constructor(file) {
    this.file = file;
    const loaded = readJson(file, emptyState());
    this.state = {
      version: 1,
      lobbyId: String(loaded.lobbyId || ''),
      rooms: loaded.rooms && typeof loaded.rooms === 'object' ? loaded.rooms : {}
    };
    this.publish();
  }

  publish() {
    const ids = new Set();
    if (this.state.lobbyId) ids.add(String(this.state.lobbyId));
    for (const id of Object.keys(this.state.rooms)) ids.add(String(id));
    TRACKED.set(this.file, ids);
  }

  flush() {
    writeJson(this.file, {
      version: 1,
      lobbyId: this.state.lobbyId,
      rooms: this.state.rooms
    });
    this.publish();
  }

  list() {
    return Object.values(this.state.rooms);
  }

  get(channelId) {
    return this.state.rooms[String(channelId)] || null;
  }

  findByOwner(ownerId) {
    return this.list().find((row) => row.ownerId === String(ownerId)) || null;
  }

  setLobby(channelId) {
    this.state.lobbyId = String(channelId || '');
    if (this.state.lobbyId) delete this.state.rooms[this.state.lobbyId];
    this.flush();
  }

  upsert(row) {
    const channelId = String(row.channelId || '');
    if (!channelId || channelId === this.state.lobbyId) return;
    this.state.rooms[channelId] = {
      channelId,
      ownerId: String(row.ownerId || ''),
      guildId: String(row.guildId || ''),
      categoryId: String(row.categoryId || ''),
      createdAt: String(row.createdAt || new Date().toISOString()),
      game: String(row.game || ''),
      autoRenameUsed: row.autoRenameUsed === true,
      manualName: row.manualName === true,
      locked: row.locked === true,
      renames: (Array.isArray(row.renames) ? row.renames : []).map(Number).filter((ts) => Number.isFinite(ts)).slice(-8)
    };
    this.flush();
  }

  remove(channelId) {
    delete this.state.rooms[String(channelId)];
    this.flush();
  }
}

function logTempVoice(fields = {}) {
  const action = String(fields.action || 'event').toLowerCase().replace(/[^a-z-]/g, '').slice(0, 24) || 'event';
  const reason = String(fields.reason || 'none').replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 48) || 'none';
  const owned = Math.max(0, Number(fields.owned) || 0);
  console.log(`[Nexus Sentinal] temp-voice action=${action} owned=${owned} reason=${reason}`);
}

class TempVoiceController {
  constructor({
    env = process.env,
    dir,
    store,
    now = () => Date.now(),
    graceMs,
    schedule = (fn, ms) => setTimeout(fn, ms),
    log
  } = {}) {
    this.env = env;
    this.config = resolveTempVoiceConfig(env);
    this.now = now;
    this.schedule = schedule;
    this.graceMs = Number.isFinite(Number(graceMs)) ? Math.max(0, Number(graceMs)) : this.config.graceMs;
    this.log = typeof log === 'function' ? log : logTempVoice;
    this.creating = new Set();
    this.timers = new Map();
    this.lobbyId = this.config.lobbySource === 'env' ? this.config.lobbyId : '';
    this.store = store || new TempVoiceStore(storePath(env, dir));
    if (!this.lobbyId && this.store.state.lobbyId) this.lobbyId = this.store.state.lobbyId;
  }

  ownedCount() {
    return this.store.list().length;
  }

  budget(row, now = this.now()) {
    const recent = (Array.isArray(row?.renames) ? row.renames : [])
      .map(Number)
      .filter((ts) => Number.isFinite(ts) && now - ts < RENAME_WINDOW_MS);
    return { recent, allowed: recent.length < RENAME_LIMIT };
  }

  async fetchChannel(guild, channelId) {
    if (!channelId || typeof guild?.channels?.fetch !== 'function') return null;
    return guild.channels.fetch(String(channelId)).catch(() => null);
  }

  async handleVoiceState(oldState, newState) {
    if (!this.config.enabled || this.config.lobbySource === 'invalid' || this.config.categorySource === 'invalid') {
      return { action: 'ignored', reason: this.config.enabled ? 'invalid' : 'disabled' };
    }
    const guild = newState?.guild || oldState?.guild;
    const guildId = String(guild?.id || '');
    if (this.config.guildId && guildId && guildId !== this.config.guildId) {
      return { action: 'ignored', reason: 'guild' };
    }
    const oldId = String(oldState?.channelId || '');
    const newId = String(newState?.channelId || '');
    if (oldId && oldId === newId) return { action: 'ignored', reason: 'same-channel' };

    if (newId && this.store.get(newId)) this.cancelDelete(newId);
    let departure = null;
    if (oldId && oldId !== this.lobbyId) departure = await this.noteDeparture(guild, oldId);
    if (!newId || !this.lobbyId || newId !== this.lobbyId) {
      return departure && departure.action !== 'ignored' ? departure : { action: 'ignored', reason: 'not-lobby' };
    }
    if (newState?.member?.user?.bot) return { action: 'ignored', reason: 'bot' };
    const lobby = newState.channel || await this.fetchChannel(guild, newId);
    if (isHandsOffVoice(lobby, guild)) return { action: 'ignored', reason: 'protected' };
    const parentId = await this.roomParentId(guild, lobby);
    if (!parentId) return { action: 'ignored', reason: 'category' };
    return this.openRoom(newState.member, guild, parentId);
  }

  async roomParentId(guild, lobby) {
    let parentId = String(lobby?.parentId || '');
    if (!parentId && lobby?.id) {
      const fetched = await this.fetchChannel(guild, lobby.id);
      parentId = String(fetched?.parentId || '');
    }
    if (!parentId) parentId = String(this.config.categoryId || '');
    if (!parentId) return '';
    const parent = await this.fetchChannel(guild, parentId);
    if (parent && parent.type !== undefined && parent.type !== ChannelType.GuildCategory) return '';
    if (parent && (isStaffCategoryName(parent.name) || isStaffLocated(parent))) return '';
    return parentId;
  }

  async openRoom(member, guild, parentId) {
    const userId = String(member?.id || '');
    if (!userId || this.creating.has(userId)) return { action: 'ignored', reason: 'in-flight' };
    this.creating.add(userId);
    try {
      const existing = this.store.findByOwner(userId);
      if (existing && existing.channelId !== this.lobbyId) {
        const channel = await this.fetchChannel(guild, existing.channelId);
        if (channel && !isHandsOffVoice(channel, guild) && String(channel.id) !== this.lobbyId) {
          await member.voice.setChannel(channel, 'Nexus Sentinal temporary voice');
          this.cancelDelete(existing.channelId);
          this.log({ action: 'moved', owned: this.ownedCount() });
          return { action: 'moved', channelId: existing.channelId };
        }
        this.store.remove(existing.channelId);
      }
      if (this.ownedCount() >= this.config.maxRooms) {
        this.log({ action: 'limit', owned: this.ownedCount(), reason: 'max-rooms' });
        return { action: 'ignored', reason: 'limit' };
      }
      const game = playingGameName(member);
      const screenedGame = screenFragment(game);
      const gameName = screenedGame.ok ? screenedGame.value : '';
      const name = buildRoomName(member.displayName || member.user?.globalName || member.user?.username, gameName);
      const channel = await guild.channels.create({
        name,
        type: ChannelType.GuildVoice,
        parent: parentId,
        permissionOverwrites: [
          { id: guild.id, type: OverwriteType.Role, allow: [...EVERYONE_ALLOW] },
          { id: userId, type: OverwriteType.Member, allow: [...OWNER_ALLOW] }
        ],
        reason: 'Nexus Sentinal temporary voice'
      });
      if (!channel?.id || String(channel.id) === this.lobbyId || isHandsOffVoice(channel, guild)) {
        this.log({ action: 'failed', owned: this.ownedCount(), reason: 'channel' });
        return { action: 'failed', reason: 'channel' };
      }
      channel.voiceStatus = ROOM_STATUS;
      await setVoiceStatus(channel, ROOM_STATUS);
      this.store.upsert({
        channelId: channel.id,
        ownerId: userId,
        guildId: guild.id,
        categoryId: parentId,
        createdAt: new Date(this.now()).toISOString(),
        game: gameName,
        autoRenameUsed: false,
        manualName: false,
        locked: false,
        renames: []
      });
      try {
        await member.voice.setChannel(channel, 'Nexus Sentinal temporary voice');
      } catch (error) {
        this.scheduleDelete(guild, channel.id);
        this.log({ action: 'failed', owned: this.ownedCount(), reason: 'move' });
        return { action: 'failed', reason: 'move' };
      }
      this.log({ action: 'created', owned: this.ownedCount() });
      return { action: 'created', channelId: String(channel.id), name };
    } catch (error) {
      this.log({ action: 'failed', owned: this.ownedCount(), reason: 'create' });
      return { action: 'failed', reason: 'create', error: String(error?.message || error).slice(0, 180) };
    } finally {
      this.creating.delete(userId);
    }
  }

  async noteDeparture(guild, channelId) {
    if (!channelId || channelId === this.lobbyId || !this.store.get(channelId)) {
      return { action: 'ignored', reason: 'untracked' };
    }
    const channel = await this.fetchChannel(guild, channelId);
    if (!channel) return { action: 'ignored', reason: 'missing' };
    if (isHandsOffVoice(channel, guild)) {
      this.store.remove(channelId);
      return { action: 'ignored', reason: 'protected' };
    }
    const count = memberCount(channel);
    if (count === null || count > 0) {
      this.cancelDelete(channelId);
      return { action: 'ignored', reason: count === null ? 'unknown-members' : 'occupied' };
    }
    this.scheduleDelete(guild, channelId);
    return { action: 'scheduled', channelId };
  }

  scheduleDelete(guild, channelId) {
    if (!channelId || channelId === this.lobbyId || !this.store.get(channelId)) return;
    this.cancelDelete(channelId);
    const timer = this.schedule(() => {
      this.timers.delete(channelId);
      return this.deleteIfEmpty(guild, channelId);
    }, this.graceMs);
    timer?.unref?.();
    this.timers.set(channelId, timer);
  }

  cancelDelete(channelId) {
    const timer = this.timers.get(channelId);
    if (timer) clearTimeout(timer);
    this.timers.delete(channelId);
  }

  async deleteIfEmpty(guild, channelId) {
    if (!this.config.enabled) return { action: 'ignored', reason: 'disabled' };
    if (!channelId || channelId === this.lobbyId) return { action: 'ignored', reason: 'lobby' };
    if (!this.store.get(channelId)) return { action: 'ignored', reason: 'untracked' };
    const channel = await this.fetchChannel(guild, channelId);
    if (!channel) {
      this.store.remove(channelId);
      return { action: 'forgotten', channelId, reason: 'missing' };
    }
    if (channel.type !== ChannelType.GuildVoice) {
      this.store.remove(channelId);
      return { action: 'ignored', reason: 'not-voice' };
    }
    if (isHandsOffVoice(channel, guild) || isPreservedVoiceName(channel.name) || PRESERVED_CHANNEL_IDS.has(String(channel.id))) {
      this.store.remove(channelId);
      this.log({ action: 'kept', owned: this.ownedCount(), reason: 'protected' });
      return { action: 'ignored', reason: 'protected' };
    }
    const parent = channel.parent || (channel.parentId ? await this.fetchChannel(guild, channel.parentId) : null);
    if (parent && (isStaffCategoryName(parent.name) || isStaffLocated(parent))) {
      this.store.remove(channelId);
      return { action: 'ignored', reason: 'staff' };
    }
    const count = memberCount(channel);
    if (count === null || count > 0) return { action: 'ignored', reason: count === null ? 'unknown-members' : 'occupied' };
    try {
      if (typeof channel.delete === 'function') await channel.delete('Nexus Sentinal temporary voice empty');
    } catch (error) {
      this.log({ action: 'failed', owned: this.ownedCount(), reason: 'delete' });
      return { action: 'failed', reason: 'delete' };
    }
    this.store.remove(channelId);
    this.log({ action: 'deleted', owned: this.ownedCount() });
    return { action: 'deleted', channelId };
  }

  async handlePresence(oldPresence, newPresence) {
    if (!this.config.enabled || !this.config.requestPresenceIntent) {
      return { action: 'ignored', reason: 'presence-off' };
    }
    const guild = newPresence?.guild || oldPresence?.guild;
    if (this.config.guildId && guild?.id && String(guild.id) !== this.config.guildId) {
      return { action: 'ignored', reason: 'guild' };
    }
    const userId = String(newPresence?.userId || newPresence?.user?.id || newPresence?.member?.id || '');
    const member = newPresence?.member;
    const channelId = String(member?.voice?.channelId || '');
    if (!userId || !channelId) return { action: 'ignored', reason: 'not-in-voice' };
    const row = this.store.get(channelId);
    if (!row || row.ownerId !== userId) return { action: 'ignored', reason: 'not-owner' };
    if (row.autoRenameUsed || row.manualName) return { action: 'ignored', reason: 'once' };
    const channel = await this.fetchChannel(guild, channelId);
    if (!channel || isHandsOffVoice(channel, guild)) return { action: 'ignored', reason: 'protected' };
    if (!onlyOwner(channel, userId)) return { action: 'ignored', reason: 'not-alone' };
    const gameName = screenFragment(playingGameName(member));
    const nextGame = gameName.ok ? gameName.value : '';
    if (!nextGame || nextGame === row.game) return { action: 'ignored', reason: 'same-game' };
    const name = buildRoomName(member.displayName || member.user?.globalName || member.user?.username, nextGame);
    if (isLobbyName(name) || isPreservedVoiceName(name)) return { action: 'ignored', reason: 'reserved' };
    if (String(channel.name || '') === name) {
      this.store.upsert({ ...row, game: nextGame });
      return { action: 'ignored', reason: 'already-named' };
    }
    const budget = this.budget(row);
    if (!budget.allowed) return { action: 'ignored', reason: 'rate-limit' };
    try {
      if (typeof channel.setName !== 'function') return { action: 'failed', reason: 'rename' };
      await channel.setName(name, 'Nexus Sentinal temporary voice game');
    } catch {
      this.log({ action: 'failed', owned: this.ownedCount(), reason: 'rename' });
      return { action: 'failed', reason: 'rename' };
    }
    this.store.upsert({
      ...row,
      game: nextGame,
      autoRenameUsed: true,
      renames: [...budget.recent, this.now()]
    });
    this.log({ action: 'renamed', owned: this.ownedCount(), reason: 'presence' });
    return { action: 'renamed', channelId, name };
  }

  async ensureLobby(guild) {
    if (this.ensuring) return this.ensuring;
    this.ensuring = this.ensureLobbyOnce(guild).finally(() => { this.ensuring = null; });
    return this.ensuring;
  }

  async ensureLobbyOnce(guild) {
    if (!this.config.enabled) return { action: 'disabled' };
    if (this.config.lobbySource === 'invalid' || this.config.categorySource === 'invalid') {
      return { action: 'ignored', reason: 'invalid' };
    }
    if (this.config.guildId && guild?.id && String(guild.id) !== this.config.guildId) {
      return { action: 'ignored', reason: 'guild' };
    }
    const channels = typeof guild?.channels?.fetch === 'function' ? await guild.channels.fetch() : new Map();
    if (this.config.lobbySource === 'env') {
      const channel = channels.get?.(this.config.lobbyId) || await this.fetchChannel(guild, this.config.lobbyId);
      if (!channel || channel.type !== ChannelType.GuildVoice) return { action: 'failed', reason: 'lobby-missing' };
      if (isHandsOffVoice(channel, guild)) return { action: 'refused', reason: 'protected' };
      await this.markLobby(channel, guild);
      this.lobbyId = String(channel.id);
      this.store.setLobby(channel.id);
      return { action: 'adopted', channelId: this.lobbyId };
    }
    const category = await this.findCategory(guild, channels);
    if (!category) return { action: 'failed', reason: 'category' };
    if (isStaffCategoryName(category.name) || isStaffLocated(category)) return { action: 'refused', reason: 'staff' };
    const existing = [...(channels.values?.() || [])].find((channel) => (
      channel?.type === ChannelType.GuildVoice
      && String(channel.parentId || '') === String(category.id)
      && (isLobbyName(channel.name) || hasLobbyMarker(channel))
      && !isHandsOffVoice(channel, guild)
    ));
    if (existing) {
      if (String(existing.name || '') !== LOBBY_NAME && typeof existing.setName === 'function') {
        await existing.setName(LOBBY_NAME, 'Nexus Sentinal temporary voice lobby');
        existing.name = LOBBY_NAME;
      }
      await this.markLobby(existing, guild);
      this.lobbyId = String(existing.id);
      this.store.setLobby(existing.id);
      return { action: 'adopted', channelId: this.lobbyId };
    }
    const created = await guild.channels.create({
      name: LOBBY_NAME,
      type: ChannelType.GuildVoice,
      parent: String(category.id),
      permissionOverwrites: [
        { id: guild.id, type: OverwriteType.Role, allow: [...EVERYONE_ALLOW] }
      ],
      reason: 'Nexus Sentinal temporary voice lobby'
    });
    created.voiceStatus = LOBBY_STATUS;
    await setVoiceStatus(created, LOBBY_STATUS);
    this.lobbyId = String(created.id);
    this.store.setLobby(created.id);
    this.log({ action: 'lobby', owned: this.ownedCount() });
    return { action: 'created', channelId: this.lobbyId };
  }

  async findCategory(guild, channels) {
    const wanted = String(this.config.categoryId || '');
    if (wanted) {
      const byId = channels.get?.(wanted) || await this.fetchChannel(guild, wanted);
      if (byId?.type === ChannelType.GuildCategory) return byId;
      if (this.config.categorySource === 'env') return null;
    }
    return findPlayerVoiceCategory(channels, { categoryId: wanted });
  }

  async markLobby(channel, guild) {
    channel.voiceStatus = LOBBY_STATUS;
    await setVoiceStatus(channel, LOBBY_STATUS);
    if (!channel.permissionOverwrites?.edit) return;
    if (everyoneCanJoin(channel, guild.id)) return;
    await channel.permissionOverwrites.edit(guild.id, {
      ViewChannel: true,
      Connect: true,
      Speak: true
    }, 'Nexus Sentinal temporary voice lobby is open to everyone');
  }

  async reconcile(guild) {
    if (!this.config.enabled) return { action: 'disabled', removed: 0 };
    let removed = 0;
    for (const row of this.store.list()) {
      if (!row?.channelId || row.channelId === this.lobbyId) {
        this.store.remove(row.channelId);
        removed += 1;
        continue;
      }
      const result = await this.deleteIfEmpty(guild, row.channelId);
      if (result.action === 'deleted' || result.action === 'forgotten') removed += 1;
    }
    this.log({ action: 'reconcile', owned: this.ownedCount(), reason: removed ? 'stale' : 'none' });
    return { action: 'reconciled', owned: this.ownedCount(), removed };
  }

  async handleCommand(interaction) {
    if (!this.config.enabled) return { content: 'Temporary voice rooms are off.' };
    if (interaction?.commandName !== 'vc') return null;
    const sub = interaction.options?.getSubcommand?.(false) || '';
    const located = await this.roomFromInteraction(interaction);
    if (located.error) return { content: located.error };
    const { row, channel } = located;
    const userId = String(interaction.user?.id || '');
    const staff = isStaffModOrAbove(interaction, this.env);
    const owner = row.ownerId === userId;
    if (sub === 'claim') return this.claimRoom(interaction, channel, row, userId);
    if (!owner && !staff) return { content: 'Only the room owner or staff can do that.' };
    if (sub === 'rename') return this.renameRoom(channel, row, interaction.options?.getString?.('name'));
    if (sub === 'limit') return this.limitRoom(channel, interaction.options?.getInteger?.('n'));
    if (sub === 'lock') return this.lockRoom(interaction, channel, row, true);
    if (sub === 'unlock') return this.lockRoom(interaction, channel, row, false);
    return { content: 'That voice command is not available.' };
  }

  async roomFromInteraction(interaction) {
    const voiceId = String(interaction.member?.voice?.channelId || '');
    if (!voiceId) return { error: 'Join your temporary voice room first.' };
    if (voiceId === this.lobbyId) return { error: 'Open a room from the lobby first. These commands manage that room, not the lobby.' };
    const row = this.store.get(voiceId);
    if (!row) return { error: 'These commands only work inside a temporary voice room.' };
    const channel = await this.fetchChannel(interaction.guild, voiceId);
    if (!channel || isHandsOffVoice(channel, interaction.guild)) return { error: 'That voice room is not a temporary room.' };
    return { row, channel };
  }

  async renameRoom(channel, row, rawName) {
    const screened = screenCustomName(rawName);
    if (!screened.ok) {
      const reason = screened.reason === 'profanity'
        ? 'Pick a different name. That one is not allowed.'
        : screened.reason === 'reserved'
          ? 'That name is reserved.'
          : 'Give the room a name.';
      return { content: reason };
    }
    const budget = this.budget(row);
    if (!budget.allowed) {
      return { content: 'Discord allows about 2 channel renames every 10 minutes. Try again shortly.' };
    }
    await channel.setName(screened.value, 'Nexus Sentinal temporary voice rename');
    this.store.upsert({
      ...row,
      manualName: true,
      autoRenameUsed: true,
      renames: [...budget.recent, this.now()]
    });
    return { content: `Renamed the room to **${screened.value}**.` };
  }

  async limitRoom(channel, rawLimit) {
    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 0 || limit > 99) {
      return { content: 'Use a limit from 0 to 99. 0 means no limit.' };
    }
    await channel.setUserLimit(limit, 'Nexus Sentinal temporary voice limit');
    const text = limit === 0 ? 'Removed the user limit.' : `Set the user limit to **${limit}**.`;
    return { content: text };
  }

  async lockRoom(interaction, channel, row, locked) {
    if (channel.permissionOverwrites?.edit) {
      await channel.permissionOverwrites.edit(interaction.guild.id, {
        ViewChannel: true,
        Connect: locked ? false : null
      }, locked ? 'Nexus Sentinal temporary voice lock' : 'Nexus Sentinal temporary voice unlock');
    }
    if (locked && row.ownerId && channel.permissionOverwrites?.edit) {
      await channel.permissionOverwrites.edit(row.ownerId, {
        ViewChannel: true,
        Connect: true,
        Speak: true,
        ManageChannels: true,
        MoveMembers: true,
        MuteMembers: true,
        DeafenMembers: true
      }, 'Nexus Sentinal temporary voice owner can rejoin a locked room');
    }
    this.store.upsert({ ...row, locked });
    return { content: locked ? 'Locked the room. People already inside can stay.' : 'Unlocked the room.' };
  }

  async claimRoom(interaction, channel, row, userId) {
    const ids = memberIds(channel);
    if (!ids) return { content: 'I cannot see who is in that room yet.' };
    if (!ids.includes(userId)) return { content: 'Join the room before claiming it.' };
    if (row.ownerId && ids.includes(row.ownerId)) return { content: 'The room owner is still here.' };
    if (row.ownerId && row.ownerId !== userId && channel.permissionOverwrites?.delete) {
      await channel.permissionOverwrites.delete(row.ownerId, 'Nexus Sentinal temporary voice owner changed').catch(() => {});
    }
    if (channel.permissionOverwrites?.edit) {
      await channel.permissionOverwrites.edit(userId, {
        ViewChannel: true,
        Connect: true,
        Speak: true,
        Stream: true,
        UseVAD: true,
        PrioritySpeaker: true,
        ManageChannels: true,
        MoveMembers: true,
        MuteMembers: true,
        DeafenMembers: true
      }, 'Nexus Sentinal temporary voice claim');
    }
    this.store.upsert({ ...row, ownerId: userId });
    this.log({ action: 'claimed', owned: this.ownedCount() });
    return { content: 'You now own this room.' };
  }

  stop() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

function everyoneCanJoin(channel, guildId) {
  const overwrite = channel?.permissionOverwrites?.cache?.get?.(String(guildId));
  if (!overwrite?.allow?.has) return false;
  const view = overwrite.allow.has(PermissionFlagsBits.ViewChannel) && !overwrite.deny?.has?.(PermissionFlagsBits.ViewChannel);
  const connect = overwrite.allow.has(PermissionFlagsBits.Connect) && !overwrite.deny?.has?.(PermissionFlagsBits.Connect);
  return view && connect;
}

async function setVoiceStatus(channel, status) {
  try {
    if (!channel) return false;
    if (typeof channel.setStatus === 'function') {
      await channel.setStatus(status, 'Nexus Sentinal temporary voice');
      return true;
    }
    const rest = channel.client?.rest || channel.guild?.client?.rest;
    if (!rest?.put || !channel.id) return false;
    await rest.put(Routes.channelVoiceStatus(channel.id), { body: { status } });
    return true;
  } catch {
    return false;
  }
}

function vcCommand() {
  const { SlashCommandBuilder } = require('discord.js');
  return new SlashCommandBuilder()
    .setName('vc')
    .setDescription('Manage your temporary voice room')
    .setDMPermission(false)
    .addSubcommand((sub) => sub
      .setName('rename')
      .setDescription('Rename your voice room')
      .addStringOption((option) => option
        .setName('name')
        .setDescription('New room name')
        .setRequired(true)
        .setMaxLength(NAME_LIMIT)))
    .addSubcommand((sub) => sub
      .setName('limit')
      .setDescription('Set how many people can join your room')
      .addIntegerOption((option) => option
        .setName('n')
        .setDescription('User limit from 0 to 99. 0 means no limit.')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(99)))
    .addSubcommand((sub) => sub.setName('lock').setDescription('Stop new people from joining your room'))
    .addSubcommand((sub) => sub.setName('unlock').setDescription('Let people join your room again'))
    .addSubcommand((sub) => sub.setName('claim').setDescription('Take ownership of a room whose owner left'));
}

module.exports = {
  DEFAULT_GRACE_MS,
  DEFAULT_VOICE_CATEGORY_ID,
  LOBBY_NAME,
  LOBBY_STATUS,
  OWNER_ALLOW,
  PRESERVED_CHANNEL_IDS,
  RENAME_LIMIT,
  RENAME_WINDOW_MS,
  ROOM_STATUS,
  TOPIC_MARK,
  TempVoiceController,
  TempVoiceStore,
  buildRoomName,
  isHandsOffVoice,
  isPreservedVoiceName,
  isSentinalTempVoiceChannel,
  playingGameName,
  presenceIntentReport,
  resolveTempVoiceConfig,
  screenCustomName,
  screenFragment,
  storePath,
  trackedIds,
  vcCommand
};
