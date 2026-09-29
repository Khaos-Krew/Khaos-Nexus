'use strict';

const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');
const { parseLinkRate } = require('./rate-limit.cjs');

const DEFAULT_COLOR = 0xb00020;
const DISCORD_ID = /^\d{15,24}$/;

function cardEnabled(env = process.env) {
  return ['1', 'true', 'yes', 'on'].includes(String(env.CARD_ENABLED || '').trim().toLowerCase());
}

function cardDataDir(env = process.env) {
  if (String(env.CARD_DATA_DIR || '').trim()) return path.resolve(env.CARD_DATA_DIR);
  const root = String(env.NEXUS_DATA_DIR || '').trim()
    ? path.resolve(env.NEXUS_DATA_DIR)
    : path.resolve(__dirname, '../../..', 'data');
  return path.join(root, 'card');
}

function sourceTimeoutMs(env = process.env) {
  const parsed = Number(env.CARD_SOURCE_TIMEOUT_MS || 1500);
  if (!Number.isFinite(parsed) || parsed < 1) return 1500;
  return parsed;
}

function cardLimitOptions(env = process.env) {
  const link = parseLinkRate(env.CARD_LINK_RATE);
  const viewSeconds = Number(env.CARD_VIEW_COOLDOWN_S || 5);
  return {
    linkLimit: link.limit,
    linkWindowMs: link.windowMs,
    viewCooldownMs: Number.isFinite(viewSeconds) && viewSeconds >= 0 ? viewSeconds * 1000 : 5000
  };
}

function o9AdminAllowList(config = {}) {
  // /o9verify grants only Discord Administrator today. There is no allow-list
  // key on the box. This optional list is the card runtime OR-path. Operator
  // and staff role IDs are intentionally not read.
  const raw = config?.discord?.o9AdminUserIds || config?.discord?.o9AdminVerifyUserIds || [];
  return new Set((Array.isArray(raw) ? raw : [])
    .map((id) => String(id || '').trim())
    .filter((id) => DISCORD_ID.test(id)));
}

function isCardAdmin(interaction, config = {}) {
  if (interaction?.memberPermissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const userId = String(interaction?.user?.id || '');
  return o9AdminAllowList(config).has(userId);
}

module.exports = {
  DEFAULT_COLOR,
  DISCORD_ID,
  cardEnabled,
  cardDataDir,
  sourceTimeoutMs,
  cardLimitOptions,
  o9AdminAllowList,
  isCardAdmin
};
