'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType
} = require('discord.js');
const { findHqCategory, normalizedName } = require('./nexus-hq.cjs');
const { managedPayloadMatches } = require('./managed-payload-compare.cjs');
const { paragraphs, spacedItems } = require('./embed-layout.cjs');

const COMMAND_CHANNEL_NAME = 'nexus-commands';
const COMMAND_CHANNEL_TOPIC = 'Run non-game Khaos Nexus commands here. Use the buttons for common community tools; game-specific commands stay in their game hubs.';
const COMMAND_PANEL_MARKER = 'Nexus Sentinal • Managed Nexus Commands • v1';
const COMMAND_BUTTON_PREFIX = 'nxcmd:';
const SUGGESTION_BUTTON_ID = 'kn:suggest:new';
const COMMAND_ACTIONS = Object.freeze(['level', 'achievements', 'leaderboard', 'roles', 'events', 'polls', 'help']);
const STRONG_CHANNEL_ALIASES = Object.freeze(['nexus-commands', 'nexus-command-center', 'command-center']);
const WEAK_CHANNEL_ALIASES = Object.freeze(['commands', 'bot-commands']);

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function channelNameMatches(channel, names) {
  const wanted = new Set(names.map(normalizedName));
  return channel?.type === ChannelType.GuildText && wanted.has(normalizedName(channel.name));
}

function findCommandChannel(channels, hqId = '') {
  const all = valuesOf(channels);
  const underHq = all.find((channel) => String(channel?.parentId || '') === String(hqId || '')
    && channelNameMatches(channel, [...STRONG_CHANNEL_ALIASES, ...WEAK_CHANNEL_ALIASES]));
  if (underHq) return underHq;
  return all.find((channel) => channelNameMatches(channel, STRONG_CHANNEL_ALIASES)) || null;
}

function commandButton(action, label, emoji, style = ButtonStyle.Secondary) {
  return new ButtonBuilder()
    .setCustomId(`${COMMAND_BUTTON_PREFIX}${action}`)
    .setLabel(label)
    .setEmoji(emoji)
    .setStyle(style);
}

function commandPanelPayload() {
  return {
    embeds: [{
      title: '🌐 KHAOS NEXUS • COMMAND CENTER',
      color: 0xb00020,
      description: paragraphs(
        'Use this channel for **non-game Nexus commands**. The buttons below run the most common community tools without needing to remember slash commands.',
        '🎮 **Game-specific commands stay in their game hubs.** Game tools, feeds, builds, farming data, server controls, and module actions stay with the relevant game.'
      ),
      fields: [
        {
          name: '⚡ Community Progression',
          value: spacedItems([
            '`/level` — your XP and level card',
            '`/rank` — your community leaderboard position',
            '`/achievements` — badges and achievement progress',
            '`/leaderboard` — top community XP standings',
            '**Tip:** buttons return private results so this channel stays clean.'
          ]),
          inline: false
        },
        {
          name: '💡 Community Tools',
          value: spacedItems([
            '💡 **Suggestions** — submit a tracked community idea',
            '📅 **Events** — jump to official Nexus events',
            '🗳️ **Polls** — open managed community voting',
            '🎭 **Roles** — open the managed self-role controls',
            '❓ **Nexus Help** — show the public command reference'
          ]),
          inline: false
        },
        {
          name: '🛡️ Public Surface Only',
          value: paragraphs(
            'Staff administration, moderation, security, infrastructure, and privileged server controls are intentionally excluded from this panel.',
            'Those functions remain restricted to their dedicated staff or module surfaces.'
          ),
          inline: false
        }
      ],
      footer: { text: COMMAND_PANEL_MARKER }
    }],
    components: [
      new ActionRowBuilder().addComponents(
        commandButton('level', 'My Level', '⚡', ButtonStyle.Primary),
        commandButton('achievements', 'Achievements', '🏆'),
        commandButton('leaderboard', 'Leaderboard', '🏅'),
        commandButton('roles', 'Roles', '🎭'),
        commandButton('help', 'Nexus Help', '❓')
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(SUGGESTION_BUTTON_ID).setLabel('Submit Suggestion').setEmoji('💡').setStyle(ButtonStyle.Success),
        commandButton('events', 'Events', '📅'),
        commandButton('polls', 'Polls', '🗳️')
      )
    ],
    allowedMentions: { parse: [] }
  };
}

function commandPanelMatches(message, botId = '') {
  if (!message) return false;
  if (botId && String(message.author?.id || '') !== String(botId)) return false;
  return (message.embeds || []).some((embed) => String(embed?.footer?.text || '') === COMMAND_PANEL_MARKER);
}

async function reconcileCommandPanel(channel, options = {}) {
  const botId = String(options.botId || channel?.client?.user?.id || '');
  const payload = commandPanelPayload();
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const candidates = recent?.values
    ? [...recent.values()].filter((message) => commandPanelMatches(message, botId)).sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0))
    : [];
  let message = candidates[0] || null;
  let created = false;
  let updated = false;
  let pinned = false;
  let duplicatesRemoved = 0;

  if (!message) {
    message = await channel.send(payload);
    created = true;
  } else if (!managedPayloadMatches(message, payload)) {
    await message.edit(payload);
    updated = true;
  }

  if (message && message.pinned !== true && typeof message.pin === 'function') {
    try {
      await message.pin('Nexus Sentinal canonical public command center');
      pinned = true;
    } catch {}
  }

  for (const duplicate of candidates.slice(1)) {
    try {
      await duplicate.delete('Nexus Sentinal duplicate public command-center panel cleanup');
      duplicatesRemoved += 1;
    } catch {}
  }

  return { message, created, updated, pinned, duplicatesRemoved };
}

