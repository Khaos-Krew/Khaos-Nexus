'use strict';

const { ChannelType } = require('discord.js');
const { getModule } = require('../backend/modules/catalog.cjs');
const { layoutFor } = require('./module-layouts.cjs');
const { bestCategoryMatch } = require('./module-provisioner.cjs');
const { inspectModuleAccessPolicy } = require('./module-access-policy.cjs');
const { isVoiceCategoryName, respectsManualLayout } = require('./manual-layout.cjs');
const { managedTextChannels, playerVoiceCategoryId } = require('./layout-profile.cjs');

async function inspectModuleLayout(guild, moduleId, options = {}) {
  const module = getModule(moduleId);
  if (!module) throw new Error(`Unknown module: ${moduleId}`);
  const layout = layoutFor(moduleId);
  const channels = await guild.channels.fetch();
  const exactCategory = channels.find((channel) => channel?.type === ChannelType.GuildCategory && channel.name === layout.category) || null;
  const match = exactCategory ? { category: exactCategory, score: 1 } : bestCategoryMatch(channels, moduleId);
  const category = match?.category || null;
  const textNames = managedTextChannels(moduleId, options.config || {}, {
    respectManual: respectsManualLayout(options.config || {}, guild.id),
    layout
  });
  const text = textNames.map((name) => {
    const channel = [...channels.values()].find((item) => item?.type === ChannelType.GuildText && item.name === name) || null;
    return { name, exists: Boolean(channel), id: channel ? String(channel.id) : '' };
  });
  const voiceId = playerVoiceCategoryId(options.config || {});
  const lobbies = [...channels.values()].filter((item) => item?.type === ChannelType.GuildVoice && item.name === layout.lobbyBuilder);
  const lobby = lobbies.find((item) => voiceId && String(item.parentId || '') === voiceId)
    || lobbies.find((item) => isVoiceCategoryName(channels.get?.(item.parentId)?.name))
    || lobbies[0]
    || null;
  const missingChannels = text.filter((item) => !item.exists).map((item) => item.name);
  if (!lobby) missingChannels.push(layout.lobbyBuilder);
  const accessPolicy = category && options.state
    ? await inspectModuleAccessPolicy(guild, moduleId, category, options)
    : null;
  return {
    moduleId,
    name: module.name,
    ok: true,
    complete: Boolean(category && missingChannels.length === 0 && (!accessPolicy || accessPolicy.ok)),
    expectedCategory: layout.category,
    category: category ? { id: String(category.id), name: String(category.name), matchScore: Number(match?.score || 0) } : null,
    textChannels: text,
    lobbyBuilder: { name: layout.lobbyBuilder, exists: Boolean(lobby), id: lobby ? String(lobby.id) : '' },
    missingChannels,
    accessPolicy
  };
}

module.exports = { inspectModuleLayout };
