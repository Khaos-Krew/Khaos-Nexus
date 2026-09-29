'use strict';

const { escapeMarkdown } = require('discord.js');
const { DEFAULT_COLOR } = require('./card-config.cjs');
const { catalog, gameById, platformCatalog, platformById } = require('./tag-validate.cjs');

const FOOTER = 'Khaos Nexus • Many Worlds — One Nexus • Tags are self-reported.';
const TAG_DISPLAY_CAP = 12;

function escapeUserText(value) {
  return escapeMarkdown(String(value ?? ''), {
    codeBlock: true,
    inlineCode: true,
    bold: true,
    italic: true,
    underline: true,
    strikethrough: true,
    spoiler: true,
    heading: true,
    bulletedList: true,
    numberedList: true,
    maskedLink: true
  });
}

function formatCount(value) {
  if (typeof value === 'bigint') {
    const digits = (value < 0n ? -value : value).toString();
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) return formatCount(BigInt(value));
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value.toLocaleString('en-US');
  return String(value ?? '0');
}

function xpBar(percent) {
  const safe = Math.max(0, Math.min(100, Number(percent) || 0));
  const filled = Math.round((safe / 100) * 10);
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
}

function displayName(user) {
  return user?.globalName || user?.username || 'Player';
}

function safeAvatar(user) {
  try {
    const url = user?.displayAvatarURL?.({ size: 128, extension: 'png' });
    return typeof url === 'string' && url.startsWith('https://') ? url : undefined;
  } catch {
    return undefined;
  }
}

function levelField(level) {
  if (!level || level.unavailable) return 'unavailable';
  return [
    `**Level ${formatCount(level.level)}**`,
    xpBar(level.progressPercent),
    `${formatCount(level.xp)} / ${formatCount(level.nextLevelXp)} XP`
  ].join('\n');
}

function tagLine(gameId, record, games) {
  const entry = gameById(gameId, games);
  const label = gameId === 'other' ? (record.game || 'Other') : (entry?.label || gameId);
  return `${escapeUserText(label)}: ${escapeUserText(record.tag || '')} (unverified)`;
}

function tagsField(tags, games) {
  if (!tags || tags.unavailable) return 'unavailable';
  const lines = Object.entries(tags)
    .slice(0, TAG_DISPLAY_CAP)
    .map(([gameId, record]) => tagLine(gameId, record, games));
  return lines.length ? lines.join('\n') : 'None';
}

function platformLine(platformId, record, platforms) {
  const label = platformById(platformId, platforms)?.label || platformId;
  return `${escapeUserText(label)}: ${escapeUserText(record.tag || '')} (unverified)`;
}

function platformsField(platforms, catalogEntries) {
  if (platforms?.unavailable) return 'unavailable';
  const source = platforms && typeof platforms === 'object' ? platforms : {};
  const ordered = catalogEntries.map((entry) => entry.id).filter((id) => source[id]);
  const extras = Object.keys(source).filter((id) => !ordered.includes(id));
  const lines = [...ordered, ...extras].map((id) => platformLine(id, source[id], catalogEntries));
  return lines.length ? lines.join('\n') : 'None';
}

function themeField(cosmetics) {
  if (!cosmetics || cosmetics.unavailable) return 'unavailable';
  if (!cosmetics.themeLabel) return 'Default';
  return escapeUserText(cosmetics.themeLabel);
}

function balancesField(balances) {
  if (!balances || balances.unavailable) return 'unavailable';
  return [
    `Coins: ${formatCount(balances.coins)}`,
    `Nexus Points: ${formatCount(balances.points)}`,
    `Cache tokens: ${formatCount(balances.cacheTokens)}`
  ].join('\n');
}

function showBalances(model) {
  return model?.allowBalances === true
    && model?.hidden !== true
    && String(model.viewerId || '') === String(model.targetUserId || '')
    && model.balances != null;
}

function renderCardEmbed(model, user, games = catalog(), platforms = platformCatalog()) {
  if (!model || model.hidden) return null;
  const cosmetics = model.cosmetics || {};
  const color = !cosmetics.unavailable && Number.isInteger(cosmetics.color) ? cosmetics.color : DEFAULT_COLOR;
  const title = !cosmetics.unavailable && cosmetics.title ? escapeUserText(cosmetics.title).slice(0, 256) : undefined;
  const fields = [
    { name: 'Level', value: levelField(model.level).slice(0, 1024), inline: false },
    { name: 'Rank', value: (model.rank?.unavailable ? 'unavailable' : escapeUserText(model.rank?.name || 'unavailable')).slice(0, 1024), inline: true },
    { name: 'Theme', value: themeField(cosmetics).slice(0, 1024), inline: true },
    { name: 'Games', value: tagsField(model.tags, games).slice(0, 1024), inline: false },
    { name: 'Platforms', value: platformsField(model.platforms, platforms).slice(0, 1024), inline: false }
  ];
  if (showBalances(model)) {
    fields.push({ name: 'Balances', value: balancesField(model.balances).slice(0, 1024), inline: false });
  }
  const author = { name: escapeUserText(displayName(user)).slice(0, 256) };
  const avatar = safeAvatar(user);
  if (avatar) author.icon_url = avatar;
  return {
    author,
    title,
    color,
    fields,
    footer: { text: FOOTER }
  };
}

module.exports = {
  FOOTER,
  DEFAULT_COLOR,
  escapeUserText,
  formatCount,
  xpBar,
  renderCardEmbed,
  showBalances
};
