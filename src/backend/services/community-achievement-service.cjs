'use strict';

const path = require('node:path');
const { JsonStore, clone } = require('../core/json-store.cjs');
const { safeId } = require('./community-level-service.cjs');

const ACHIEVEMENT_SOURCES = Object.freeze(['message', 'voice', 'event', 'module']);

const ACHIEVEMENT_DEFINITIONS = Object.freeze([
  { id: 'first-spark', name: 'First Spark', icon: '⚡', category: 'Progression', rarity: 'Common', points: 10, description: 'Reach Community Level 2.', criterion: { type: 'level', target: 2 } },
  { id: 'rising-signal', name: 'Rising Signal', icon: '📡', category: 'Progression', rarity: 'Common', points: 15, description: 'Reach Community Level 5.', criterion: { type: 'level', target: 5 } },
  { id: 'nexus-vanguard', name: 'Nexus Vanguard', icon: '🛡️', category: 'Progression', rarity: 'Uncommon', points: 25, description: 'Reach Community Level 10.', criterion: { type: 'level', target: 10 } },
  { id: 'nexus-veteran', name: 'Nexus Veteran', icon: '🎖️', category: 'Progression', rarity: 'Rare', points: 40, description: 'Reach Community Level 20.', criterion: { type: 'level', target: 20 } },
  { id: 'ascendant', name: 'Ascendant', icon: '🔺', category: 'Progression', rarity: 'Epic', points: 60, description: 'Reach Community Level 30.', criterion: { type: 'level', target: 30 } },
  { id: 'apex-signal', name: 'Apex Signal', icon: '💠', category: 'Progression', rarity: 'Legendary', points: 100, description: 'Reach Community Level 50.', criterion: { type: 'level', target: 50 } },
  { id: 'nexus-legend', name: 'Nexus Legend', icon: '👑', category: 'Progression', rarity: 'Legendary', points: 150, description: 'Reach Community Level 75.', criterion: { type: 'level', target: 75 } },
  { id: 'centurion', name: 'Centurion', icon: '🐉', category: 'Progression', rarity: 'Mythic', points: 250, description: 'Reach Community Level 100.', criterion: { type: 'level', target: 100 } },

  { id: 'first-transmission', name: 'First Transmission', icon: '💬', category: 'Community', rarity: 'Common', points: 10, description: 'Earn your first message XP.', criterion: { type: 'source-xp', source: 'message', target: 1 } },
  { id: 'signal-regular', name: 'Signal Regular', icon: '🗨️', category: 'Community', rarity: 'Uncommon', points: 20, description: 'Earn 375 XP from community messages.', criterion: { type: 'source-xp', source: 'message', target: 375 } },
  { id: 'signal-anchor', name: 'Signal Anchor', icon: '🛰️', category: 'Community', rarity: 'Rare', points: 40, description: 'Earn 1,500 XP from community messages.', criterion: { type: 'source-xp', source: 'message', target: 1500 } },

  { id: 'voice-online', name: 'Voice Online', icon: '🎙️', category: 'Voice', rarity: 'Common', points: 10, description: 'Earn your first voice XP.', criterion: { type: 'source-xp', source: 'voice', target: 1 } },
  { id: 'voice-regular', name: 'Voice Regular', icon: '🔊', category: 'Voice', rarity: 'Uncommon', points: 20, description: 'Earn 120 XP from eligible voice activity.', criterion: { type: 'source-xp', source: 'voice', target: 120 } },
  { id: 'voice-anchor', name: 'Voice Anchor', icon: '📻', category: 'Voice', rarity: 'Rare', points: 40, description: 'Earn 600 XP from eligible voice activity.', criterion: { type: 'source-xp', source: 'voice', target: 600 } },

  { id: 'event-deployed', name: 'Event Deployed', icon: '🎉', category: 'Events', rarity: 'Common', points: 10, description: 'Earn your first event participation XP.', criterion: { type: 'source-xp', source: 'event', target: 1 } },
  { id: 'event-veteran', name: 'Event Veteran', icon: '🏅', category: 'Events', rarity: 'Rare', points: 40, description: 'Earn 500 XP from Nexus events.', criterion: { type: 'source-xp', source: 'event', target: 500 } },

  { id: 'module-runner', name: 'Module Runner', icon: '🎮', category: 'Nexus', rarity: 'Common', points: 10, description: 'Earn your first game-module participation XP.', criterion: { type: 'source-xp', source: 'module', target: 1 } },
  { id: 'module-veteran', name: 'Module Veteran', icon: '🕹️', category: 'Nexus', rarity: 'Rare', points: 40, description: 'Earn 500 XP through Nexus game-module participation.', criterion: { type: 'source-xp', source: 'module', target: 500 } },

  { id: 'all-systems-online', name: 'All Systems Online', icon: '🌐', category: 'Nexus', rarity: 'Epic', points: 75, description: 'Earn XP from messages, voice, events, and game modules.', criterion: { type: 'all-sources', target: 4 } },
  { id: 'deep-resonance', name: 'Deep Resonance', icon: '♦️', category: 'Progression', rarity: 'Epic', points: 75, description: 'Accumulate 25,000 total Community XP.', criterion: { type: 'xp', target: 25000 } }
]);

