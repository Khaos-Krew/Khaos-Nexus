'use strict';

const { PermissionFlagsBits } = require('discord.js');

const NOT_CONFIGURED = 'Nexus Craft is not configured. Set NEXUS_CRAFT_DISCORD_CATEGORY_ID.';
const OUTSIDE = 'Use Nexus Craft in its Discord category.';

function readCraftCategory(env = process.env) {
  const raw = env.NEXUS_CRAFT_DISCORD_CATEGORY_ID;
  if (raw === undefined || String(raw).trim() === '') return { id: '', code: 'unset' };
  const id = String(raw).trim();
  if (!/^\d{17,20}$/.test(id)) return { id: '', code: 'invalid' };
  return { id, code: 'set' };
}

function readAllowedChannelIds(env = process.env) {
  return String(env.SENTINAL_CRAFT_ALLOWED_CHANNEL_IDS || '')
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter((id) => /^\d{17,20}$/.test(id));
}

function channelIdOf(interaction) {
  return String(interaction?.channelId || interaction?.channel?.id || '');
}

function hasGuildManagement(interaction) {
  const perms = interaction?.memberPermissions;
  if (typeof perms?.has !== 'function') return false;
  return perms.has(PermissionFlagsBits.Administrator) === true
    || perms.has(PermissionFlagsBits.ManageGuild) === true;
}

function canBypassCraftCategory(interaction, config = {}, env = process.env) {
  if (hasGuildManagement(interaction)) return true;
  return craftIsStaff(interaction, config, env);
}

// Location gate for /mc, /mcrcon, /craft, and /realm (except Approve/Deny buttons).
// The Craft category stays allowed for everyone. Channels listed in
// SENTINAL_CRAFT_ALLOWED_CHANNEL_IDS are also allowed. Users with
// Administrator, Manage Guild, or a Nexus Operator+ staff check may use any
// channel. This does not change /mcrcon or other staff-only permission checks.
function decideCategory(env, channelCategoryId, extras = {}) {
  const config = readCraftCategory(env);
  if (!config.id) return { allow: false, code: config.code, message: NOT_CONFIGURED };
  if (String(channelCategoryId || '') === config.id) return { allow: true, code: 'allow', message: '' };
  const channelId = String(extras.channelId || channelIdOf(extras.interaction) || '');
  if (channelId && readAllowedChannelIds(env).includes(channelId)) {
    return { allow: true, code: 'allowlist', message: '' };
  }
  if (extras.staff === true || canBypassCraftCategory(extras.interaction, extras.config, env)) {
    return { allow: true, code: 'staff', message: '' };
  }
  return { allow: false, code: 'outside', message: OUTSIDE };
}

function realmDecisionAllowed({ actorId, listingOwnerId, staff = false } = {}) {
  const actor = String(actorId || '');
  const owner = String(listingOwnerId || '');
  if (!/^\d{17,20}$/.test(actor) || !/^\d{17,20}$/.test(owner)) return false;
  if (actor === owner) return true;
  return staff === true;
}

function craftIsStaff(interaction, config = {}, env = process.env) {
  const { isStaff } = require('../game-bots/ops-spine.cjs');
  return isStaff(interaction, config, env);
}

module.exports = {
  NOT_CONFIGURED,
  OUTSIDE,
  readCraftCategory,
  readAllowedChannelIds,
  channelIdOf,
  canBypassCraftCategory,
  decideCategory,
  realmDecisionAllowed,
  craftIsStaff
};
