'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { purchasableRanks } = require('../shared/ranks.cjs');

const SUPPORTER_HUB_NAME = 'SUPPORTER HUB';
const ORIGIN_FOUNDER_ID = 'origin-founder';

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function findSupporterHub(channels) {
  return valuesOf(channels).find((channel) => channel?.type === ChannelType.GuildCategory && normalizeName(channel.name) === normalizeName(SUPPORTER_HUB_NAME)) || null;
}

function roleId(value) {
  const id = String(value || '').trim();
  return /^\d{5,25}$/.test(id) ? id : '';
}

function supporterVisibilityRoles(config = {}) {
  const roles = [];
  for (const rank of purchasableRanks()) {
    const id = roleId(config.discord?.rankRoles?.[rank.id]);
    roles.push({ rankId: rank.id, rankName: rank.name, roleId: id, legacy: false });
  }
  const founder = roleId(config.discord?.rankRoles?.[ORIGIN_FOUNDER_ID]);
  roles.push({ rankId: ORIGIN_FOUNDER_ID, rankName: 'Origin Founder', roleId: founder, legacy: true });
  return roles;
}

function supporterHubPolicy(config = {}) {
  const roles = supporterVisibilityRoles(config);
  return {
    visibleRoleIds: [...new Set(roles.map((item) => item.roleId).filter(Boolean))],
    missingPaidRanks: roles.filter((item) => !item.legacy && !item.roleId).map((item) => item.rankId),
    founderConfigured: Boolean(roles.find((item) => item.legacy)?.roleId),
    shadowRecruitIncluded: false
  };
}

async function reconcileSupporterHubCategory(guild, config = {}, options = {}) {
  const channels = options.channels || await guild.channels.fetch();
  const category = findSupporterHub(channels);
  if (!category) return { ok: false, skipped: true, reason: 'supporter-hub-missing', changed: 0, warnings: [] };
  if (!category.permissionOverwrites?.edit) return { ok: false, skipped: true, reason: 'permission-overwrites-unavailable', changed: 0, warnings: [] };

  const policy = supporterHubPolicy(config);
  const warnings = [];
  if (policy.missingPaidRanks.length) warnings.push(`Missing paid rank role mappings: ${policy.missingPaidRanks.join(', ')}`);
  if (!policy.founderConfigured) warnings.push('Origin Founder role mapping is not configured; legacy Founder access was not added.');

  let changed = 0;
  await category.permissionOverwrites.edit(String(guild.id), { ViewChannel: false }, { reason: 'Nexus Sentinal Supporter Hub baseline privacy' });
  changed += 1;
  for (const id of policy.visibleRoleIds) {
    await category.permissionOverwrites.edit(id, { ViewChannel: true }, { reason: 'Nexus Sentinal Supporter Hub rank access' });
    changed += 1;
  }

  const botId = roleId(options.botId);
  if (botId) {
    await category.permissionOverwrites.edit(botId, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: true,
      ManageMessages: true
    }, { reason: 'Nexus Sentinal Supporter Hub management access' });
    changed += 1;
  }

  return {
    ok: true,
    skipped: false,
    reason: '',
    categoryId: String(category.id || ''),
    visibleRoleIds: policy.visibleRoleIds,
    missingPaidRanks: policy.missingPaidRanks,
    founderConfigured: policy.founderConfigured,
    changed,
    warnings
  };
}

module.exports = {
  SUPPORTER_HUB_NAME,
  ORIGIN_FOUNDER_ID,
  normalizeName,
  findSupporterHub,
  supporterVisibilityRoles,
  supporterHubPolicy,
  reconcileSupporterHubCategory,
  PermissionFlagsBits
};
