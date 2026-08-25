'use strict';

const { ChannelType } = require('discord.js');
const { getModule, MODULES } = require('../backend/modules/catalog.cjs');
const { layoutFor } = require('./module-layouts.cjs');
const { reconcileModuleAccessPolicy } = require('./module-access-policy.cjs');

const CATEGORY_MATCH_THRESHOLD = 0.72;

function cleanLobbyOwner(value) {
  const cleaned = String(value || 'Player').replace(/[\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  return (cleaned || 'Player').slice(0, 60);
}

function normalizeDiscordName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((part) => !['khaos', 'nexus', 'server', 'servers', 'game', 'games', 'module', 'modules', 'category', 'hub', 'the'].includes(part))
    .join(' ')
    .trim();
}

function similarityScore(left, right) {
  const a = normalizeDiscordName(left);
  const b = normalizeDiscordName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const aTokens = new Set(a.split(' '));
  const bTokens = new Set(b.split(' '));
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  const jaccard = union ? intersection / union : 0;
  const containment = Math.min(aTokens.size, bTokens.size) ? intersection / Math.min(aTokens.size, bTokens.size) : 0;
  const substring = a.includes(b) || b.includes(a) ? Math.min(a.length, b.length) / Math.max(a.length, b.length) : 0;
  return Math.max(jaccard, containment * 0.92, substring);
}

function categoryCandidates(moduleId) {
  const module = getModule(moduleId);
  const layout = layoutFor(moduleId);
  return [...new Set([layout.categoryDisplay, layout.category, module?.name, ...(layout.aliases || [])].filter(Boolean))];
}

function desiredCategoryName(moduleId) {
  const layout = layoutFor(moduleId);
  return String(layout.categoryDisplay || layout.category);
}

function bestCategoryMatch(channels, moduleId) {
  const categories = [...channels.values()].filter((channel) => channel?.type === ChannelType.GuildCategory);
  const candidates = categoryCandidates(moduleId);
  let best = null;
  for (const category of categories) {
    const score = Math.max(...candidates.map((candidate) => similarityScore(category.name, candidate)));
    if (!best || score > best.score) best = { category, score };
  }
  return best && best.score >= CATEGORY_MATCH_THRESHOLD ? best : null;
}

function uniqueNamedChannel(channels, type, name) {
  const matches = [...channels.values()].filter((channel) => channel?.type === type && channel?.name === name);
  return matches.length === 1 ? matches[0] : null;
}

class ModuleProvisioner {
  constructor({ state, config = {}, maxLobbiesPerModule = 20 } = {}) {
    this.state = state;
    this.config = config || {};
    this.maxLobbiesPerModule = Math.max(1, Number(maxLobbiesPerModule) || 20);
  }

  async category(guild, moduleId, categoryId = '') {
    const layout = layoutFor(moduleId);
    const displayName = desiredCategoryName(moduleId);
    if (categoryId) {
      const selected = await guild.channels.fetch(String(categoryId));
      if (!selected || selected.type !== ChannelType.GuildCategory) throw new Error('The selected Discord channel is not a category.');
      return { category: selected, created: false, matchScore: 1, source: 'selected' };
    }

    const all = await guild.channels.fetch();
    const exact = all.find((channel) => channel?.type === ChannelType.GuildCategory
      && [displayName, layout.category].includes(String(channel.name || '')));
    if (exact) return { category: exact, created: false, matchScore: 1, source: 'exact' };

    const similar = bestCategoryMatch(all, moduleId);
    if (similar) return { category: similar.category, created: false, matchScore: similar.score, source: 'similar' };

    const created = await guild.channels.create({ name: displayName, type: ChannelType.GuildCategory, reason: `Nexus Sentinal module setup: ${moduleId}` });
    return { category: created, created: true, matchScore: 0, source: 'created' };
  }

  async textChannel(guild, category, name) {
    const all = await guild.channels.fetch();
    const existing = all.find((channel) => channel?.type === ChannelType.GuildText && channel.parentId === category.id && channel.name === name);
    if (existing) return { channel: existing, created: false, moved: false };

    // A previous fuzzy-category mistake can leave a uniquely named managed channel
    // under the wrong module. Move that channel instead of creating a duplicate and
    // abandoning its messages/history.
    const movable = uniqueNamedChannel(all, ChannelType.GuildText, name);
    if (movable && typeof movable.setParent === 'function') {
      await movable.setParent(category.id, { lockPermissions: true, reason: 'Nexus Sentinal module category repair' });
      return { channel: movable, created: false, moved: true };
    }

    const created = await guild.channels.create({ name, type: ChannelType.GuildText, parent: category.id, reason: 'Nexus Sentinal module setup/repair' });
    return { channel: created, created: true, moved: false };
  }

  async lobbyBuilder(guild, category, name) {
    const all = await guild.channels.fetch();
    const existing = all.find((channel) => channel?.type === ChannelType.GuildVoice && channel.parentId === category.id && channel.name === name);
    if (existing) return { channel: existing, created: false, moved: false };

    const movable = uniqueNamedChannel(all, ChannelType.GuildVoice, name);
    if (movable && typeof movable.setParent === 'function') {
      await movable.setParent(category.id, { lockPermissions: true, reason: 'Nexus Sentinal join-to-build category repair' });
      return { channel: movable, created: false, moved: true };
    }

    const created = await guild.channels.create({ name, type: ChannelType.GuildVoice, parent: category.id, reason: 'Nexus Sentinal join-to-build lobby setup/repair' });
    return { channel: created, created: true, moved: false };
  }

  async provision(guild, moduleId, categoryId = '') {
    const module = getModule(moduleId);
    if (!module) throw new Error(`Unknown module: ${moduleId}`);
    const layout = layoutFor(moduleId);
    const categoryResult = await this.category(guild, moduleId, categoryId);
    const category = categoryResult.category;
    const textChannels = [];
    const createdChannels = [];
    const movedChannels = [];

    for (const name of layout.text) {
      const result = await this.textChannel(guild, category, name);
      textChannels.push({ name, id: String(result.channel.id) });
      if (result.created) createdChannels.push(name);
      if (result.moved) movedChannels.push(name);
    }

    const builderResult = await this.lobbyBuilder(guild, category, layout.lobbyBuilder);
    const builder = builderResult.channel;
    if (builderResult.created) createdChannels.push(layout.lobbyBuilder);
    if (builderResult.moved) movedChannels.push(layout.lobbyBuilder);
    const accessPolicy = await reconcileModuleAccessPolicy(guild, moduleId, category, { state: this.state, config: this.config });
    const consoleChannel = textChannels.find((channel) => channel.name === layout.consoleChannel) || textChannels[0] || null;
    const setup = {
      moduleId,
      guildId: String(guild.id),
      categoryId: String(category.id),
      categoryName: String(category.name),
      categoryCreated: categoryResult.created,
      categorySource: categoryResult.source,
      categoryMatchScore: Number(categoryResult.matchScore.toFixed(3)),
      consoleChannelId: consoleChannel?.id || '',
      textChannels,
      lobbyBuilderChannelId: String(builder.id),
      lobbyBuilderName: String(builder.name),
      createdChannels,
      movedChannels,
      accessPolicy: {
        ok: Boolean(accessPolicy.ok),
        skipped: Boolean(accessPolicy.skipped),
        accessRoleId: String(accessPolicy.accessRoleId || ''),
        accessRoleName: String(accessPolicy.accessRoleName || ''),
        permissionChanges: Number(accessPolicy.changed || 0),
        reason: String(accessPolicy.reason || '')
      },
      updatedAt: new Date().toISOString()
    };
    this.state.setModuleSetup(moduleId, setup);
    return setup;
  }

  async discoverModuleIds(guild) {
    const discovered = new Set(Object.keys(this.state.listModuleSetups()));
    const all = await guild.channels.fetch();
    for (const module of MODULES) {
      if (bestCategoryMatch(all, module.id)) discovered.add(module.id);
    }
    return [...discovered].filter((moduleId) => getModule(moduleId));
  }

  setupForBuilder(guildId, channelId) {
    return Object.values(this.state.listModuleSetups()).find((setup) => setup.guildId === String(guildId) && setup.lobbyBuilderChannelId === String(channelId)) || null;
  }

  async createOrReuseLobby(member, setup) {
    const existingState = this.state.findTempLobbyByOwner(setup.moduleId, String(member.id));
    if (existingState) {
      try {
        const existing = await member.guild.channels.fetch(existingState.channelId);
        if (existing?.type === ChannelType.GuildVoice) {
          await member.voice.setChannel(existing, 'Nexus Sentinal: return to temporary lobby');
          return existing;
        }
      } catch {}
      this.state.removeTempLobby(existingState.channelId);
    }

    const active = Object.values(this.state.listTempLobbies()).filter((lobby) => lobby.moduleId === setup.moduleId).length;
    if (active >= this.maxLobbiesPerModule) throw new Error(`The ${setup.moduleId} temporary lobby limit has been reached.`);
    const owner = cleanLobbyOwner(member.displayName || member.user?.globalName || member.user?.username);
    const lobby = await member.guild.channels.create({
      name: `🎮 ${owner}'s Lobby`,
      type: ChannelType.GuildVoice,
      parent: setup.categoryId,
      reason: `Nexus Sentinal temporary ${setup.moduleId} lobby`
    });
    this.state.setTempLobby(String(lobby.id), {
      channelId: String(lobby.id), moduleId: setup.moduleId, guildId: String(member.guild.id),
      categoryId: setup.categoryId, ownerId: String(member.id), createdAt: new Date().toISOString()
    });
    await member.voice.setChannel(lobby, 'Nexus Sentinal join-to-build lobby');
    return lobby;
  }

  async removeLobbyIfEmpty(guild, channelId) {
    if (!this.state.getTempLobby(String(channelId))) return false;
    try {
      const channel = await guild.channels.fetch(String(channelId));
      if (channel?.type === ChannelType.GuildVoice && channel.members.size > 0) return false;
      if (channel) await channel.delete('Nexus Sentinal temporary lobby empty');
    } catch {}
    this.state.removeTempLobby(String(channelId));
    return true;
  }

  async handleVoiceState(oldState, newState) {
    if (oldState.channelId) await this.removeLobbyIfEmpty(oldState.guild, oldState.channelId);
    if (!newState.channelId || !newState.member) return;
    const setup = this.setupForBuilder(newState.guild.id, newState.channelId);
    if (!setup) return;
    try { await this.createOrReuseLobby(newState.member, setup); }
    catch (error) { console.error(`[Sentinal] join-to-build ${setup.moduleId}:`, error.message); }
  }

  async cleanupOrphanedLobbies(client) {
    for (const [channelId, lobby] of Object.entries(this.state.listTempLobbies())) {
      try {
        const guild = await client.guilds.fetch(lobby.guildId);
        const channel = await guild.channels.fetch(channelId);
        if (!channel) this.state.removeTempLobby(channelId);
        else if (channel.type === ChannelType.GuildVoice && channel.members.size === 0) {
          await channel.delete('Nexus Sentinal startup cleanup');
          this.state.removeTempLobby(channelId);
        }
      } catch { this.state.removeTempLobby(channelId); }
    }
  }
}

module.exports = {
  CATEGORY_MATCH_THRESHOLD,
  ModuleProvisioner,
  bestCategoryMatch,
  categoryCandidates,
  cleanLobbyOwner,
  desiredCategoryName,
  normalizeDiscordName,
  similarityScore,
  uniqueNamedChannel
};
