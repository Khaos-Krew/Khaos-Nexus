'use strict';

const path = require('node:path');
const { ChannelType, Events } = require('discord.js');
const { normalizeBot, resolveCategoryConfig } = require('./category-gate.cjs');
const { BOT_LABELS, errorClass } = require('./command-failure.cjs');
const { readJson, runtimeDataDir, writeJson } = require('./panel-message.cjs');

const INSTALLED = Symbol.for('khaos.nexus.gamebot.joinToCreate');
const GAME_BOT_JTC_MODULES = Object.freeze(['ark', 'warframe', 'diablo4']);
const MODULE_SET = new Set(GAME_BOT_JTC_MODULES);
const DEFAULT_GRACE_MS = 15_000;
const MAX_CHANNELS = 20;

const NAME_KIND = Object.freeze({
  cephalon: 'Squad',
  ascended: 'Tribe',
  sanctuary: 'Party'
});

// Owner lobby voice channels. A blank env var uses these. A non-snowflake override fail-closes.
const OWNER_JTC_LOBBY_IDS = Object.freeze({
  cephalon: '1540877236184424500',
  ascended: '1540867019979890829',
  sanctuary: '1541540961937526916'
});

function snowflake(value) {
  const text = String(value || '').trim();
  return /^\d{17,20}$/.test(text) ? text : '';
}

function envPrefix(bot) {
  if (bot === 'ascended') return 'ASCENDED';
  if (bot === 'sanctuary') return 'SANCTUARY';
  if (bot === 'cephalon') return 'CEPHALON';
  return '';
}

function clampGrace(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_GRACE_MS;
  return Math.max(5_000, Math.min(120_000, Math.round(raw)));
}

function resolveLobbyId(bot, env) {
  const prefix = envPrefix(bot);
  const fallback = OWNER_JTC_LOBBY_IDS[bot] || '';
  if (!prefix) return { lobbyId: '', lobbySource: 'invalid' };
  const raw = env[`${prefix}_JTC_LOBBY_CHANNEL_ID`];
  if (raw === undefined || String(raw).trim() === '') return { lobbyId: fallback, lobbySource: fallback ? 'default' : 'unset' };
  const lobbyId = snowflake(raw);
  if (!lobbyId) return { lobbyId: '', lobbySource: 'invalid' };
  return { lobbyId, lobbySource: 'env' };
}

function resolveJtcConfig(bot, env = process.env) {
  const key = normalizeBot(bot);
  const prefix = envPrefix(key);
  const lobby = resolveLobbyId(key, env);
  const categoryOverride = prefix ? snowflake(env[`${prefix}_JTC_CATEGORY_ID`]) : '';
  const gate = key ? resolveCategoryConfig(key, env) : { id: '' };
  const categoryId = categoryOverride || snowflake(gate.id);
  const graceMs = prefix ? clampGrace(env[`${prefix}_JTC_EMPTY_GRACE_MS`]) : DEFAULT_GRACE_MS;
  const guildId = snowflake(env.NEXUS_DISCORD_GUILD_ID || env.DISCORD_GUILD_ID);
  return {
    bot: key,
    lobbyId: lobby.lobbyId,
    lobbySource: lobby.lobbySource,
    categoryId,
    graceMs,
    guildId,
    configured: Boolean(key && lobby.lobbyId && categoryId)
  };
}

function jtcStatusLine(bot, env = process.env) {
  const config = resolveJtcConfig(bot, env);
  if (!config.bot) return 'Join-to-create: unavailable.';
  if (config.lobbySource === 'invalid') return 'Join-to-create: lobby override is not a channel id.';
  if (!config.lobbyId) return 'Join-to-create: lobby not configured.';
  if (!config.categoryId) return 'Join-to-create: category not configured.';
  return 'Join-to-create: lobby configured.';
}

