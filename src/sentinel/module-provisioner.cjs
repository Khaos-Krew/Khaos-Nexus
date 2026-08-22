'use strict';

const { ChannelType } = require('discord.js');
const { getModule } = require('../backend/modules/catalog.cjs');
const { layoutFor } = require('./module-layouts.cjs');

function cleanLobbyOwner(value) {
  const cleaned = String(value || 'Player').replace(/[\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  return (cleaned || 'Player').slice(0, 60);
}

class ModuleProvisioner {
  constructor({ state, maxLobbiesPerModule = 20 } = {}) {
    this.state = state;
    this.maxLobbiesPerModule = Math.max(1, Number(maxLobbiesPerModule) || 20);
  }

  async category(guild, moduleId, categoryId = '') {
    const layout = layoutFor(moduleId);
    if (categoryId) {
      const selected = await guild.channels.fetch(String(categoryId));
      if (!selected || selected.type !== ChannelType.GuildCategory) throw new Error('The selected Discord channel is not a category.');
      return selected;
    }
    const all = await guild.channels.fetch();
    const existing = all.find((channel) => channel?.type === ChannelType.GuildCategory && channel.name === layout.category);
    if (existing) return existing;
    return guild.channels.create({ name: layout.category, type: ChannelType.GuildCategory, reason: `Nexus Sentinal module setup: ${moduleId}` });
  }

  async textChannel(guild, category, name) {
    const all = await guild.channels.fetch();
    const existing = all.find((channel) => channel?.type === ChannelType.GuildText && channel.parentId === category.id && channel.name === name);
    if (existing) return existing;
    return guild.channels.create({ name, type: ChannelType.GuildText, parent: category.id, reason: 'Nexus Sentinal module setup' });
  }

  async lobbyBuilder(guild, category, name) {
    const all = await guild.channels.fetch();
    const existing = all.find((channel) => channel?.type === ChannelType.GuildVoice && channel.parentId === category.id && channel.name === name);
    if (existing) return existing;
    return guild.channels.create({ name, type: ChannelType.GuildVoice, parent: category.id, reason: 'Nexus Sentinal join-to-build lobby setup' });
  }

  async provision(guild, moduleId, categoryId = '') {
    const module = getModule(moduleId);
    if (!module) throw new Error(`Unknown module: ${moduleId}`);
    const layout = layoutFor(moduleId);
    const category = await this.category(guild, moduleId, categoryId);
    const textChannels = [];
    for (const name of layout.text) {
      const channel = await this.textChannel(guild, category, name);
      textChannels.push({ name, id: String(channel.id) });
    }
    const builder = await this.lobbyBuilder(guild, category, layout.lobbyBuilder);
    const consoleChannel = textChannels.find((channel) => channel.name === layout.consoleChannel) || textChannels[0] || null;
    const setup = {
      moduleId,
      guildId: String(guild.id),
      categoryId: String(category.id),
      categoryName: String(category.name),
      consoleChannelId: consoleChannel?.id || '',
      textChannels,
      lobbyBuilderChannelId: String(builder.id),
      lobbyBuilderName: String(builder.name),
      updatedAt: new Date().toISOString()
    };
    this.state.setModuleSetup(moduleId, setup);
    return setup;
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

module.exports = { ModuleProvisioner, cleanLobbyOwner };
