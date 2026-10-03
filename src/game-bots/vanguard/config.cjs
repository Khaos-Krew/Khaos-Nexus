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

function flagEnabled(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const text = String(value).trim().toLowerCase();
  if (text === '1' || text === 'true' || text === 'yes' || text === 'on') return true;
  if (text === '0' || text === 'false' || text === 'no' || text === 'off') return false;
  return fallback;
}

function groupIds(value) {
  return String(value || '')
    .split(',')
    .map((item) => String(item).trim())
    .filter((item) => /^\d{1,20}$/.test(item));
}

function bungieUserAgent(env = process.env) {
  const configured = String(env.BUNGIE_USER_AGENT || '').trim();
  if (configured) return configured;
  let version = '0.1.0';
  try {
    version = require('../../../package.json').version || version;
  } catch {
    version = '0.1.0';
  }
  const appId = String(env.VANGUARD_DISCORD_APP_ID || '').trim() || 'unset';
  return `NexusVanguard/${version} AppId/${appId} (+https://github.com/Khaos-Krew/Khaos-Nexus)`;
}

function bungieConfig(env = process.env) {
  const apiKey = String(env.BUNGIE_API_KEY || '').trim();
  return {
    apiKey,
    configured: Boolean(apiKey),
    userAgent: bungieUserAgent(env),
    rps: clampInt(env.VANGUARD_BUNGIE_RPS, 5, 1, 10),
    manifestPollMin: clampInt(env.VANGUARD_MANIFEST_POLL_MIN, 60, 5, 1440),
    resetPanel: flagEnabled(env.VANGUARD_RESET_PANEL_ENABLED, false),
    xurPanel: flagEnabled(env.VANGUARD_XUR_PANEL_ENABLED, true),
    playerLookup: flagEnabled(env.VANGUARD_PLAYER_LOOKUP_ENABLED, false),
    clanPanel: flagEnabled(env.VANGUARD_CLAN_PANEL_ENABLED, false),
    clanGroupIds: groupIds(env.VANGUARD_CLAN_GROUP_IDS)
  };
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
    channels: path.join(stateDir, 'channels.json'),
    health: path.join(stateDir, 'health.json'),
    manifestDir: path.join(root, 'manifest'),
    manifestCurrent: path.join(root, 'manifest', 'current.json'),
    manifestTmp: path.join(root, 'manifest', 'tmp')
  };
}

module.exports = {
  DATA_DIR_DEFAULT,
  snowflake,
  clampInt,
  csvIds,
  flagEnabled,
  groupIds,
  bungieUserAgent,
  bungieConfig,
  dataDir,
  lfgLimits,
  roleIdsOf,
  hasStaffRole,
  statePaths
};
