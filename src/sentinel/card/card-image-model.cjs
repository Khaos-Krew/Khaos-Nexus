'use strict';

const { formatCount, showBalances } = require('./card-embed.cjs');
const { catalog, gameById, platformById, platformCatalog } = require('./tag-validate.cjs');

const LAYOUT_VERSION = 1;
const PLATFORM_CAP = 9;
const GAME_CAP = 8;

const PLATFORM_CODES = Object.freeze({
  steam: 'STM',
  xbox: 'XBX',
  psn: 'PSN',
  nintendo: 'NSW',
  epic: 'EPC',
  battlenet: 'BNT',
  ea: 'EA',
  ubisoft: 'UBI',
  riot: 'RIOT'
});

const PLATFORM_LABELS = Object.freeze({
  steam: 'Steam',
  xbox: 'Xbox',
  psn: 'PlayStation',
  nintendo: 'Nintendo',
  epic: 'Epic',
  battlenet: 'Battle.net',
  ea: 'EA',
  ubisoft: 'Ubisoft',
  riot: 'Riot'
});

const GAME_CODES = Object.freeze({
  ark_asa: 'ARK',
  ark_ase: 'ASE',
  warframe: 'WF',
  minecraft_java: 'MC',
  minecraft_bedrock: 'MCB',
  diablo4: 'D4',
  destiny2: 'D2',
  steam: 'STM',
  xbox: 'XBX',
  psn: 'PSN',
  battlenet: 'BNT',
  epic: 'EPC',
  nintendo: 'NSW',
  other: 'OTH'
});

const GAME_LABELS = Object.freeze({
  ark_asa: 'ARK: Ascended',
  ark_ase: 'ARK: Evolved',
  warframe: 'Warframe',
  minecraft_java: 'Minecraft',
  minecraft_bedrock: 'Minecraft',
  diablo4: 'Diablo IV',
  destiny2: 'Destiny 2'
});

function clip(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function codeFrom(text, fallback) {
  const letters = String(text || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return (letters || fallback || 'TAG').slice(0, 4);
}

function capRows(rows, cap) {
  if (rows.length <= cap) return { rows, more: 0 };
  const shown = Math.max(0, cap - 1);
  return { rows: rows.slice(0, shown), more: rows.length - shown };
}

function orderedIds(source, catalogEntries) {
  if (!source || source.unavailable === true || typeof source !== 'object') {
    return { unavailable: source?.unavailable === true, ids: [] };
  }
  const known = catalogEntries.map((entry) => entry.id).filter((id) => source[id] && typeof source[id] === 'object');
  const extras = Object.keys(source).filter((id) => (
    id !== 'unavailable'
    && id !== 'reason'
    && !known.includes(id)
    && source[id]
    && typeof source[id] === 'object'
  ));
  return { unavailable: false, ids: [...known, ...extras] };
}

function balanceText(balances) {
  if (!balances || balances.unavailable === true) return null;
  const amounts = [balances.coins, balances.points, balances.cacheTokens];
  if (amounts.every((amount) => amount == null || amount === '')) return null;
  return {
    coins: clip(formatCount(balances.coins ?? 0), 16),
    points: clip(formatCount(balances.points ?? 0), 16),
    cacheTokens: clip(formatCount(balances.cacheTokens ?? 0), 16)
  };
}

function buildCardImageModel(model, user, options = {}) {
  if (!model || model.hidden === true) return null;
  const games = options.games || catalog();
  const platforms = options.platforms || platformCatalog();
  const platformOrder = orderedIds(model.platforms, platforms);
  const gameOrder = orderedIds(model.tags, games);
  const platformRows = platformOrder.ids.map((id) => ({
    code: PLATFORM_CODES[id] || codeFrom(id, 'PLT'),
    label: clip(PLATFORM_LABELS[id] || platformById(id, platforms)?.label || id, 24),
    tag: clip(model.platforms[id]?.tag || '', 48)
  }));
  const gameRows = gameOrder.ids.map((id) => {
    const record = model.tags[id] || {};
    const custom = id === 'other' ? clip(record.game || 'Other', 28) : null;
    return {
      code: custom ? codeFrom(custom, 'OTH') : (GAME_CODES[id] || codeFrom(id, 'GAME')),
      label: custom || clip(GAME_LABELS[id] || gameById(id, games)?.label || id, 28),
      tag: clip(record.tag || '', 48)
    };
  });
  const platformCapped = capRows(platformRows, PLATFORM_CAP);
  const gameCapped = capRows(gameRows, GAME_CAP);
  const cosmetics = model.cosmetics?.unavailable === true ? null : (model.cosmetics || null);
  const title = cosmetics?.title ? clip(cosmetics.title, 42) : null;
  const levelUnavailable = model.level?.unavailable === true || !model.level;
  const rankUnavailable = model.rank?.unavailable === true || !model.rank?.name;
  return {
    layoutVersion: LAYOUT_VERSION,
    name: clip(user?.globalName || user?.username || 'Player', 48),
    title,
    rank: rankUnavailable ? null : clip(model.rank.name, 32),
    rankUnavailable,
    level: levelUnavailable ? null : {
      level: clip(formatCount(model.level.level ?? 0), 8),
      xp: clip(formatCount(model.level.xp ?? 0), 16),
      next: clip(formatCount(model.level.nextLevelXp ?? 0), 16),
      percent: Math.max(0, Math.min(100, Number(model.level.progressPercent) || 0))
    },
    levelUnavailable,
    platforms: platformCapped.rows,
    platformMore: platformCapped.more,
    platformsUnavailable: platformOrder.unavailable,
    games: gameCapped.rows,
    gameMore: gameCapped.more,
    gamesUnavailable: gameOrder.unavailable,
    balances: options.includeBalances === true && showBalances(model) ? balanceText(model.balances) : null
  };
}

module.exports = {
  LAYOUT_VERSION,
  PLATFORM_CAP,
  GAME_CAP,
  buildCardImageModel
};
