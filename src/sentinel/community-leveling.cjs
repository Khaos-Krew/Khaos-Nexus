'use strict';

const crypto = require('node:crypto');
const { ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { findInformationCategory, valuesOf } = require('./nexus-status.cjs');

const LEVEL_PANEL_MARKER = 'Nexus Sentinal • Managed Community Levels • v1';
const LEVEL_PANEL_TITLE = 'KHAOS NEXUS • COMMUNITY LEVELS';
const MILESTONE_ROLE_PREFIX = 'Community Level • ';
const RECENT_PANEL_LIMIT = 100;

function normalizeChannelName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isLevelUpChannel(channel) {
  if (!channel?.isTextBased?.() && channel?.type !== ChannelType.GuildText && channel?.type !== ChannelType.GuildAnnouncement) return false;
  return normalizeChannelName(channel.name) === 'levelup';
}

function findLevelUpChannel(channels, informationCategoryId = '') {
  const matches = valuesOf(channels).filter(isLevelUpChannel);
  if (!matches.length) return null;
  if (!informationCategoryId) return matches[0];
  return matches.find((channel) => String(channel.parentId || '') === String(informationCategoryId)) || matches[0];
}

async function ensureLevelUpChannel(guild) {
  const channels = await guild.channels.fetch();
  const information = findInformationCategory(channels);
  if (!information) return { channel: null, category: null, created: false, moved: false };
  let channel = findLevelUpChannel(channels, information.id);
  if (channel) {
    if (String(channel.parentId || '') !== String(information.id) && typeof channel.setParent === 'function') {
      await channel.setParent(information.id, { lockPermissions: false, reason: 'Keep Level Up under the INFORMATION category' });
      return { channel, category: information, created: false, moved: true };
    }
    return { channel, category: information, created: false, moved: false };
  }
  if (typeof guild.channels.create !== 'function') return { channel: null, category: information, created: false, moved: false };
  channel = await guild.channels.create({
    name: 'level-up',
    type: ChannelType.GuildText,
    parent: information.id,
    topic: 'Khaos Nexus community XP, level-up announcements, ranks, and leaderboard information.',
    reason: 'Nexus Sentinal managed community leveling channel'
  });
  return { channel, category: information, created: true, moved: false };
}

function progressBar(percent, width = 10) {
  const safe = Math.max(0, Math.min(100, Number(percent || 0)));
  const filled = Math.round((safe / 100) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}`;
}

function overviewPayload(settings = {}, options = {}) {
  const contentMode = options.messageContentEnabled === true ? 'enhanced text checks' : 'privacy-safe metadata mode';
  const source = settings.sources || {};
  const on = (value) => value === false ? 'Off' : 'On';
  const milestones = (settings.milestoneLevels || []).join(', ') || 'None';
  return {
    embeds: [{
      title: LEVEL_PANEL_TITLE,
      description: 'Community Levels reward participation across Khaos Nexus. **These levels never grant, replace, or modify Nexus Shop/supporter ranks, game access roles, staff roles, or Name Color roles.**',
      color: 0x5865f2,
      fields: [
        {
          name: 'Earn XP',
          value: [
            `💬 Messages: **${on(source.message)}** • ${settings.message?.xp || 15} XP • ${settings.message?.cooldownSeconds || 90}s cooldown • ${settings.message?.dailyCap || 300}/day cap`,
            `🎙️ Voice: **${on(source.voice)}** • ${settings.voice?.xp || 10} XP every ${Math.round((settings.voice?.intervalSeconds || 600) / 60)} min • ${settings.voice?.dailyCap || 300}/day cap`,
            `🎉 Events: **${on(source.event)}**`,
            `🎮 Module participation: **${on(source.module)}**`,
            `Global multiplier: **${Number(settings.globalMultiplier ?? 1).toFixed(2)}×**`
          ].join('\n'),
          inline: false
        },
        {
          name: 'Anti-farming',
          value: `Message cooldowns, per-source daily caps, bot exclusion, ignored-channel/role controls, AFK/deaf voice exclusion, and duplicate/tiny-message checks when Message Content is enabled. Current message mode: **${contentMode}**.`,
          inline: false
        },
        {
          name: 'Commands',
          value: '`/level` • `/rank` • `/leaderboard`\nStaff/admin controls: `/xp`',
          inline: false
        },
        {
          name: 'Milestone roles',
          value: `Community-only badges at levels: **${milestones}**. These roles are named \`${MILESTONE_ROLE_PREFIX}<level>\` and are never mapped to Shop entitlements.`,
          inline: false
        }
      ],
      footer: { text: LEVEL_PANEL_MARKER }
    }],
    allowedMentions: { parse: [] }
  };
}

