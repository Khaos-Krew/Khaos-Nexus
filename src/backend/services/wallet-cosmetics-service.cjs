'use strict';

const path = require('node:path');
const { JsonStore, clone } = require('../core/json-store.cjs');
const { safeId } = require('./community-level-service.cjs');

// Wallet cosmetics are keyed by Discord user id. That is the same external id
// stored on nexus_economic_identity_links (provider = 'discord') and the same
// id community XP already uses. This store does not create another identity.

const SCHEMA_VERSION = 1;
const COMMUNITY_LEVEL_UP_SOURCE = 'community-level-up';

const WALLET_TITLES = Object.freeze([
  Object.freeze({ id: 'title_recruit', label: 'Recruit', minLevel: 1 }),
  Object.freeze({ id: 'title_scout', label: 'Scout', minLevel: 5 }),
  Object.freeze({ id: 'title_pathfinder', label: 'Pathfinder', minLevel: 10 }),
  Object.freeze({ id: 'title_veteran', label: 'Veteran', minLevel: 25 }),
  Object.freeze({ id: 'title_nexus_elder', label: 'Nexus Elder', minLevel: 50 })
]);

const WALLET_THEMES = Object.freeze([
  Object.freeze({ id: 'theme_default', label: 'Default', minLevel: 1, accent: '#5B6C7D' }),
  Object.freeze({ id: 'theme_ember', label: 'Ember', minLevel: 10, accent: '#C45C26' }),
  Object.freeze({ id: 'theme_void', label: 'Void', minLevel: 25, accent: '#6B5B95' })
]);

const WALLET_ACHIEVEMENTS = Object.freeze([
  Object.freeze({ id: 'ach_level_10', label: 'Level 10', icon: '🔟', rule: 'level', minLevel: 10 }),
  Object.freeze({ id: 'ach_level_25', label: 'Level 25', icon: '🎖️', rule: 'level', minLevel: 25 }),
  Object.freeze({ id: 'ach_first_levelup_coins', label: 'First Coin grant', icon: '🪙', rule: 'coins' }),
  Object.freeze({ id: 'ach_wallet_open', label: 'Wallet opened', icon: '👛', rule: 'wallet' })
]);

const TITLE_BY_ID = new Map(WALLET_TITLES.map((item) => [item.id, item]));
const THEME_BY_ID = new Map(WALLET_THEMES.map((item) => [item.id, decorateTheme(item)]));
const ACHIEVEMENT_BY_ID = new Map(WALLET_ACHIEVEMENTS.map((item) => [item.id, item]));
const DEFAULT_THEME = THEME_BY_ID.get('theme_default');

