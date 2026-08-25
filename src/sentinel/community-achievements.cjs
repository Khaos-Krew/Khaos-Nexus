'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } = require('discord.js');
const { progressBar, userMention } = require('./community-leveling.cjs');
const { paragraphs, lines, spacedItems, statRows } = require('./embed-layout.cjs');

const NEXUS_CARD_COLOR = 0xb00020;
const ACHIEVEMENT_BUTTON_PREFIX = 'nexus-ach';
const ACHIEVEMENT_MODES = new Set(['summary', 'unlocked', 'progress', 'all']);

function displayName(user = null) {
  return user?.globalName || user?.displayName || user?.username || 'Community Member';
}

function avatarUrl(user = null) {
  try { return user?.displayAvatarURL?.({ size: 256 }) || null; } catch { return null; }
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function achievementCommandDefinition() {
  return new SlashCommandBuilder()
    .setName('achievements')
    .setDescription('Show Khaos Nexus community achievements and badge progress')
    .addUserOption((option) => option.setName('user').setDescription('Member to view'));
}

function progressCardPayload(profile = {}, user = null, achievementData = null) {
  const name = displayName(user);
  const icon = avatarUrl(user);
  const rank = profile.rank ? `#${profile.rank}` : 'Unranked';
  const source = profile.sourceTotals || {};
  const recent = achievementData?.recentAchievements || [];
  const achievementText = achievementData
    ? lines(`**${achievementData.achievementCount || 0}/${achievementData.achievementTotal || 0}** unlocked`, `**${formatNumber(achievementData.achievementPoints)}** achievement points`)
    : 'Achievement data unavailable';
  const recentText = recent.length
    ? spacedItems(recent.slice(0, 3).map((item) => `${item.icon || '🏆'} **${item.name}**\n${item.rarity}`))
    : 'No achievements unlocked yet.';

  const embed = {
    title: 'KHAOS NEXUS • PROGRESS CARD',
    color: NEXUS_CARD_COLOR,
    description: paragraphs(
      userMention(profile.userId || user?.id),
      'Community progression is separate from Nexus Shop/supporter ranks and staff/access authority.'
    ),
    fields: [
      { name: '⚡ Level', value: `**${profile.level || 1}**`, inline: true },
      { name: '🏁 Leaderboard', value: `**${rank}**`, inline: true },
      { name: '🏆 Achievements', value: achievementText, inline: true },
      {
        name: `📈 Progress to Level ${(profile.level || 1) + 1}`,
        value: paragraphs(
          `${progressBar(profile.progressPercent, 12)}  **${profile.progressPercent || 0}%**`,
          lines(
            `**Current:** ${formatNumber(profile.progressXp)} / ${formatNumber(profile.progressNeeded)} XP`,
            `**Total:** ${formatNumber(profile.xp)} XP`
          )
        ),
        inline: false
      },
      {
        name: '🌐 Nexus Activity',
        value: lines(
          `💬 **Messages** — ${formatNumber(source.message)} XP`,
          `🎙️ **Voice** — ${formatNumber(source.voice)} XP`,
          `🎉 **Events** — ${formatNumber(source.event)} XP`,
          `🎮 **Game Modules** — ${formatNumber(source.module)} XP`
        ),
        inline: false
      },
      { name: '🏅 Recent Achievements', value: recentText, inline: false }
    ],
    footer: { text: 'Nexus Sentinal • Community Progression' },
    timestamp: new Date().toISOString()
  };
  if (icon) {
    embed.author = { name, icon_url: icon };
    embed.thumbnail = { url: icon };
  } else embed.author = { name };
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

function buttonId(viewerId, targetId, mode) {
  return `${ACHIEVEMENT_BUTTON_PREFIX}:${String(viewerId || '')}:${String(targetId || '')}:${mode}`;
}

function parseAchievementButtonId(customId = '') {
  const parts = String(customId).split(':');
  if (parts.length !== 4 || parts[0] !== ACHIEVEMENT_BUTTON_PREFIX || !ACHIEVEMENT_MODES.has(parts[3])) return null;
  if (!/^\d{15,24}$/.test(parts[1]) || !/^\d{15,24}$/.test(parts[2])) return null;
  return { viewerId: parts[1], targetId: parts[2], mode: parts[3] };
}

function achievementViewRow(viewerId, targetId, active = 'summary') {
  const buttons = [
    ['summary', 'Overview', '🏆'],
    ['unlocked', 'Unlocked', '✅'],
    ['progress', 'In Progress', '📈'],
    ['all', 'All Badges', '🎖️']
  ].map(([mode, label, emoji]) => new ButtonBuilder()
    .setCustomId(buttonId(viewerId, targetId, mode))
    .setLabel(label)
    .setEmoji(emoji)
    .setStyle(mode === active ? ButtonStyle.Primary : ButtonStyle.Secondary));
  return new ActionRowBuilder().addComponents(...buttons);
}

function achievementLine(item, options = {}) {
  const progress = item.progress || {};
  const prefix = item.unlocked ? '✅' : '🔒';
  const progressText = item.unlocked
    ? `${item.rarity} • ${formatNumber(item.points)} pts`
    : `${formatNumber(progress.current)} / ${formatNumber(progress.target)} • ${progress.percent || 0}%`;
  const title = `${prefix} ${item.icon || '🏆'} **${item.name}**`;
  const detail = options.description
    ? lines(progressText, `↳ ${item.description}`)
    : progressText;
  return `${title}\n${detail}`;
}

function groupedAchievementFields(items = []) {
  const categories = new Map();
  for (const item of items) {
    const key = item.category || 'Other';
    if (!categories.has(key)) categories.set(key, []);
    categories.get(key).push(item);
  }
  return [...categories.entries()].slice(0, 25).map(([category, entries]) => ({
    name: category,
    value: spacedItems(entries.map((item) => achievementLine(item))).slice(0, 1024) || 'None',
    inline: false
  }));
}

function achievementCollectionPayload(data = {}, user = null, mode = 'summary', options = {}) {
  const achievements = Array.isArray(data.achievements) ? data.achievements : [];
  const unlocked = achievements.filter((item) => item.unlocked)
    .sort((a, b) => String(b.unlockedAt || '').localeCompare(String(a.unlockedAt || '')));
  const incomplete = achievements.filter((item) => !item.unlocked)
    .sort((a, b) => Number(b.progress?.percent || 0) - Number(a.progress?.percent || 0) || String(a.name).localeCompare(String(b.name)));
  const selectedMode = ACHIEVEMENT_MODES.has(mode) ? mode : 'summary';
  const name = displayName(user);
  const icon = avatarUrl(user);
  const embed = {
    title: 'KHAOS NEXUS • ACHIEVEMENTS',
    color: NEXUS_CARD_COLOR,
    description: paragraphs(
      userMention(data.userId || user?.id),
      statRows([
        ['Unlocked', `${data.achievementCount || 0} / ${data.achievementTotal || achievements.length}`],
        ['Achievement Points', formatNumber(data.achievementPoints)]
      ])
    ),
    fields: [],
    footer: { text: `Nexus Sentinal • Achievement Card • ${selectedMode}` },
    timestamp: new Date().toISOString()
  };
  if (icon) {
    embed.author = { name, icon_url: icon };
    embed.thumbnail = { url: icon };
  } else embed.author = { name };

  if (selectedMode === 'summary') {
    embed.fields.push({
      name: '🏆 Recent Unlocks',
      value: unlocked.length ? spacedItems(unlocked.slice(0, 5).map((item) => achievementLine(item))).slice(0, 1024) : 'No achievements unlocked yet.',
      inline: false
    });
    embed.fields.push({
      name: '📈 Closest Achievements',
      value: incomplete.length ? spacedItems(incomplete.slice(0, 5).map((item) => achievementLine(item))).slice(0, 1024) : 'Every current achievement is unlocked. Incredible. 👑',
      inline: false
    });
  } else if (selectedMode === 'unlocked') {
    embed.fields.push({
      name: `✅ Unlocked (${unlocked.length})`,
      value: unlocked.length ? spacedItems(unlocked.slice(0, 12).map((item) => achievementLine(item, { description: true }))).slice(0, 1024) : 'No achievements unlocked yet.',
      inline: false
    });
  } else if (selectedMode === 'progress') {
    embed.fields.push({
      name: `📈 In Progress (${incomplete.length})`,
      value: incomplete.length ? spacedItems(incomplete.slice(0, 12).map((item) => achievementLine(item, { description: true }))).slice(0, 1024) : 'All current achievements are complete.',
      inline: false
    });
  } else {
    embed.fields.push(...groupedAchievementFields(achievements));
  }

  const viewerId = String(options.viewerId || user?.id || data.userId || '');
  const targetId = String(data.userId || user?.id || '');
  const components = /^\d{15,24}$/.test(viewerId) && /^\d{15,24}$/.test(targetId)
    ? [achievementViewRow(viewerId, targetId, selectedMode)]
    : [];
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

function achievementUnlockPayload(userId, data = {}) {
  const unlocked = Array.isArray(data.newlyUnlocked) ? data.newlyUnlocked : [];
  if (!unlocked.length) return null;
  const shown = unlocked.slice(0, 8);
  return {
    content: userMention(userId),
    embeds: [{
      title: unlocked.length === 1 ? '🏆 ACHIEVEMENT UNLOCKED' : `🏆 ACHIEVEMENT CHAIN • ${unlocked.length} UNLOCKED`,
      color: NEXUS_CARD_COLOR,
      description: paragraphs(
        `${userMention(userId)} added ${unlocked.length === 1 ? 'a new badge' : 'new badges'} to their Nexus progression card.`,
        `**Collection:** ${data.achievementCount || 0}/${data.achievementTotal || 0} • **${formatNumber(data.achievementPoints)} pts**`
      ),
      fields: shown.map((item) => ({
        name: `${item.icon || '🏆'} ${item.name} • ${item.rarity}`,
        value: paragraphs(item.description, `**+${formatNumber(item.points)} achievement points**`),
        inline: false
      })).concat(unlocked.length > shown.length ? [{ name: 'More unlocked', value: `+${unlocked.length - shown.length} additional achievements were added to the collection.`, inline: false }] : []),
      footer: { text: `${data.achievementCount || 0}/${data.achievementTotal || 0} achievements • ${formatNumber(data.achievementPoints)} points • Nexus Sentinal` },
      timestamp: new Date().toISOString()
    }],
    allowedMentions: { parse: [], users: [String(userId)] }
  };
}

module.exports = {
  NEXUS_CARD_COLOR,
  ACHIEVEMENT_BUTTON_PREFIX,
  ACHIEVEMENT_MODES,
  displayName,
  avatarUrl,
  formatNumber,
  achievementCommandDefinition,
  progressCardPayload,
  buttonId,
  parseAchievementButtonId,
  achievementViewRow,
  achievementLine,
  groupedAchievementFields,
  achievementCollectionPayload,
  achievementUnlockPayload
};
