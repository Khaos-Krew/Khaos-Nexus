'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  StringSelectMenuBuilder
} = require('discord.js');
const { paragraphs, lines } = require('./embed-layout.cjs');
const { userMention } = require('./community-leveling.cjs');
const {
  WALLET_TITLES,
  WALLET_THEMES,
  WALLET_ACHIEVEMENTS,
  DEFAULT_THEME
} = require('../backend/services/wallet-cosmetics-service.cjs');

const WALLET_BUTTON_PREFIX = 'nxwallet';
const WALLET_SLOTS = new Set(['title', 'theme']);

function walletCommandDefinition() {
  const command = new SlashCommandBuilder()
    .setName('wallet')
    .setDescription('Show your Nexus wallet, title, theme, and badges')
    .setDMPermission(false)
    .addSubcommand((sub) => sub
      .setName('show')
      .setDescription('Show your Nexus wallet'))
    .addSubcommand((sub) => sub
      .setName('cosmetics')
      .setDescription('Equip an unlocked title or theme')
      .addStringOption((option) => option
        .setName('title')
        .setDescription('Title to equip')
        .setRequired(false)
        .addChoices(...WALLET_TITLES.map((item) => ({ name: item.label, value: item.id }))))
      .addStringOption((option) => option
        .setName('theme')
        .setDescription('Theme to equip')
        .setRequired(false)
        .addChoices(...WALLET_THEMES.map((item) => ({ name: item.label, value: item.id })))));
  return command;
}

function walletCustomId(action, slot, userId) {
  return `${WALLET_BUTTON_PREFIX}:${action}:${slot}:${String(userId || '')}`;
}

function parseWalletCustomId(customId = '') {
  const parts = String(customId).split(':');
  if (parts.length !== 4 || parts[0] !== WALLET_BUTTON_PREFIX) return null;
  if (!['open', 'equip'].includes(parts[1]) || !WALLET_SLOTS.has(parts[2])) return null;
  if (!/^\d{15,24}$/.test(parts[3])) return null;
  return { action: parts[1], slot: parts[2], userId: parts[3] };
}

function wholeAmount(value) {
  const amount = Number(value || 0);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : 0;
}

function balanceFieldValue(balances, unavailable = false) {
  if (unavailable || !balances) return 'Balances are unavailable right now. No wallet changes were made.';
  const coins = wholeAmount(balances.NEXUS_COINS);
  const points = wholeAmount(balances.NEXUS_POINTS);
  const tokens = wholeAmount(balances.DINO_CACHE_TOKENS);
  return lines(
    `**Nexus Coins:** ${coins.toLocaleString('en-US')}`,
    `**Nexus Points:** ${points.toLocaleString('en-US')}`,
    `**Dino Cache Tokens:** ${tokens.toLocaleString('en-US')}`
  );
}

function badgeRow(achievements = WALLET_ACHIEVEMENTS.map((item) => ({ ...item, unlocked: false }))) {
  return achievements.map((item) => `${item.unlocked ? (item.icon || '🏅') : '🔒'} ${item.label}`).join('  •  ');
}

function walletActionRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(walletCustomId('open', 'title', userId))
      .setLabel('Equip title')
      .setEmoji('🎖️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(walletCustomId('open', 'theme', userId))
      .setLabel('Equip theme')
      .setEmoji('🎨')
      .setStyle(ButtonStyle.Secondary)
  );
}

function unlockedChoices(profile = {}, slot = 'title') {
  const items = slot === 'theme' ? profile.themes : profile.titles;
  return (Array.isArray(items) ? items : []).filter((item) => item?.unlocked && item.id && item.label);
}

function walletEquipRow(slot, profile = {}, userId = '') {
  const choices = unlockedChoices(profile, slot);
  if (!choices.length || !/^\d{15,24}$/.test(String(userId || ''))) return null;
  const equipped = slot === 'theme' ? profile.equippedThemeId : profile.equippedTitleId;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(walletCustomId('equip', slot, userId))
    .setPlaceholder(slot === 'theme' ? 'Equip an unlocked theme' : 'Equip an unlocked title')
    .setMinValues(1)
    .setMaxValues(1);
  for (const item of choices.slice(0, 25)) {
    const option = {
      label: String(item.label).slice(0, 100),
      value: String(item.id).slice(0, 100),
      description: item.minLevel ? `Unlocked at level ${item.minLevel}` : 'Unlocked'
    };
    if (String(item.id) === String(equipped || '')) option.default = true;
    menu.addOptions(option);
  }
  return new ActionRowBuilder().addComponents(menu);
}

function walletEmbedPayload(profile = {}, options = {}) {
  const userId = String(options.userId || profile.discordUserId || '');
  const title = profile.equippedTitle?.label || 'Not equipped';
  const theme = profile.equippedTheme?.label || 'Not equipped';
  const color = Number.isInteger(profile.color) ? profile.color : DEFAULT_THEME.color;
  const mention = /^\d{15,24}$/.test(userId) ? userMention(userId) : 'Member';
  const payload = {
    embeds: [{
      title: 'KHAOS NEXUS • WALLET',
      color,
      description: paragraphs(
        mention,
        `**${title}**`,
        'Wallet titles, themes, and badges are community cosmetics. They never grant Shop ranks, staff roles, or Name Color roles.'
      ),
      fields: [
        { name: '🎖️ Title', value: title, inline: true },
        { name: '🎨 Theme', value: `${theme}${profile.equippedTheme?.accent ? `\n${profile.equippedTheme.accent}` : ''}`, inline: true },
        { name: '💰 Balances', value: balanceFieldValue(options.balances, options.balancesUnavailable === true), inline: false },
        { name: '🏅 Achievements', value: badgeRow(profile.achievements).slice(0, 1024) || 'No wallet badges yet.', inline: false }
      ],
      footer: { text: `Nexus Sentinal • Wallet • ${profile.equippedTheme?.label || DEFAULT_THEME.label}` },
      timestamp: new Date().toISOString()
    }],
    allowedMentions: { parse: [] }
  };
  if (options.components) payload.components = options.components;
  else if (/^\d{15,24}$/.test(userId) && options.buttons !== false) payload.components = [walletActionRow(userId)];
  return payload;
}

function equipRefusal(reason = '') {
  if (reason === 'locked') return 'That cosmetic is still locked. Reach the required community level, then try again. Nothing was equipped.';
  if (reason === 'unknown') return 'That cosmetic is not in the wallet catalog. Nothing was equipped.';
  if (reason === 'nothing-selected') return 'Choose an unlocked title or theme to equip.';
  return 'That cosmetic could not be equipped. Nothing was changed.';
}

module.exports = {
  WALLET_BUTTON_PREFIX,
  WALLET_TITLES,
  WALLET_THEMES,
  WALLET_ACHIEVEMENTS,
  walletCommandDefinition,
  walletCustomId,
  parseWalletCustomId,
  wholeAmount,
  balanceFieldValue,
  badgeRow,
  walletActionRow,
  unlockedChoices,
  walletEquipRow,
  walletEmbedPayload,
  equipRefusal
};