function messageMatchesLevelPanel(message, botId = '') {
  if (!message) return false;
  if (botId && String(message.author?.id || '') !== String(botId)) return false;
  const embed = message.embeds?.[0];
  return String(embed?.footer?.text || '') === LEVEL_PANEL_MARKER || String(embed?.title || '') === LEVEL_PANEL_TITLE;
}

function newestMessage(messages = []) {
  return [...messages].sort((a, b) => Number(b?.createdTimestamp || 0) - Number(a?.createdTimestamp || 0))[0] || null;
}

async function reconcileLevelPanel(channel, payload, options = {}) {
  const botId = String(options.botId || channel?.client?.user?.id || '');
  let recent = [];
  try { recent = valuesOf(await channel.messages.fetch({ limit: RECENT_PANEL_LIMIT })); } catch {}
  const candidates = recent.filter((message) => messageMatchesLevelPanel(message, botId));
  let message = newestMessage(candidates);
  let created = false;
  let duplicatesRemoved = 0;
  let pinned = false;
  if (message) await message.edit(payload);
  else if (typeof channel?.send === 'function') { message = await channel.send(payload); created = true; }
  if (!message) return { message: null, created: false, duplicatesRemoved: 0, pinned: false };
  if (message.pinned !== true && typeof message.pin === 'function') {
    try { await message.pin('Nexus Sentinal canonical community leveling panel'); pinned = true; } catch {}
  }
  for (const duplicate of candidates) {
    if (String(duplicate.id) === String(message.id)) continue;
    try { await duplicate.delete('Nexus Sentinal duplicate community leveling panel cleanup'); duplicatesRemoved += 1; } catch {}
  }
  return { message, created, duplicatesRemoved, pinned };
}

function userMention(userId) {
  return /^\d{15,24}$/.test(String(userId || '')) ? `<@${userId}>` : 'Member';
}

function profilePayload(profile = {}, user = null) {
  const mention = userMention(profile.userId || user?.id);
  const rank = profile.rank ? `#${profile.rank}` : 'Unranked';
  return {
    embeds: [{
      title: `${user?.globalName || user?.username || 'Community Member'} • Level ${profile.level || 1}`,
      description: `${mention}\n**${Number(profile.xp || 0).toLocaleString()} XP** • Rank **${rank}**`,
      fields: [{
        name: `Progress to Level ${(profile.level || 1) + 1}`,
        value: `${progressBar(profile.progressPercent)} **${profile.progressPercent || 0}%**\n${Number(profile.progressXp || 0).toLocaleString()} / ${Number(profile.progressNeeded || 0).toLocaleString()} XP`,
        inline: false
      }],
      footer: { text: 'Nexus Sentinal • Community Level' }
    }],
    allowedMentions: { parse: [] }
  };
}

function leaderboardPayload(entries = [], users = new Map()) {
  const lines = entries.slice(0, 10).map((profile, index) => {
    const user = users.get(String(profile.userId));
    const name = user?.globalName || user?.username || `Member ${String(profile.userId || '').slice(-4)}`;
    return `**${index + 1}. ${name}** — Level ${profile.level || 1} • ${Number(profile.xp || 0).toLocaleString()} XP`;
  });
  return {
    embeds: [{
      title: 'KHAOS NEXUS • COMMUNITY LEADERBOARD',
      description: lines.join('\n') || 'No community XP has been earned yet.',
      footer: { text: 'Nexus Sentinal • Community XP' }
    }],
    allowedMentions: { parse: [] }
  };
}