function hexToColor(accent) {
  const parsed = Number.parseInt(String(accent || '').replace(/^#/, ''), 16);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffffff) throw new Error(`Invalid theme accent: ${accent}`);
  return parsed;
}

function decorateTheme(theme) {
  return Object.freeze({ ...theme, color: hexToColor(theme.accent) });
}

function catalogItem(item, unlocked = null) {
  return {
    id: item.id,
    label: item.label,
    minLevel: Number.isInteger(item.minLevel) ? item.minLevel : null,
    accent: item.accent || null,
    color: Number.isInteger(item.color) ? item.color : null,
    icon: item.icon || null,
    rule: item.rule || null,
    unlocked: Boolean(unlocked),
    unlockedAt: unlocked?.unlockedAt || null,
    source: unlocked?.source || null
  };
}

function blankRecord(discordUserId) {
  return {
    discordUserId,
    equippedTitleId: '',
    equippedThemeId: '',
    titles: {},
    themes: {},
    achievements: {},
    updatedAt: null
  };
}

function normalizeUnlocked(input, allowed) {
  const unlocked = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return unlocked;
  for (const [id, value] of Object.entries(input)) {
    if (!allowed.has(id)) continue;
    const unlockedAt = String(value?.unlockedAt || '').trim();
    if (!unlockedAt) continue;
    const source = String(value?.source || '').trim();
    unlocked[id] = source ? { unlockedAt, source } : { unlockedAt };
  }
  return unlocked;
}

function normalizeRecord(discordUserId, input = {}) {
  const record = blankRecord(discordUserId);
  record.titles = normalizeUnlocked(input.titles, TITLE_BY_ID);
  record.themes = normalizeUnlocked(input.themes, THEME_BY_ID);
  record.achievements = normalizeUnlocked(input.achievements, ACHIEVEMENT_BY_ID);
  const titleId = String(input.equippedTitleId || '');
  const themeId = String(input.equippedThemeId || '');
  record.equippedTitleId = record.titles[titleId] ? titleId : '';
  record.equippedThemeId = record.themes[themeId] ? themeId : '';
  record.updatedAt = String(input.updatedAt || '') || null;
  return record;
}

function readLevel(input = {}) {
  if (!Object.prototype.hasOwnProperty.call(input, 'level') || input.level == null || input.level === '') return { present: false };
  const level = Number(input.level);
  if (!Number.isInteger(level) || level < 1 || level > 10000) return { present: true, invalid: true };
  return { present: true, level };
}

function publicProfile(discordUserId, record = blankRecord(discordUserId), extras = {}) {
  const titles = WALLET_TITLES.map((item) => catalogItem(item, record.titles[item.id]));
  const themes = WALLET_THEMES.map((item) => catalogItem(THEME_BY_ID.get(item.id), record.themes[item.id]));
  const achievements = WALLET_ACHIEVEMENTS.map((item) => catalogItem(item, record.achievements[item.id]));
  const equippedTitle = titles.find((item) => item.id === record.equippedTitleId && item.unlocked) || null;
  const equippedTheme = themes.find((item) => item.id === record.equippedThemeId && item.unlocked) || null;
  return {
    discordUserId,
    equippedTitleId: equippedTitle?.id || '',
    equippedThemeId: equippedTheme?.id || '',
    equippedTitle,
    equippedTheme,
    accent: equippedTheme?.accent || DEFAULT_THEME.accent,
    color: equippedTheme?.color ?? DEFAULT_THEME.color,
    titles,
    themes,
    achievements,
    level: Number.isInteger(extras.level) ? extras.level : null,
    updatedAt: record.updatedAt || null
  };
}

function stamp(now) {
  return new Date(now || Date.now()).toISOString();
}

class WalletCosmeticsService {
  constructor(options = {}) {
    const stateFile = options.stateFile || path.join(process.env.NEXUS_DATA_DIR || 'data', 'wallet-cosmetics.json');
    this.store = options.store || new JsonStore(stateFile, { version: SCHEMA_VERSION, users: {} });
    this.store.state.version = SCHEMA_VERSION;
    this.store.state.users ||= {};
  }

  catalog() {
    return {
      version: SCHEMA_VERSION,
      titles: clone(WALLET_TITLES),
      themes: WALLET_THEMES.map((item) => clone(THEME_BY_ID.get(item.id))),
      achievements: clone(WALLET_ACHIEVEMENTS)
    };
  }

  readRecord(discordUserId) {
    const id = safeId(discordUserId);
    if (!id) throw new Error('A valid Discord user ID is required.');
    return normalizeRecord(id, this.store.read().users?.[id]);
  }

  profile(discordUserId) {
    const id = safeId(discordUserId);
    if (!id) throw new Error('A valid Discord user ID is required.');
    return { ok: true, profile: publicProfile(id, this.readRecord(id)), newlyUnlocked: { titles: [], themes: [], achievements: [] } };
  }

  sync(discordUserId, input = {}) {
    const id = safeId(discordUserId);
    if (!id) throw new Error('A valid Discord user ID is required.');
    const levelInput = readLevel(input);
    if (levelInput.invalid) return { ok: false, reason: 'invalid-level', profile: publicProfile(id, this.readRecord(id)) };
    const coinsGranted = input.coinsGranted === true;
    const walletOpened = input.walletOpened === true;
    const unlockedAt = stamp(input.now);

    return this.store.update((state) => {
      state.version = SCHEMA_VERSION;
      state.users ||= {};
      const record = normalizeRecord(id, state.users[id]);
      const newlyUnlocked = { titles: [], themes: [], achievements: [] };

      if (levelInput.present) {
        for (const item of WALLET_TITLES) {
          if (levelInput.level < item.minLevel || record.titles[item.id]) continue;
          record.titles[item.id] = { unlockedAt, source: 'community-level' };
          newlyUnlocked.titles.push(item.id);
        }
        for (const item of WALLET_THEMES) {
          if (levelInput.level < item.minLevel || record.themes[item.id]) continue;
          record.themes[item.id] = { unlockedAt, source: 'community-level' };
          newlyUnlocked.themes.push(item.id);
        }
        for (const item of WALLET_ACHIEVEMENTS) {
          if (item.rule !== 'level' || levelInput.level < item.minLevel || record.achievements[item.id]) continue;
          record.achievements[item.id] = { unlockedAt, source: 'community-level' };
          newlyUnlocked.achievements.push(item.id);
        }
      }

      if (coinsGranted && !record.achievements.ach_first_levelup_coins) {
        record.achievements.ach_first_levelup_coins = { unlockedAt, source: COMMUNITY_LEVEL_UP_SOURCE };
        newlyUnlocked.achievements.push('ach_first_levelup_coins');
      }
      if (walletOpened && !record.achievements.ach_wallet_open) {
        record.achievements.ach_wallet_open = { unlockedAt, source: 'wallet-view' };
        newlyUnlocked.achievements.push('ach_wallet_open');
      }

      if (!record.equippedTitleId && record.titles.title_recruit) record.equippedTitleId = 'title_recruit';
      if (!record.equippedThemeId && record.themes.theme_default) record.equippedThemeId = 'theme_default';
      record.updatedAt = unlockedAt;
      state.users[id] = record;
      return {
        ok: true,
        profile: publicProfile(id, record, { level: levelInput.level }),
        newlyUnlocked
      };
    });
  }

  equip(discordUserId, input = {}) {
    const id = safeId(discordUserId);
    if (!id) throw new Error('A valid Discord user ID is required.');
    const titleId = input.titleId == null || input.titleId === '' ? '' : String(input.titleId);
    const themeId = input.themeId == null || input.themeId === '' ? '' : String(input.themeId);
    if (!titleId && !themeId) return { ok: false, reason: 'nothing-selected', profile: publicProfile(id, this.readRecord(id)) };

    const current = this.readRecord(id);
    const errors = [];
    if (titleId) {
      if (!TITLE_BY_ID.has(titleId)) errors.push({ slot: 'title', id: titleId, reason: 'unknown' });
      else if (!current.titles[titleId]) errors.push({ slot: 'title', id: titleId, reason: 'locked' });
    }
    if (themeId) {
      if (!THEME_BY_ID.has(themeId)) errors.push({ slot: 'theme', id: themeId, reason: 'unknown' });
      else if (!current.themes[themeId]) errors.push({ slot: 'theme', id: themeId, reason: 'locked' });
    }
    if (errors.length) {
      return { ok: false, reason: errors[0].reason, errors, profile: publicProfile(id, current) };
    }

    return this.store.update((state) => {
      state.users ||= {};
      const record = normalizeRecord(id, state.users[id]);
      if (titleId) record.equippedTitleId = titleId;
      if (themeId) record.equippedThemeId = themeId;
      record.updatedAt = stamp(input.now);
      state.users[id] = record;
      return { ok: true, profile: publicProfile(id, record) };
    });
  }
}

function cosmeticIds() {
  return [
    ...WALLET_TITLES.map((item) => item.id),
    ...WALLET_THEMES.map((item) => item.id),
    ...WALLET_ACHIEVEMENTS.map((item) => item.id)
  ];
}

module.exports = {
  SCHEMA_VERSION,
  COMMUNITY_LEVEL_UP_SOURCE,
  WALLET_TITLES,
  WALLET_THEMES,
  WALLET_ACHIEVEMENTS,
  DEFAULT_THEME,
  hexToColor,
  cosmeticIds,
  publicProfile,
  blankRecord,
  WalletCosmeticsService
};