function cleanDisplayName(value) {
  const cleaned = String(value || 'Player')
    .replace(/[\r\n@#`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'Player').slice(0, 60);
}

function channelNameFor(bot, displayName) {
  const kind = NAME_KIND[normalizeBot(bot)] || 'Lobby';
  return `🎮 ${cleanDisplayName(displayName)}'s ${kind}`.slice(0, 100);
}

function memberCount(channel) {
  if (!channel) return 0;
  if (Number.isInteger(channel.members?.size)) return channel.members.size;
  if (typeof channel.members?.cache?.size === 'number') return channel.members.cache.size;
  return 0;
}

function logJtc(bot, { action = 'event', owned = 0, errorClass: klass = 'none' } = {}) {
  const label = BOT_LABELS[bot] || 'Game bot';
  const safeAction = String(action || 'event').toLowerCase().replace(/[^a-z-]/g, '').slice(0, 24) || 'event';
  const safeClass = String(klass || 'none').replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 48) || 'none';
  console.log(`[${label}] jtc action=${safeAction} owned=${Math.max(0, Number(owned) || 0)} class=${safeClass}`);
}

class JtcStore {
  constructor(file) {
    this.file = file;
    this.state = readJson(file, { version: 1, channels: {} });
    if (!this.state.channels || typeof this.state.channels !== 'object') this.state.channels = {};
  }

  list() {
    return Object.values(this.state.channels);
  }

  get(channelId) {
    return this.state.channels[String(channelId)] || null;
  }

  findByCreator(creatorId, categoryId) {
    return this.list().find((row) => row.creatorId === String(creatorId) && row.categoryId === String(categoryId)) || null;
  }

  upsert(row) {
    this.state.channels[String(row.channelId)] = {
      channelId: String(row.channelId),
      creatorId: String(row.creatorId),
      guildId: String(row.guildId),
      categoryId: String(row.categoryId),
      createdAt: String(row.createdAt || new Date().toISOString())
    };
    this.flush();
  }

  remove(channelId) {
    delete this.state.channels[String(channelId)];
    this.flush();
  }

  flush() {
    writeJson(this.file, { version: 1, channels: this.state.channels });
  }
}

class JoinToCreate {
  constructor({ bot, env = process.env, dir, graceMs, maxChannels = MAX_CHANNELS, now = () => Date.now(), store, log } = {}) {
    this.config = resolveJtcConfig(bot, env);
    this.bot = this.config.bot;
    this.graceMs = Number.isFinite(Number(graceMs)) ? Math.max(0, Number(graceMs)) : this.config.graceMs;
    this.maxChannels = Math.max(1, Number(maxChannels) || MAX_CHANNELS);
    this.now = now;
    this.log = typeof log === 'function' ? log : (fields) => logJtc(this.bot, fields);
    this.creating = new Set();
    this.timers = new Map();
    const root = dir || runtimeDataDir(env);
    this.store = store || new JtcStore(path.join(root, `jtc-${this.bot || 'bot'}.json`));
  }

  ownedCount() {
    return this.store.list().length;
  }

  async handleVoiceState(oldState, newState) {
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
    if (oldId && oldId !== this.config.lobbyId) departure = await this.noteDeparture(guild, oldId);
    if (!newId || newId !== this.config.lobbyId) {
      return departure && departure.action !== 'ignored' ? departure : { action: 'ignored', reason: 'not-lobby' };
    }
    if (!this.config.configured) return { action: 'ignored', reason: 'unconfigured' };
    if (newState?.member?.user?.bot) return { action: 'ignored', reason: 'bot' };

    const parentId = await this.parentId(newState);
    if (parentId && parentId !== this.config.categoryId) return { action: 'ignored', reason: 'category' };
    if (!parentId) return { action: 'ignored', reason: 'category' };
    return this.claimLobby(newState.member, guild);
  }

  async parentId(state) {
    const direct = String(state?.channel?.parentId || '');
    if (direct) return direct;
    const channel = await this.fetchChannel(state?.guild, state?.channelId);
    return String(channel?.parentId || '');
  }

  async fetchChannel(guild, channelId) {
    if (!channelId || typeof guild?.channels?.fetch !== 'function') return null;
    return guild.channels.fetch(String(channelId)).catch(() => null);
  }

  async claimLobby(member, guild) {
    const userId = String(member?.id || '');
    if (!userId || this.creating.has(userId)) return { action: 'ignored', reason: 'in-flight' };
    this.creating.add(userId);
    try {
      const existing = this.store.findByCreator(userId, this.config.categoryId);
      if (existing && existing.channelId !== this.config.lobbyId) {
        const channel = await this.fetchChannel(guild, existing.channelId);
        if (channel && channel.id !== this.config.lobbyId) {
          await member.voice.setChannel(channel, 'join-to-create');
          this.cancelDelete(existing.channelId);
          this.log({ action: 'moved', owned: this.ownedCount() });
          return { action: 'moved', channelId: existing.channelId };
        }
        this.store.remove(existing.channelId);
      }
      if (this.ownedCount() >= this.maxChannels) {
        this.log({ action: 'limit', owned: this.ownedCount() });
        return { action: 'ignored', reason: 'limit' };
      }
      const name = channelNameFor(this.bot, member.displayName || member.user?.globalName || member.user?.username);
      const channel = await guild.channels.create({
        name,
        type: ChannelType.GuildVoice,
        parent: this.config.categoryId,
        reason: 'Nexus join-to-create'
      });
      if (!channel?.id || String(channel.id) === this.config.lobbyId) {
        this.log({ action: 'failed', owned: this.ownedCount(), errorClass: 'channel' });
        return { action: 'failed', reason: 'channel' };
      }
      this.store.upsert({
        channelId: channel.id,
        creatorId: userId,
        guildId: guild.id,
        categoryId: this.config.categoryId,
        createdAt: new Date(this.now()).toISOString()
      });
      try {
        await member.voice.setChannel(channel, 'join-to-create');
      } catch (error) {
        this.scheduleDelete(guild, channel.id);
        this.log({ action: 'failed', owned: this.ownedCount(), errorClass: errorClass(error) });
        return { action: 'failed', reason: 'move', errorClass: errorClass(error) };
      }
      this.log({ action: 'created', owned: this.ownedCount() });
      return { action: 'created', channelId: String(channel.id), name };
    } catch (error) {
      this.log({ action: 'failed', owned: this.ownedCount(), errorClass: errorClass(error) });
      return { action: 'failed', reason: 'create', errorClass: errorClass(error) };
    } finally {
      this.creating.delete(userId);
    }
  }

  async noteDeparture(guild, channelId) {
    if (!channelId || channelId === this.config.lobbyId || !this.store.get(channelId)) return { action: 'ignored', reason: 'untracked' };
    const channel = await this.fetchChannel(guild, channelId);
    if (channel && memberCount(channel) > 0) {
      this.cancelDelete(channelId);
      return { action: 'ignored', reason: 'occupied' };
    }
    this.scheduleDelete(guild, channelId);
    return { action: 'scheduled', channelId };
  }

  scheduleDelete(guild, channelId) {
    if (!channelId || channelId === this.config.lobbyId || !this.store.get(channelId)) return;
    this.cancelDelete(channelId);
    const timer = setTimeout(() => {
      this.timers.delete(channelId);
      void this.deleteIfEmpty(guild, channelId);
    }, this.graceMs);
    timer.unref?.();
    this.timers.set(channelId, timer);
  }

  cancelDelete(channelId) {
    const timer = this.timers.get(channelId);
    if (timer) clearTimeout(timer);
    this.timers.delete(channelId);
  }

  async deleteIfEmpty(guild, channelId) {
    if (!channelId || channelId === this.config.lobbyId) return { action: 'ignored', reason: 'lobby' };
    if (!this.store.get(channelId)) return { action: 'ignored', reason: 'untracked' };
    const channel = await this.fetchChannel(guild, channelId);
    if (channel && memberCount(channel) > 0) return { action: 'ignored', reason: 'occupied' };
    try {
      if (channel && typeof channel.delete === 'function') await channel.delete('join-to-create empty');
    } catch (error) {
      this.log({ action: 'failed', owned: this.ownedCount(), errorClass: errorClass(error) });
      return { action: 'failed', reason: 'delete', errorClass: errorClass(error) };
    }
    this.store.remove(channelId);
    this.log({ action: 'deleted', owned: this.ownedCount() });
    return { action: 'deleted', channelId };
  }

  async reconcile(client) {
    let removed = 0;
    for (const row of this.store.list()) {
      if (row.channelId === this.config.lobbyId) {
        this.store.remove(row.channelId);
        removed += 1;
        continue;
      }
      if (this.config.guildId && row.guildId && row.guildId !== this.config.guildId) continue;
      let guild = null;
      try {
        guild = typeof client?.guilds?.fetch === 'function' ? await client.guilds.fetch(row.guildId) : null;
      } catch {
        guild = null;
      }
      const channel = guild ? await this.fetchChannel(guild, row.channelId) : null;
      if (!channel) {
        this.store.remove(row.channelId);
        removed += 1;
        continue;
      }
      if (memberCount(channel) === 0) this.scheduleDelete(guild, row.channelId);
    }
    this.log({ action: 'reconcile', owned: this.ownedCount(), errorClass: removed ? 'stale' : 'none' });
    return { owned: this.ownedCount(), removed };
  }

  stop() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

function installJoinToCreate(client, { bot, env = process.env, controller } = {}) {
  const key = normalizeBot(bot);
  if (!client || client[INSTALLED] || !key) return { client, controller: null };
  const jtc = controller || new JoinToCreate({ bot: key, env });
  client[INSTALLED] = true;
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    void jtc.handleVoiceState(oldState, newState).catch((error) => {
      logJtc(key, { action: 'failed', owned: jtc.ownedCount(), errorClass: errorClass(error) });
    });
  });
  if (typeof client.once === 'function') {
    client.once(Events.ClientReady, () => {
      void jtc.reconcile(client).catch((error) => {
        logJtc(key, { action: 'failed', owned: jtc.ownedCount(), errorClass: errorClass(error) });
      });
    });
  }
  return { client, controller: jtc };
}

module.exports = {
  GAME_BOT_JTC_MODULES,
  OWNER_JTC_LOBBY_IDS,
  MODULE_SET,
  resolveJtcConfig,
  jtcStatusLine,
  cleanDisplayName,
  channelNameFor,
  JoinToCreate,
  installJoinToCreate
};
