'use strict';

const path = require('node:path');

const DATA_DIR_DEFAULT = '/data/vanguard';

function snowflake(value) {
  const text = String(value || '').trim();
  return /^\d{17,20}$/.test(text) ? text : '';
}

function clampInt(value, fallback, min, max) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function csvIds(value) {
  return String(value || '')
    .split(',')
    .map((item) => snowflake(item))
    .filter(Boolean);
}

function dataDir(env = process.env) {
  const configured = String(env.VANGUARD_DATA_DIR || '').trim();
  return configured || DATA_DIR_DEFAULT;
}

function lfgLimits(env = process.env) {
  return {
    ttlMin: clampInt(env.VANGUARD_LFG_DEFAULT_TTL_MIN, 120, 15, 720),
    maxOpen: clampInt(env.VANGUARD_LFG_MAX_OPEN_PER_USER, 2, 1, 10)
  };
}

function roleIdsOf(interaction) {
  const cache = interaction?.member?.roles?.cache;
  if (!cache) {
    if (Array.isArray(interaction?.member?.roles)) return interaction.member.roles.map(String);
    return [];
  }
  if (typeof cache.keys === 'function') return [...cache.keys()].map(String);
  if (Array.isArray(cache)) return cache.map(String);
  return [];
}

function hasStaffRole(interaction, env = process.env) {
  const allowed = new Set(csvIds(env.VANGUARD_STAFF_ROLE_IDS));
  if (!allowed.size) return false;
  return roleIdsOf(interaction).some((id) => allowed.has(id));
}

function statePaths(env = process.env) {
  const root = dataDir(env);
  const stateDir = path.join(root, 'state');
  return {
    root,
    stateDir,
    lfg: path.join(stateDir, 'lfg.json'),
    panels: path.join(stateDir, 'panels.json'),
    channels: path.join(stateDir, 'channels.json')
  };
}

module.exports = {
  DATA_DIR_DEFAULT,
  snowflake,
  clampInt,
  csvIds,
  dataDir,
  lfgLimits,
  roleIdsOf,
  hasStaffRole,
  statePaths
};
