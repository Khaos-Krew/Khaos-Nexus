'use strict';

const { ChannelType } = require('discord.js');
const { getModule, MODULES } = require('../backend/modules/catalog.cjs');
const { GAME_BOT_JTC_MODULES } = require('../game-bots/join-to-create.cjs');
const { layoutFor } = require('./module-layouts.cjs');
const { reconcileModuleAccessPolicy } = require('./module-access-policy.cjs');
const { assertModuleChannelsProvisionable } = require('./no-provision-modules.cjs');
const {
  channelParentIsPlayerVoice,
  findPlayerVoiceCategory,
  hiddenFromEveryone,
  isProtectedLayoutCategory,
  isStaffLocated,
  playerVoiceCategoryEnabled,
  respectsManualLayout,
  slimGameLayoutEnabled
} = require('./manual-layout.cjs');
const { isSlimGameModule, textNamesForLayout } = require('./layout-collapse.cjs');
const { isSentinalTempVoiceChannel } = require('./temp-voice.cjs');

const GAME_BOT_JTC = new Set(GAME_BOT_JTC_MODULES);

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
    if (isProtectedLayoutCategory(category.name)) continue;
    const score = Math.max(...candidates.map((candidate) => similarityScore(category.name, candidate)));
    if (!best || score > best.score) best = { category, score };
  }
  return best && best.score >= CATEGORY_MATCH_THRESHOLD ? best : null;
}

function uniqueNamedChannel(channels, type, name) {
  const matches = [...channels.values()].filter((channel) => channel?.type === type && channel?.name === name);
  return matches.length === 1 ? matches[0] : null;
}

function namedChannels(channels, type, name) {
  return [...channels.values()].filter((channel) => channel?.type === type && channel?.name === name);
}

async function triggerParentId(guild, triggerChannel, fallbackCategoryId = '') {
  let parentId = String(triggerChannel?.parentId || '');
  if (!parentId && triggerChannel?.id && typeof guild?.channels?.fetch === 'function') {
    const fetched = await guild.channels.fetch(String(triggerChannel.id)).catch(() => null);
    parentId = String(fetched?.parentId || '');
  }
  return parentId || String(fallbackCategoryId || '');
}

// Channels that already live somewhere else stay there. A channel hidden from
// @everyone is never recreated. Only a same-named channel with no parent is
// still filed into the game category, which is the old repair for an uncategorized
// channel and does not pull consoles out of STAFF or triggers out of VOICE.
async function resolveManagedChannel(guild, category, name, type, { createMissing = true, moveReason = 'Nexus Sentinal module category repair' } = {}) {
  const all = await guild.channels.fetch();
  // The open lobby and its rooms are not module channels. Repair must not
  // move them or sync category permissions onto them.
  const named = namedChannels(all, type, name).filter((channel) => !isSentinalTempVoiceChannel(channel));
  const categoryId = String(category?.id || '');
  const inCategory = named.find((channel) => String(channel?.parentId || '') === categoryId);
  if (inCategory) return { channel: inCategory, created: false, moved: false, relocated: false, hidden: hiddenFromEveryone(inCategory, guild.id) };

  const elsewhere = named.filter((channel) => String(channel?.parentId || '') && String(channel.parentId) !== categoryId);
  if (elsewhere.length) {
    const hidden = elsewhere.find((channel) => hiddenFromEveryone(channel, guild.id)) || null;
    const chosen = hidden || elsewhere[0];
    return {
      channel: chosen,
      created: false,
      moved: false,
      relocated: true,
      hidden: hiddenFromEveryone(chosen, guild.id)
    };
  }

  const hidden = named.find((channel) => hiddenFromEveryone(channel, guild.id));
  if (hidden) {
    return { channel: hidden, created: false, moved: false, relocated: false, hidden: true };
  }

  const orphan = named.find((channel) => !channel?.parentId);
  if (orphan && createMissing && typeof orphan.setParent === 'function') {
    await orphan.setParent(categoryId, { lockPermissions: true, reason: moveReason });
    return { channel: orphan, created: false, moved: true, relocated: false, hidden: false };
  }

  if (!createMissing) return { channel: null, created: false, moved: false, relocated: false, hidden: false, skipped: true };

  const created = await guild.channels.create({
    name,
    type,
    parent: categoryId,
    reason: 'Nexus Sentinal module setup/repair'
  });
  return { channel: created, created: true, moved: false, relocated: false, hidden: false };
}

async function renameManagedCategory(category, moduleId) {
  const desired = desiredCategoryName(moduleId);
  if (!category || !desired || String(category.name || '') === desired || typeof category.setName !== 'function') {
    return { category, renamed: false };
  }
  await category.setName(desired, `Nexus Sentinal canonical module category: ${moduleId}`);
  return { category, renamed: true };
}

