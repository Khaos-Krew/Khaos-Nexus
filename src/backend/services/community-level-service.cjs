'use strict';

const path = require('node:path');
const { JsonStore, clone } = require('../core/json-store.cjs');

const VALID_SOURCES = Object.freeze(['message', 'voice', 'event', 'module']);
const MILESTONE_LEVELS = Object.freeze([5, 10, 20, 30, 50, 75, 100]);
const MAX_AUDIT_ENTRIES = 500;
const MAX_LEADERBOARD_LIMIT = 50;

const DEFAULT_LEVEL_SETTINGS = Object.freeze({
  enabled: true,
  globalMultiplier: 1,
  sources: Object.freeze({ message: true, voice: true, event: true, module: true }),
  ignoredChannelIds: Object.freeze([]),
  ignoredRoleIds: Object.freeze([]),
  message: Object.freeze({ xp: 15, cooldownSeconds: 90, dailyCap: 300, minLength: 12, minWords: 3, duplicateWindowSeconds: 600 }),
  voice: Object.freeze({ xp: 10, intervalSeconds: 600, dailyCap: 300, minHumans: 2 }),
  event: Object.freeze({ dailyCap: 1000 }),
  module: Object.freeze({ dailyCap: 300 }),
  milestoneLevels: MILESTONE_LEVELS
});

function integer(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}

