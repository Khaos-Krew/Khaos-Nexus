'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');

const STAFF_CATEGORY_NAMES = new Set(['staff', 'staff operations']);
const INFORMATION_CATEGORY_NAMES = new Set(['information', 'info', 'start here']);
const VOICE_CATEGORY_NAMES = new Set(['voice']);

// Consoles and backups were moved into STAFF by hand. Repair must not file
// them back into the game category. The provisioner already leaves any
// channel that has a parent where it is; this list is the operator-facing set.
const STAFF_HELD_LAYOUT_CHANNELS = Object.freeze([
  'minecraft-console',
  'minecraft-backups',
  'ark-console',
  'palworld-console',
  'palworld-backups'
]);

function normalizedCategoryName(value) {
  return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function flagEnabled(value) {
  if (value === true) return true;
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function guildIdList(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(source.map((item) => String(item || '').trim()).filter(Boolean))];
}

// Unset or false keeps today's provisioning. A deployment can turn the flag on
// for every guild it serves, or list guild ids so any other guild stays on the
// historical path.
function respectsManualLayout(config = {}, guildId = '') {
  const discord = config.discord || {};
  if (!flagEnabled(discord.respectManualLayout)) return false;
  const list = guildIdList(discord.respectManualLayoutGuildIds);
  if (!list.length) return true;
  const guild = String(guildId || '').trim();
  return Boolean(guild) && list.includes(guild);
}

function featureGuildIds(discord = {}, key = '') {
  const specific = guildIdList(discord[`${key}GuildIds`]);
  if (specific.length) return specific;
  return guildIdList(discord.layoutGuildIds);
}

function featureEnabledForGuild(config = {}, key = '', guildId = '') {
  const discord = config.discord || {};
  if (!flagEnabled(discord[key])) return false;
  const list = featureGuildIds(discord, key);
  if (!list.length) return true;
  const guild = String(guildId || '').trim();
  return Boolean(guild) && list.includes(guild);
}

function slimGameLayoutEnabled(config = {}, guildId = '') {
  return featureEnabledForGuild(config, 'slimGameLayout', guildId);
}

function playerVoiceCategoryEnabled(config = {}, guildId = '') {
  return featureEnabledForGuild(config, 'playerVoiceCategory', guildId);
}

function foldStartHereEnabled(config = {}, guildId = '') {
  return featureEnabledForGuild(config, 'foldStartHere', guildId);
}

// Empty means "keep today's order". "minecraft-first" (or a module id of
// minecraft alone) puts Minecraft first and leaves every other game
// alphabetical. A comma list is a priority prefix; unlisted games follow A-Z.
function gameCategoryOrderIds(config = {}, guildId = '') {
  const discord = config.discord || {};
  const raw = discord.gameCategoryOrder;
  if (raw == null || raw === false) return null;
  const text = (Array.isArray(raw) ? raw.join(',') : String(raw)).trim();
  if (!text) return null;
  const list = featureGuildIds(discord, 'gameCategoryOrder');
  if (list.length) {
    const guild = String(guildId || '').trim();
    if (!guild || !list.includes(guild)) return null;
  }
  const lowered = text.toLowerCase();
  if (['minecraft-first', 'minecraft', 'true', 'yes', 'on', '1'].includes(lowered)) return ['minecraft'];
  const ids = text.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  return ids.length ? ids : null;
}

function findPlayerVoiceCategory(channels, { categoryId = '' } = {}) {
  const categories = [...(channels?.values?.() || [])].filter((channel) => channel?.type === ChannelType.GuildCategory);
  const wantedId = String(categoryId || '').trim();
  if (wantedId) {
    const byId = categories.find((channel) => String(channel.id) === wantedId);
    if (byId) return byId;
  }
  return categories.find((channel) => isVoiceCategoryName(channel.name)) || null;
}

function channelParentIsPlayerVoice(channel, channels) {
  if (!channel || channel.type !== ChannelType.GuildVoice) return false;
  if (isVoiceCategoryName(channel.parent?.name)) return true;
  const parent = channelById(channels, channel.parentId);
  return isVoiceCategoryName(parent?.name);
}

function isStaffCategoryName(name) {
  return STAFF_CATEGORY_NAMES.has(normalizedCategoryName(name));
}

function isInformationCategoryName(name) {
  return INFORMATION_CATEGORY_NAMES.has(normalizedCategoryName(name));
}

function isVoiceCategoryName(name) {
  return VOICE_CATEGORY_NAMES.has(normalizedCategoryName(name));
}

function isHandHiddenChannelName(name) {
  const key = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return key === 'cobblemon' || key === 'about' || key === 'patchnotes';
}

function isProtectedLayoutCategory(name) {
  return isStaffCategoryName(name) || isInformationCategoryName(name) || isVoiceCategoryName(name);
}

function isStaffCategoryChannel(channel) {
  return channel?.type === ChannelType.GuildCategory && isStaffCategoryName(channel.name);
}

function channelById(channels, id) {
  const key = String(id || '');
  if (!key || !channels || typeof channels.get !== 'function') return null;
  return channels.get(key) || null;
}

function isStaffLocated(channel, channels = null) {
  if (!channel) return false;
  if (isStaffCategoryChannel(channel)) return true;
  if (isStaffCategoryName(channel.parent?.name)) return true;
  const parent = channelById(channels, channel.parentId);
  return isStaffCategoryName(parent?.name);
}

function hiddenFromEveryone(channel, guildId = '') {
  const id = String(guildId || channel?.guild?.id || channel?.guildId || '');
  if (!id || typeof channel?.permissionOverwrites?.cache?.get !== 'function') return false;
  const overwrite = channel.permissionOverwrites.cache.get(id);
  if (!overwrite) return false;
  const denies = overwrite.deny?.has?.(PermissionFlagsBits.ViewChannel) === true;
  const allows = overwrite.allow?.has?.(PermissionFlagsBits.ViewChannel) === true;
  return denies && !allows;
}

// Repair and the periodic cycle may refresh a console that still lives in its
// game category. They must not speak into a channel that was moved, including
// one now sitting in STAFF, and they must not announce a channel they refused
// to recreate.
function shouldPostLayoutMessage(channel, { categoryId = '', channels = null, guildId = '' } = {}) {
  if (!channel) return false;
  if (isHandHiddenChannelName(channel.name) && hiddenFromEveryone(channel, guildId || channel.guild?.id)) return false;
  if (isStaffLocated(channel, channels) || isStaffCategoryChannel(channel)) return false;
  const parentId = String(channel.parentId || '');
  const wanted = String(categoryId || '');
  if (wanted && parentId !== wanted) return false;
  if (hiddenFromEveryone(channel, guildId || channel.guild?.id) && (!wanted || parentId !== wanted)) return false;
  return true;
}

module.exports = {
  INFORMATION_CATEGORY_NAMES,
  STAFF_CATEGORY_NAMES,
  STAFF_HELD_LAYOUT_CHANNELS,
  VOICE_CATEGORY_NAMES,
  channelParentIsPlayerVoice,
  featureEnabledForGuild,
  findPlayerVoiceCategory,
  flagEnabled,
  foldStartHereEnabled,
  gameCategoryOrderIds,
  guildIdList,
  hiddenFromEveryone,
  isHandHiddenChannelName,
  isInformationCategoryName,
  isProtectedLayoutCategory,
  isStaffCategoryChannel,
  isStaffCategoryName,
  isStaffLocated,
  isVoiceCategoryName,
  normalizedCategoryName,
  playerVoiceCategoryEnabled,
  respectsManualLayout,
  shouldPostLayoutMessage,
  slimGameLayoutEnabled
};