class ModuleProvisioner {
  constructor({ state, config = {}, maxLobbiesPerModule = 20 } = {}) {
    this.state = state;
    this.config = config || {};
    this.maxLobbiesPerModule = Math.max(1, Number(maxLobbiesPerModule) || 20);
  }

  async category(guild, moduleId, categoryId = '') {
    // Shared choke point: every path that finds/creates a module category runs here.
    assertModuleChannelsProvisionable(moduleId, this.config);
    const layout = layoutFor(moduleId);
    const displayName = desiredCategoryName(moduleId);
    if (categoryId) {
      const selected = await guild.channels.fetch(String(categoryId));
      if (!selected || selected.type !== ChannelType.GuildCategory) throw new Error('The selected Discord channel is not a category.');
      return { category: selected, created: false, renamed: false, matchScore: 1, source: 'selected' };
    }

    const all = await guild.channels.fetch();
    const displayExact = all.find((channel) => channel?.type === ChannelType.GuildCategory && String(channel.name || '') === displayName);
    if (displayExact) return { category: displayExact, created: false, renamed: false, matchScore: 1, source: 'exact' };

    const legacyExact = all.find((channel) => channel?.type === ChannelType.GuildCategory && String(channel.name || '') === layout.category);
    if (legacyExact) {
      const renamed = await renameManagedCategory(legacyExact, moduleId);
      return { category: renamed.category, created: false, renamed: renamed.renamed, matchScore: 1, source: renamed.renamed ? 'renamed' : 'legacy-exact' };
    }

    const similar = bestCategoryMatch(all, moduleId);
    if (similar) {
      const renamed = await renameManagedCategory(similar.category, moduleId);
      return { category: renamed.category, created: false, renamed: renamed.renamed, matchScore: similar.score, source: renamed.renamed ? 'adopted-renamed' : 'similar' };
    }

    const created = await guild.channels.create({ name: displayName, type: ChannelType.GuildCategory, reason: `Nexus Sentinal module setup: ${moduleId}` });
    return { category: created, created: true, renamed: false, matchScore: 0, source: 'created' };
  }

  async textChannel(guild, category, name, options = {}) {
    return resolveManagedChannel(guild, category, name, ChannelType.GuildText, {
      createMissing: options.createMissing !== false,
      moveReason: 'Nexus Sentinal module category repair'
    });
  }

  async lobbyBuilder(guild, category, name, options = {}) {
    return resolveManagedChannel(guild, category, name, ChannelType.GuildVoice, {
      createMissing: options.createMissing !== false,
      moveReason: 'Nexus Sentinal join-to-build category repair'
    });
  }