const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENT_DEFINITIONS.map((definition) => [definition.id, definition]));

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

function achievementValue(definition = {}, profile = {}) {
  const criterion = definition.criterion || {};
  if (criterion.type === 'level') return number(profile.level, 1);
  if (criterion.type === 'xp') return number(profile.xp, 0);
  if (criterion.type === 'source-xp') return number(profile.sourceTotals?.[criterion.source], 0);
  if (criterion.type === 'all-sources') return ACHIEVEMENT_SOURCES.filter((source) => number(profile.sourceTotals?.[source], 0) > 0).length;
  return 0;
}

function achievementProgress(definition = {}, profile = {}) {
  const current = achievementValue(definition, profile);
  const target = Math.max(1, number(definition.criterion?.target, 1));
  return {
    current,
    target,
    percent: Math.max(0, Math.min(100, Math.floor((current / target) * 100))),
    complete: current >= target
  };
}

function normalizeUnlocked(input = {}) {
  const unlocked = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return unlocked;
  for (const [id, value] of Object.entries(input)) {
    if (!ACHIEVEMENT_BY_ID.has(id)) continue;
    const unlockedAt = String(value?.unlockedAt || value || '').trim();
    if (unlockedAt) unlocked[id] = { unlockedAt };
  }
  return unlocked;
}

function publicAchievement(definition, profile, unlocked = null) {
  const progress = achievementProgress(definition, profile);
  return {
    id: definition.id,
    name: definition.name,
    icon: definition.icon,
    category: definition.category,
    rarity: definition.rarity,
    points: definition.points,
    description: definition.description,
    unlocked: Boolean(unlocked),
    unlockedAt: unlocked?.unlockedAt || null,
    progress
  };
}

function summarize(profile = {}, unlockedMap = {}) {
  const achievements = ACHIEVEMENT_DEFINITIONS.map((definition) => publicAchievement(definition, profile, unlockedMap[definition.id]));
  const unlocked = achievements.filter((item) => item.unlocked).sort((a, b) => String(b.unlockedAt || '').localeCompare(String(a.unlockedAt || '')));
  const achievementPoints = unlocked.reduce((total, item) => total + number(item.points, 0), 0);
  return {
    userId: String(profile.userId || ''),
    achievementCount: unlocked.length,
    achievementTotal: achievements.length,
    achievementPoints,
    recentAchievements: unlocked.slice(0, 5),
    achievements
  };
}

class CommunityAchievementService {
  constructor(options = {}) {
    if (!options.levelService || typeof options.levelService.profile !== 'function') throw new Error('CommunityAchievementService requires a community level service.');
    this.levelService = options.levelService;
    const stateFile = options.stateFile || path.join(process.env.NEXUS_DATA_DIR || 'data', 'community-achievements.json');
    this.store = options.store || new JsonStore(stateFile, { version: 1, users: {} });
    this.store.state.users ||= {};
  }

  catalog() { return clone(ACHIEVEMENT_DEFINITIONS); }

  profile(userId, options = {}) {
    const id = safeId(userId);
    if (!id) throw new Error('A valid Discord user ID is required.');
    const profile = this.levelService.profile(id);
    const state = this.store.read();
    const current = normalizeUnlocked(state.users?.[id]?.unlocked);
    const eligible = ACHIEVEMENT_DEFINITIONS.filter((definition) => achievementProgress(definition, profile).complete && !current[definition.id]);
    let newlyUnlocked = [];

    if (eligible.length) {
      const unlockedAt = new Date(options.now || Date.now()).toISOString();
      this.store.update((next) => {
        next.users ||= {};
        next.users[id] ||= { unlocked: {} };
        next.users[id].unlocked = normalizeUnlocked(next.users[id].unlocked);
        for (const definition of eligible) {
          if (!next.users[id].unlocked[definition.id]) next.users[id].unlocked[definition.id] = { unlockedAt };
        }
      });
      newlyUnlocked = eligible.map((definition) => ({ ...publicAchievement(definition, profile, { unlockedAt }) }));
    }

    const unlocked = normalizeUnlocked(this.store.read().users?.[id]?.unlocked);
    return { ok: true, ...summarize(profile, unlocked), newlyUnlocked };
  }
}

module.exports = {
  ACHIEVEMENT_SOURCES,
  ACHIEVEMENT_DEFINITIONS,
  achievementValue,
  achievementProgress,
  normalizeUnlocked,
  publicAchievement,
  summarize,
  CommunityAchievementService
};