function number(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function safeId(value) {
  const text = String(value || '').trim();
  return /^\d{15,24}$/.test(text) ? text : '';
}

function safeText(value, max = 180) {
  return String(value ?? '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function utcDay(now = new Date()) {
  return new Date(now).toISOString().slice(0, 10);
}

function xpForLevel(level) {
  const normalized = Math.max(1, integer(level, 1, 1, 10000));
  return (normalized - 1) * (normalized - 1) * 100;
}

function levelForXp(xp) {
  const normalized = Math.max(0, integer(xp, 0));
  return Math.floor(Math.sqrt(normalized / 100)) + 1;
}

function progressForXp(xp) {
  const normalized = Math.max(0, integer(xp, 0));
  const level = levelForXp(normalized);
  const floorXp = xpForLevel(level);
  const nextXp = xpForLevel(level + 1);
  const earned = normalized - floorXp;
  const needed = Math.max(1, nextXp - floorXp);
  return {
    xp: normalized,
    level,
    levelStartXp: floorXp,
    nextLevelXp: nextXp,
    progressXp: earned,
    progressNeeded: needed,
    progressPercent: Math.max(0, Math.min(100, Math.floor((earned / needed) * 100)))
  };
}

function milestoneLevelsCrossed(beforeLevel, afterLevel, milestones = MILESTONE_LEVELS) {
  const before = integer(beforeLevel, 1, 1);
  const after = integer(afterLevel, before, 1);
  if (after <= before) return [];
  return [...milestones].map((level) => integer(level, 0, 1, 10000)).filter((level) => level > before && level <= after).sort((a, b) => a - b);
}

function normalizeSettings(input = {}, fallback = DEFAULT_LEVEL_SETTINGS) {
  const base = clone(fallback || DEFAULT_LEVEL_SETTINGS);
  const sources = input.sources && typeof input.sources === 'object' ? input.sources : {};
  const uniqueIds = (values) => [...new Set((Array.isArray(values) ? values : []).map(safeId).filter(Boolean))].slice(0, 250);
  const milestoneLevels = [...new Set((Array.isArray(input.milestoneLevels) ? input.milestoneLevels : base.milestoneLevels)
    .map((value) => integer(value, 0, 1, 10000)).filter(Boolean))].sort((a, b) => a - b).slice(0, 25);

  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : base.enabled !== false,
    globalMultiplier: number(input.globalMultiplier, base.globalMultiplier || 1, 0, 5),
    sources: Object.fromEntries(VALID_SOURCES.map((source) => [source, typeof sources[source] === 'boolean' ? sources[source] : base.sources?.[source] !== false])),
    ignoredChannelIds: uniqueIds(input.ignoredChannelIds ?? base.ignoredChannelIds),
    ignoredRoleIds: uniqueIds(input.ignoredRoleIds ?? base.ignoredRoleIds),
    message: {
      xp: integer(input.message?.xp, base.message?.xp || 15, 1, 100),
      cooldownSeconds: integer(input.message?.cooldownSeconds, base.message?.cooldownSeconds || 90, 10, 3600),
      dailyCap: integer(input.message?.dailyCap, base.message?.dailyCap || 300, 0, 100000),
      minLength: integer(input.message?.minLength, base.message?.minLength || 12, 1, 1000),
      minWords: integer(input.message?.minWords, base.message?.minWords || 3, 1, 100),
      duplicateWindowSeconds: integer(input.message?.duplicateWindowSeconds, base.message?.duplicateWindowSeconds || 600, 30, 86400)
    },
    voice: {
      xp: integer(input.voice?.xp, base.voice?.xp || 10, 1, 100),
      intervalSeconds: integer(input.voice?.intervalSeconds, base.voice?.intervalSeconds || 600, 60, 3600),
      dailyCap: integer(input.voice?.dailyCap, base.voice?.dailyCap || 300, 0, 100000),
      minHumans: integer(input.voice?.minHumans, base.voice?.minHumans || 2, 2, 25)
    },
    event: { dailyCap: integer(input.event?.dailyCap, base.event?.dailyCap || 1000, 0, 100000) },
    module: { dailyCap: integer(input.module?.dailyCap, base.module?.dailyCap || 300, 0, 100000) },
    milestoneLevels: milestoneLevels.length ? milestoneLevels : [...MILESTONE_LEVELS]
  };
}

function blankUser(userId = '') {
  return {
    userId: safeId(userId),
    xp: 0,
    sourceTotals: { message: 0, voice: 0, event: 0, module: 0, admin: 0 },
    daily: { day: '', message: 0, voice: 0, event: 0, module: 0 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function publicProfile(user = {}, rank = null) {
  const progress = progressForXp(user.xp || 0);
  return {
    userId: String(user.userId || ''),
    ...progress,
    rank: Number.isInteger(rank) ? rank : null,
    sourceTotals: { ...(user.sourceTotals || {}) },
    updatedAt: user.updatedAt || null
  };
}

class CommunityLevelService {
  constructor(options = {}) {
    const stateFile = options.stateFile || path.join(process.env.NEXUS_DATA_DIR || 'data', 'community-leveling.json');
    const configuredSettings = normalizeSettings(options.settings || {});
    this.store = options.store || new JsonStore(stateFile, {
      version: 1,
      settings: configuredSettings,
      users: {},
      audit: []
    });
    this.store.state.settings = normalizeSettings(this.store.state.settings || {}, configuredSettings);
    this.store.state.users ||= {};
    this.store.state.audit = Array.isArray(this.store.state.audit) ? this.store.state.audit.slice(-MAX_AUDIT_ENTRIES) : [];
  }

  settings() { return clone(this.store.read().settings); }

  ensureUser(state, userId) {
    const id = safeId(userId);
    if (!id) throw new Error('A valid Discord user ID is required.');
    state.users ||= {};
    state.users[id] ||= blankUser(id);
    const user = state.users[id];
    user.userId = id;
    user.sourceTotals ||= { message: 0, voice: 0, event: 0, module: 0, admin: 0 };
    user.daily ||= { day: '', message: 0, voice: 0, event: 0, module: 0 };
    return user;
  }

  refreshDaily(user, now = new Date()) {
    const day = utcDay(now);
    if (user.daily?.day !== day) user.daily = { day, message: 0, voice: 0, event: 0, module: 0 };
    return user.daily;
  }

  sourceCap(settings, source) {
    return integer(settings?.[source]?.dailyCap, 0, 0, 100000);
  }

  rankedUsers(state = this.store.read()) {
    return Object.values(state.users || {})
      .map((user) => ({ ...user, xp: integer(user.xp, 0) }))
      .sort((a, b) => b.xp - a.xp || String(a.userId).localeCompare(String(b.userId)));
  }

  profile(userId) {
    const id = safeId(userId);
    if (!id) throw new Error('A valid Discord user ID is required.');
    const state = this.store.read();
    const user = state.users?.[id] || blankUser(id);
    const ranked = this.rankedUsers(state);
    const index = ranked.findIndex((entry) => entry.userId === id);
    return publicProfile(user, index >= 0 ? index + 1 : null);
  }

  leaderboard(limit = 10) {
    const max = integer(limit, 10, 1, MAX_LEADERBOARD_LIMIT);
    return this.rankedUsers().slice(0, max).map((user, index) => publicProfile(user, index + 1));
  }

  addAudit(state, entry = {}) {
    state.audit ||= [];
    state.audit.push({
      at: new Date().toISOString(),
      action: safeText(entry.action, 60),
      actorId: safeId(entry.actorId) || '',
      userId: safeId(entry.userId) || '',
      source: safeText(entry.source, 30),
      amount: Number.isFinite(Number(entry.amount)) ? Math.round(Number(entry.amount)) : null,
      reason: safeText(entry.reason, 180)
    });
    if (state.audit.length > MAX_AUDIT_ENTRIES) state.audit.splice(0, state.audit.length - MAX_AUDIT_ENTRIES);
  }

  award(input = {}) {
    const id = safeId(input.userId);
    const source = String(input.source || '').trim().toLowerCase();
    if (!id) throw new Error('A valid Discord user ID is required.');
    if (!VALID_SOURCES.includes(source) && source !== 'admin') throw new Error(`Unsupported XP source: ${source || '(blank)'}.`);

    return this.store.update((state) => {
      state.settings = normalizeSettings(state.settings || {});
      const settings = state.settings;
      const user = this.ensureUser(state, id);
      this.refreshDaily(user);
      const beforeXp = integer(user.xp, 0);
      const beforeLevel = levelForXp(beforeXp);

      if (source !== 'admin') {
        if (settings.enabled === false || settings.sources?.[source] === false) {
          return { ok: true, awarded: 0, skipped: 'source-disabled', profile: this.profileFromState(state, id) };
        }
      }

      const requested = integer(input.amount, 0, 0, 100000);
      if (!requested) return { ok: true, awarded: 0, skipped: 'zero-award', profile: this.profileFromState(state, id) };
      let adjusted = source === 'admin' ? requested : Math.max(0, Math.round(requested * number(settings.globalMultiplier, 1, 0, 5)));

      if (source !== 'admin') {
        const cap = this.sourceCap(settings, source);
        const used = integer(user.daily?.[source], 0);
        if (cap > 0) adjusted = Math.min(adjusted, Math.max(0, cap - used));
        if (adjusted <= 0) return { ok: true, awarded: 0, skipped: 'daily-cap', profile: this.profileFromState(state, id) };
        user.daily[source] = used + adjusted;
      }

      user.xp = beforeXp + adjusted;
      user.sourceTotals[source] = integer(user.sourceTotals[source], 0) + adjusted;
      user.updatedAt = new Date().toISOString();
      const afterLevel = levelForXp(user.xp);
      const crossed = milestoneLevelsCrossed(beforeLevel, afterLevel, settings.milestoneLevels);
      if (source === 'admin' || source === 'event' || source === 'module' || afterLevel > beforeLevel) {
        this.addAudit(state, {
          action: afterLevel > beforeLevel ? 'xp-award-level-up' : 'xp-award',
          actorId: input.actorId,
          userId: id,
          source,
          amount: adjusted,
          reason: input.reason
        });
      }
      return {
        ok: true,
        awarded: adjusted,
        beforeLevel,
        afterLevel,
        leveledUp: afterLevel > beforeLevel,
        levelsGained: Math.max(0, afterLevel - beforeLevel),
        milestonesCrossed: crossed,
        profile: this.profileFromState(state, id)
      };
    });
  }

  profileFromState(state, userId) {
    const ranked = this.rankedUsers(state);
    const index = ranked.findIndex((entry) => entry.userId === userId);
    return publicProfile(state.users?.[userId] || blankUser(userId), index >= 0 ? index + 1 : null);
  }

  setXp(input = {}) {
    const id = safeId(input.userId);
    if (!id) throw new Error('A valid Discord user ID is required.');
    const desired = integer(input.xp, 0, 0, 1000000000);
    return this.store.update((state) => {
      const user = this.ensureUser(state, id);
      const beforeXp = integer(user.xp, 0);
      const beforeLevel = levelForXp(beforeXp);
      user.xp = desired;
      user.updatedAt = new Date().toISOString();
      const afterLevel = levelForXp(desired);
      this.addAudit(state, { action: 'xp-set', actorId: input.actorId, userId: id, source: 'admin', amount: desired - beforeXp, reason: input.reason });
      return {
        ok: true,
        beforeXp,
        afterXp: desired,
        beforeLevel,
        afterLevel,
        leveledUp: afterLevel > beforeLevel,
        levelsGained: Math.max(0, afterLevel - beforeLevel),
        milestonesCrossed: milestoneLevelsCrossed(beforeLevel, afterLevel, state.settings?.milestoneLevels),
        profile: this.profileFromState(state, id)
      };
    });
  }

  removeXp(input = {}) {
    const current = this.profile(input.userId);
    const amount = integer(input.amount, 0, 0, 1000000000);
    return this.setXp({ ...input, xp: Math.max(0, current.xp - amount), reason: input.reason || `Removed ${amount} XP` });
  }

  reset(input = {}) {
    const id = safeId(input.userId);
    if (!id) throw new Error('A valid Discord user ID is required.');
    return this.store.update((state) => {
      const before = state.users?.[id] || blankUser(id);
      state.users ||= {};
      state.users[id] = blankUser(id);
      this.addAudit(state, { action: 'xp-reset', actorId: input.actorId, userId: id, source: 'admin', amount: -integer(before.xp, 0), reason: input.reason });
      return { ok: true, beforeXp: integer(before.xp, 0), profile: this.profileFromState(state, id) };
    });
  }

  updateSettings(input = {}) {
    return this.store.update((state) => {
      const current = normalizeSettings(state.settings || {});
      const nextInput = { ...current };
      if (Object.prototype.hasOwnProperty.call(input, 'enabled')) nextInput.enabled = Boolean(input.enabled);
      if (Object.prototype.hasOwnProperty.call(input, 'globalMultiplier')) nextInput.globalMultiplier = input.globalMultiplier;
      if (input.sources && typeof input.sources === 'object') nextInput.sources = { ...current.sources, ...input.sources };
      if (Array.isArray(input.ignoredChannelIds)) nextInput.ignoredChannelIds = input.ignoredChannelIds;
      if (Array.isArray(input.ignoredRoleIds)) nextInput.ignoredRoleIds = input.ignoredRoleIds;
      if (input.message && typeof input.message === 'object') nextInput.message = { ...current.message, ...input.message };
      if (input.voice && typeof input.voice === 'object') nextInput.voice = { ...current.voice, ...input.voice };
      if (input.event && typeof input.event === 'object') nextInput.event = { ...current.event, ...input.event };
      if (input.module && typeof input.module === 'object') nextInput.module = { ...current.module, ...input.module };
      if (Array.isArray(input.milestoneLevels)) nextInput.milestoneLevels = input.milestoneLevels;
      state.settings = normalizeSettings(nextInput, current);
      this.addAudit(state, { action: 'settings-update', actorId: input.actorId, source: 'admin', reason: input.reason || 'Community leveling settings updated' });
      return { ok: true, settings: clone(state.settings) };
    });
  }

  audit(limit = 50) {
    const max = integer(limit, 50, 1, MAX_AUDIT_ENTRIES);
    return clone((this.store.read().audit || []).slice(-max).reverse());
  }
}

module.exports = {
  VALID_SOURCES,
  MILESTONE_LEVELS,
  MAX_AUDIT_ENTRIES,
  MAX_LEADERBOARD_LIMIT,
  DEFAULT_LEVEL_SETTINGS,
  integer,
  number,
  safeId,
  safeText,
  utcDay,
  xpForLevel,
  levelForXp,
  progressForXp,
  milestoneLevelsCrossed,
  normalizeSettings,
  blankUser,
  publicProfile,
  CommunityLevelService
};