  async provision(guild, moduleId, categoryId = '') {
    const module = getModule(moduleId);
    if (!module) throw new Error(`Unknown module: ${moduleId}`);
    assertModuleChannelsProvisionable(moduleId, this.config);
    const layout = layoutFor(moduleId);
    const categoryResult = await this.category(guild, moduleId, categoryId);
    const category = categoryResult.category;
    const textChannels = [];
    const createdChannels = [];
    const movedChannels = [];
    const preserveManualLayout = respectsManualLayout(this.config, guild.id);
    const slimLayout = slimGameLayoutEnabled(this.config, guild.id) && isSlimGameModule(moduleId);
    const textNames = textNamesForLayout(moduleId, layout, { slim: slimLayout, preserveManualLayout });

    for (const name of textNames) {
      const result = await this.textChannel(guild, category, name);
      if (!result.channel) continue;
      textChannels.push({
        name,
        id: String(result.channel.id),
        relocated: Boolean(result.relocated),
        hidden: Boolean(result.hidden)
      });
      if (result.created) createdChannels.push(name);
      if (result.moved) movedChannels.push(name);
    }

    const playerVoice = playerVoiceCategoryEnabled(this.config, guild.id);
    const topology = await guild.channels.fetch();
    const voiceCategory = playerVoice
      ? findPlayerVoiceCategory(topology, { categoryId: this.config.discord?.playerVoiceCategoryId || '' })
      : null;
    // A missing builder is created under VOICE only when that category exists.
    // It is never created back under the game category while the flag is on.
    const lobbyParent = playerVoice && voiceCategory ? voiceCategory : category;
    const createLobby = playerVoice ? Boolean(voiceCategory) : !preserveManualLayout;
    const builderResult = await this.lobbyBuilder(guild, lobbyParent, layout.lobbyBuilder, { createMissing: createLobby });
    if (playerVoice && voiceCategory && builderResult.channel && !builderResult.created) {
      const parentId = String(builderResult.channel.parentId || '');
      const inGameCategory = parentId === String(category.id);
      const inStaff = isStaffLocated(builderResult.channel, topology);
      const alreadyInVoice = parentId === String(voiceCategory.id) || channelParentIsPlayerVoice(builderResult.channel, topology);
      if (inGameCategory && !inStaff && !alreadyInVoice && typeof builderResult.channel.setParent === 'function') {
        await builderResult.channel.setParent(String(voiceCategory.id), {
          lockPermissions: false,
          reason: 'Nexus Sentinal: keep join-to-create lobby in the player Voice category'
        });
        builderResult.channel.parentId = String(voiceCategory.id);
        builderResult.moved = true;
        builderResult.relocated = false;
      }
    }
    const builder = builderResult.channel;
    if (builder && builderResult.created) createdChannels.push(layout.lobbyBuilder);
    if (builder && builderResult.moved) movedChannels.push(layout.lobbyBuilder);
    const accessPolicy = await reconcileModuleAccessPolicy(guild, moduleId, category, { state: this.state, config: this.config });
    const consoleChannel = textChannels.find((channel) => channel.name === layout.consoleChannel) || textChannels[0] || null;
    const setup = {
      moduleId,
      guildId: String(guild.id),
      categoryId: String(category.id),
      categoryName: String(category.name),
      categoryCreated: categoryResult.created,
      categoryRenamed: Boolean(categoryResult.renamed),
      categorySource: categoryResult.source,
      categoryMatchScore: Number(categoryResult.matchScore.toFixed(3)),
      consoleChannelId: consoleChannel?.id || '',
      textChannels,
      lobbyBuilderChannelId: builder ? String(builder.id) : '',
      lobbyBuilderName: builder ? String(builder.name) : '',
      lobbyRelocated: Boolean(builderResult.relocated),
      lobbyHidden: Boolean(builderResult.hidden),
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

  async createOrReuseLobby(member, setup, triggerChannel = null) {
    // ARK, Warframe, and Diablo IV rooms are opened by their game bots.
    // Those bots also parent the room on the builder's current category.
    if (GAME_BOT_JTC.has(setup?.moduleId)) return null;
    const parentId = await triggerParentId(member?.guild, triggerChannel, setup?.categoryId);
    const existingState = this.state.findTempLobbyByOwner(setup.moduleId, String(member.id));
    if (existingState) {
      try {
        const existing = await member.guild.channels.fetch(existingState.channelId);
        if (existing?.type === ChannelType.GuildVoice) {
          if (parentId && String(existing.parentId || '') !== parentId && typeof existing.setParent === 'function') {
            await existing.setParent(parentId, { lockPermissions: false, reason: 'Nexus Sentinal: keep temporary lobby with its join-to-create trigger' });
            this.state.setTempLobby(String(existing.id), { ...existingState, categoryId: parentId });
          }
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
      parent: parentId,
      reason: `Nexus Sentinal temporary ${setup.moduleId} lobby`
    });
    this.state.setTempLobby(String(lobby.id), {
      channelId: String(lobby.id), moduleId: setup.moduleId, guildId: String(member.guild.id),
      categoryId: parentId, ownerId: String(member.id), createdAt: new Date().toISOString()
    });
    await member.voice.setChannel(lobby, 'Nexus Sentinal join-to-build lobby');
    return lobby;
  }

  async removeLobbyIfEmpty(guild, channelId) {
    if (!this.state.getTempLobby(String(channelId))) return false;
    try {
      const channel = await guild.channels.fetch(String(channelId));
      if (isSentinalTempVoiceChannel(channel)) {
        this.state.removeTempLobby(String(channelId));
        return false;
      }
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
    if (!setup || GAME_BOT_JTC.has(setup.moduleId)) return;
    let trigger = newState.channel || null;
    if (!String(trigger?.parentId || '') && newState.channelId && typeof newState.guild?.channels?.fetch === 'function') {
      trigger = await newState.guild.channels.fetch(newState.channelId).catch(() => trigger);
    }
    try { await this.createOrReuseLobby(newState.member, setup, trigger); }
    catch (error) { console.error(`[Sentinal] join-to-build ${setup.moduleId}:`, error.message); }
  }

  async cleanupOrphanedLobbies(client) {
    for (const [channelId, lobby] of Object.entries(this.state.listTempLobbies())) {
      try {
        const guild = await client.guilds.fetch(lobby.guildId);
        const channel = await guild.channels.fetch(channelId);
        if (!channel) this.state.removeTempLobby(channelId);
        else if (isSentinalTempVoiceChannel(channel)) this.state.removeTempLobby(channelId);
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
  renameManagedCategory,
  similarityScore,
  uniqueNamedChannel,
  resolveManagedChannel,
  triggerParentId
};