function levelUpPayload(userId, result = {}) {
  const level = Number(result.afterLevel || result.profile?.level || 1);
  const milestones = result.milestonesCrossed || [];
  return {
    content: userMention(userId),
    embeds: [{
      title: `⚡ LEVEL UP • LEVEL ${level}`,
      description: `${userMention(userId)} reached **Community Level ${level}**!${milestones.length ? `\nMilestone unlocked: **${milestones.map((item) => `Level ${item}`).join(', ')}**` : ''}`,
      footer: { text: 'Nexus Sentinal • Community Progression' },
      timestamp: new Date().toISOString()
    }],
    allowedMentions: { parse: [], users: [String(userId)] }
  };
}

function normalizeMessageContent(value) {
  return String(value || '').toLowerCase().replace(/https?:\/\/\S+/g, ' link ').replace(/<@!?\d+>/g, ' mention ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function messageFingerprint(value) {
  const normalized = normalizeMessageContent(value);
  return normalized ? crypto.createHash('sha256').update(normalized).digest('hex') : '';
}

function meaningfulMessage(message, settings = {}, options = {}) {
  if (!message || message.author?.bot || message.webhookId || !message.guildId) return { ok: false, reason: 'non-member-message' };
  const ignoredChannels = new Set((settings.ignoredChannelIds || []).map(String));
  if (ignoredChannels.has(String(message.channelId || ''))) return { ok: false, reason: 'ignored-channel' };
  const memberRoles = message.member?.roles?.cache;
  if (memberRoles && (settings.ignoredRoleIds || []).some((roleId) => memberRoles.has(String(roleId)))) return { ok: false, reason: 'ignored-role' };

  const hasContentIntent = options.messageContentEnabled === true;
  if (!hasContentIntent) return { ok: true, mode: 'metadata', fingerprint: '' };

  const normalized = normalizeMessageContent(message.content);
  const minLength = Math.max(1, Number(settings.message?.minLength || 12));
  const minWords = Math.max(1, Number(settings.message?.minWords || 3));
  if (normalized.length < minLength) return { ok: false, reason: 'too-short' };
  const words = normalized.split(/\s+/).filter((word) => word.length >= 2);
  if (words.length < minWords) return { ok: false, reason: 'too-few-words' };
  if (/^[!/\.]/.test(String(message.content || '').trim())) return { ok: false, reason: 'command-like' };
  return { ok: true, mode: 'content', fingerprint: messageFingerprint(message.content) };
}

function levelCommandDefinitions() {
  const level = new SlashCommandBuilder()
    .setName('level')
    .setDescription('Show community XP and level progress')
    .addUserOption((option) => option.setName('user').setDescription('Member to view'));
  const rank = new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Show a member’s community leaderboard rank')
    .addUserOption((option) => option.setName('user').setDescription('Member to view'));
  const leaderboard = new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the Khaos Nexus community XP leaderboard');
  const xp = new SlashCommandBuilder()
    .setName('xp')
    .setDescription('Administer Khaos Nexus community XP')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName('add').setDescription('Add XP to a member')
      .addUserOption((option) => option.setName('user').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('XP amount').setRequired(true).setMinValue(1).setMaxValue(100000))
      .addStringOption((option) => option.setName('reason').setDescription('Audit reason').setMaxLength(180)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove XP from a member')
      .addUserOption((option) => option.setName('user').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('XP amount').setRequired(true).setMinValue(1).setMaxValue(100000))
      .addStringOption((option) => option.setName('reason').setDescription('Audit reason').setMaxLength(180)))
    .addSubcommand((sub) => sub.setName('set').setDescription('Set a member’s total XP')
      .addUserOption((option) => option.setName('user').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Total XP').setRequired(true).setMinValue(0).setMaxValue(1000000000))
      .addStringOption((option) => option.setName('reason').setDescription('Audit reason').setMaxLength(180)))
    .addSubcommand((sub) => sub.setName('reset').setDescription('Reset a member’s community XP')
      .addUserOption((option) => option.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Audit reason').setMaxLength(180)))
    .addSubcommand((sub) => sub.setName('multiplier').setDescription('Set the global automatic XP multiplier')
      .addNumberOption((option) => option.setName('value').setDescription('0.0 to 5.0').setRequired(true).setMinValue(0).setMaxValue(5)))
    .addSubcommand((sub) => sub.setName('source').setDescription('Enable or disable an automatic XP source')
      .addStringOption((option) => option.setName('source').setDescription('XP source').setRequired(true).addChoices(
        { name: 'Messages', value: 'message' }, { name: 'Voice', value: 'voice' }, { name: 'Events', value: 'event' }, { name: 'Module participation', value: 'module' }
      ))
      .addBooleanOption((option) => option.setName('enabled').setDescription('Whether this source awards XP').setRequired(true)))
    .addSubcommand((sub) => sub.setName('ignore-channel').setDescription('Add or remove a channel from XP exclusions')
      .addStringOption((option) => option.setName('action').setDescription('Add or remove').setRequired(true).addChoices({ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }))
      .addChannelOption((option) => option.setName('channel').setDescription('Channel').setRequired(true)))
    .addSubcommand((sub) => sub.setName('ignore-role').setDescription('Add or remove a role from XP exclusions')
      .addStringOption((option) => option.setName('action').setDescription('Add or remove').setRequired(true).addChoices({ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }))
      .addRoleOption((option) => option.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand((sub) => sub.setName('status').setDescription('Show community XP configuration'));
  return [level, rank, leaderboard, xp];
}

function milestoneRoleName(level) {
  return `${MILESTONE_ROLE_PREFIX}${Number(level)}`;
}

async function syncMilestoneRoles(member, currentLevel, milestoneLevels = []) {
  if (!member?.guild || member.user?.bot) return { added: [], removed: [], warnings: [] };
  const roles = await member.guild.roles.fetch();
  const desiredLevels = new Set((milestoneLevels || []).map(Number).filter((level) => Number.isInteger(level) && level <= Number(currentLevel || 1)));
  const allLevels = [...new Set((milestoneLevels || []).map(Number).filter(Number.isInteger))];
  const added = [];
  const removed = [];
  const warnings = [];

  for (const level of allLevels) {
    const name = milestoneRoleName(level);
    let role = roles.find((item) => item.name === name) || null;
    if (desiredLevels.has(level) && !role) {
      try {
        role = await member.guild.roles.create({ name, hoist: false, mentionable: false, reason: 'Nexus Sentinal community-level milestone role' });
      } catch (error) {
        warnings.push(`${name}: ${String(error?.message || error).slice(0, 120)}`);
        continue;
      }
    }
    if (!role) continue;
    const has = member.roles?.cache?.has?.(String(role.id));
    if (desiredLevels.has(level) && !has) {
      try { await member.roles.add(role, 'Nexus Sentinal community level milestone'); added.push(name); }
      catch (error) { warnings.push(`${name}: ${String(error?.message || error).slice(0, 120)}`); }
    }
    if (!desiredLevels.has(level) && has) {
      try { await member.roles.remove(role, 'Nexus Sentinal community level milestone sync'); removed.push(name); }
      catch (error) { warnings.push(`${name}: ${String(error?.message || error).slice(0, 120)}`); }
    }
  }
  return { added, removed, warnings };
}

module.exports = {
  LEVEL_PANEL_MARKER,
  LEVEL_PANEL_TITLE,
  MILESTONE_ROLE_PREFIX,
  normalizeChannelName,
  isLevelUpChannel,
  findLevelUpChannel,
  ensureLevelUpChannel,
  progressBar,
  overviewPayload,
  messageMatchesLevelPanel,
  newestMessage,
  reconcileLevelPanel,
  userMention,
  profilePayload,
  leaderboardPayload,
  levelUpPayload,
  normalizeMessageContent,
  messageFingerprint,
  meaningfulMessage,
  levelCommandDefinitions,
  milestoneRoleName,
  syncMilestoneRoles
};