function channelSnapshot(guild) {
  const cache = guild?.channels?.cache;
  return cache && typeof cache.values === 'function' && cache.size ? cache : null;
}

async function ensureCommandChannel(guild, options = {}) {
  let channels = options.channels || channelSnapshot(guild) || await guild.channels.fetch();
  let hq = findHqCategory(channels);
  if (!hq && options.channels) {
    channels = channelSnapshot(guild) || await guild.channels.fetch();
    hq = findHqCategory(channels);
  }
  if (!hq) return { skipped: 'nexus-hq-missing' };

  let channel = findCommandChannel(channels, hq.id);
  let created = false;
  let moved = false;
  let renamed = false;
  let topicUpdated = false;
  let permissionsLocked = false;

  if (!channel) {
    channel = await guild.channels.create({
      name: COMMAND_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: hq.id,
      topic: COMMAND_CHANNEL_TOPIC,
      reason: 'Nexus Sentinal managed non-game command center'
    });
    channels?.set?.(String(channel.id), channel);
    created = true;
  } else {
    if (String(channel.parentId || '') !== String(hq.id) && typeof channel.setParent === 'function') {
      await channel.setParent(hq.id, { lockPermissions: false, reason: 'Move Nexus command center under NEXUS HQ' });
      moved = true;
    }
    if (String(channel.name || '') !== COMMAND_CHANNEL_NAME && typeof channel.setName === 'function') {
      await channel.setName(COMMAND_CHANNEL_NAME, 'Apply canonical Nexus command-center channel name');
      renamed = true;
    }
  }

  if (String(channel.topic || '') !== COMMAND_CHANNEL_TOPIC && typeof channel.setTopic === 'function') {
    await channel.setTopic(COMMAND_CHANNEL_TOPIC, 'Keep Nexus command-center purpose current');
    topicUpdated = true;
  }

  if (channel.permissionsLocked !== true && typeof channel.lockPermissions === 'function') {
    await channel.lockPermissions('Inherit Shadow Recruit+ NEXUS HQ access for the public command center');
    permissionsLocked = true;
  }

  return { channel, hq, created, moved, renamed, topicUpdated, permissionsLocked };
}

function parseCommandButtonId(customId = '') {
  const value = String(customId || '');
  if (!value.startsWith(COMMAND_BUTTON_PREFIX)) return null;
  const action = value.slice(COMMAND_BUTTON_PREFIX.length);
  return COMMAND_ACTIONS.includes(action) ? action : null;
}

function findNamedTextChannel(guild, names = [], parentId = '') {
  const wanted = new Set(names.map(normalizedName));
  const channels = valuesOf(guild?.channels?.cache);
  return channels.find((channel) => channel?.isTextBased?.()
    && (!parentId || String(channel.parentId || '') === String(parentId))
    && wanted.has(normalizedName(channel.name))) || null;
}

function publicHelpPayload(guild, hqId = '') {
  const roles = findNamedTextChannel(guild, ['roles', 'role-selection', 'self-roles', 'server-roles']);
  const suggestions = findNamedTextChannel(guild, ['suggestions'], hqId) || findNamedTextChannel(guild, ['suggestions']);
  const events = findNamedTextChannel(guild, ['events'], hqId) || findNamedTextChannel(guild, ['events']);
  const polls = findNamedTextChannel(guild, ['polls'], hqId) || findNamedTextChannel(guild, ['polls']);
  const ref = (channel, fallback) => channel?.id ? `<#${channel.id}>` : fallback;
  return {
    embeds: [{
      title: '❓ NEXUS HELP • PUBLIC COMMANDS',
      color: 0xb00020,
      description: paragraphs(
        'Quick reference for normal member-facing Nexus tools.',
        '🎮 Game-specific commands remain inside their respective game hubs.'
      ),
      fields: [
        {
          name: '⚡ Progression',
          value: spacedItems([
            '`/level` — progress card',
            '`/rank` — community rank card',
            '`/achievements` — badges and achievement progress',
            '`/leaderboard` — community XP leaderboard'
          ]),
          inline: false
        },
        { name: '🎭 Roles', value: paragraphs(`${ref(roles, 'Use the managed Roles channel')}`, 'Game access, platform, pronoun, and selectable name-color controls live there.'), inline: false },
        { name: '💡 Suggestions', value: paragraphs(`${ref(suggestions, '#suggestions')}`, 'Or use **Submit Suggestion** on the command-center panel.'), inline: false },
        { name: '📅 Events & Polls', value: spacedItems([`${ref(events, '#events')} — official Nexus events`, `${ref(polls, '#polls')} — managed community polls`]), inline: false },
        { name: '🎮 Game Commands', value: paragraphs('Open the relevant game hub for game data, builds, targeted loot, farming, market, server, and module-specific tools.'), inline: false }
      ],
      footer: { text: 'Nexus Sentinal • Public Command Reference' }
    }],
    allowedMentions: { parse: [] }
  };
}

module.exports = {
  COMMAND_CHANNEL_NAME,
  COMMAND_CHANNEL_TOPIC,
  COMMAND_PANEL_MARKER,
  COMMAND_BUTTON_PREFIX,
  SUGGESTION_BUTTON_ID,
  COMMAND_ACTIONS,
  STRONG_CHANNEL_ALIASES,
  WEAK_CHANNEL_ALIASES,
  valuesOf,
  findCommandChannel,
  commandPanelPayload,
  commandPanelMatches,
  reconcileCommandPanel,
  ensureCommandChannel,
  parseCommandButtonId,
  findNamedTextChannel,
  publicHelpPayload
};
