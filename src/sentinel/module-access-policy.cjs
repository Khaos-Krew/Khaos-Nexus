'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { NEXUS_RANKS } = require('../shared/ranks.cjs');
const { MODULES, getModule } = require('../backend/modules/catalog.cjs');
const { layoutFor } = require('./module-layouts.cjs');

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function configuredRankRoleIds(config = {}, state = null) {
  const admin = state?.getAdminSettings?.() || {};
  const configured = { ...(config.discord?.rankRoles || {}), ...(admin.rankRoles || {}) };
  return new Set(NEXUS_RANKS.map((rank) => String(configured[rank.id] || '').trim()).filter(Boolean));
}

function savedAccessRoleIds(state = null) {
  return new Set(Object.values(state?.listAccessRoles?.() || {}).map((item) => String(item?.roleId || '').trim()).filter(Boolean));
}

function explicitViewState(channel, targetId) {
  const overwrite = channel?.permissionOverwrites?.cache?.get?.(String(targetId));
  if (!overwrite) return null;
  if (overwrite.allow?.has?.(PermissionFlagsBits.ViewChannel)) return true;
  if (overwrite.deny?.has?.(PermissionFlagsBits.ViewChannel)) return false;
  return null;
}

function desiredViewPolicy({ guildId, accessRoleId, accessRoleIds = [], rankRoleIds = [] } = {}) {
  const desired = new Map();
  const everyoneId = String(guildId || '').trim();
  const allowed = String(accessRoleId || '').trim();
  if (everyoneId) desired.set(everyoneId, false);
  for (const roleId of rankRoleIds || []) {
    const id = String(roleId || '').trim();
    if (id && id !== allowed && id !== everyoneId) desired.set(id, null);
  }
  for (const roleId of accessRoleIds || []) {
    const id = String(roleId || '').trim();
    if (id && id !== allowed && id !== everyoneId) desired.set(id, null);
  }
  if (allowed) desired.set(allowed, true);
  return desired;
}

async function resolveModuleAccessPolicyRoles(guild, moduleId, { state = null, config = {} } = {}) {
  if (!getModule(moduleId)) throw new Error(`Unknown module: ${moduleId}`);
  const roles = await guild.roles.fetch();
  const saved = state?.getAccessRole?.(moduleId) || null;
  const accessRoleId = String(saved?.roleId || '').trim();
  const accessRole = accessRoleId ? roles.get(accessRoleId) || null : null;

  const rankIds = configuredRankRoleIds(config, state);
  const configuredAdmin = state?.getAdminSettings?.() || {};
  const combinedRankConfig = { ...(config.discord?.rankRoles || {}), ...(configuredAdmin.rankRoles || {}) };
  const roleValues = [...roles.values()];
  for (const rank of NEXUS_RANKS) {
    if (String(combinedRankConfig[rank.id] || '').trim()) continue;
    const wanted = normalizeName(rank.name);
    const exact = roleValues.filter((role) => normalizeName(role?.name) === wanted);
    if (exact.length === 1) rankIds.add(String(exact[0].id));
  }

  const accessIds = savedAccessRoleIds(state);
  if (accessRoleId) accessIds.add(accessRoleId);
  return {
    moduleId,
    accessRole,
    accessRoleId,
    accessRoleIds: accessIds,
    rankRoleIds: rankIds
  };
}

async function reconcileChannelViewPolicy(channel, policy, reason = 'Nexus Sentinal module access reconciliation') {
  if (!channel?.permissionOverwrites?.edit) return { ok: false, changed: 0, reason: 'permission-overwrites-unavailable' };
  let changed = 0;
  const edits = [];
  for (const [targetId, desired] of policy.entries()) {
    const current = explicitViewState(channel, targetId);
    if (current === desired) continue;
    if (desired === null && current === null) continue;
    await channel.permissionOverwrites.edit(String(targetId), { ViewChannel: desired }, { reason });
    changed += 1;
    edits.push({ targetId: String(targetId), from: current, to: desired });
  }
  return { ok: true, changed, edits };
}

function inspectChannelViewPolicy(channel, policy) {
  const drift = [];
  for (const [targetId, desired] of policy.entries()) {
    const current = explicitViewState(channel, targetId);
    if (current !== desired) drift.push({ targetId: String(targetId), current, expected: desired });
  }
  return { ok: drift.length === 0, channelId: String(channel?.id || ''), channelName: String(channel?.name || ''), drift };
}

async function modulePolicyContext(guild, moduleId, category, options = {}) {
  const roles = await resolveModuleAccessPolicyRoles(guild, moduleId, options);
  if (!roles.accessRole) {
    return {
      ok: false,
      skipped: true,
      moduleId,
      categoryId: String(category?.id || ''),
      reason: 'module-access-role-missing',
      accessRoleId: roles.accessRoleId,
      rankRoleIds: [...roles.rankRoleIds],
      accessRoleIds: [...roles.accessRoleIds]
    };
  }
  const policy = desiredViewPolicy({
    guildId: guild.id,
    accessRoleId: roles.accessRoleId,
    accessRoleIds: roles.accessRoleIds,
    rankRoleIds: roles.rankRoleIds
  });
  return { ok: true, skipped: false, roles, policy };
}

function managedCategoryChannels(source, category) {
  const categoryId = String(category?.id || category || '').trim();
  if (!categoryId) return [];

  if (source?.channels?.fetch && typeof source.channels.fetch === 'function') {
    return source.channels.fetch().then((channels) => managedCategoryChannels(channels, categoryId));
  }

  const channels = source && typeof source.values === 'function'
    ? [...source.values()]
    : Array.isArray(source)
      ? source
      : Object.values(source || {});
  const categoryChannel = channels.find((channel) => String(channel?.id || '') === categoryId)
    || (category && typeof category === 'object' ? category : null);
  return [
    categoryChannel,
    ...channels.filter((channel) => String(channel?.parentId || '') === categoryId)
  ].filter(Boolean);
}

async function reconcileModuleAccessPolicy(guild, moduleId, category, options = {}) {
  const context = await modulePolicyContext(guild, moduleId, category, options);
  if (!context.ok) return context;
  const channels = await managedCategoryChannels(guild, category);
  let changed = 0;
  const results = [];
  for (const channel of channels) {
    const result = await reconcileChannelViewPolicy(channel, context.policy, `Nexus Sentinal ${moduleId} access policy`);
    changed += result.changed || 0;
    results.push({ channelId: String(channel.id), channelName: String(channel.name || ''), ...result });
  }
  return {
    ok: results.every((item) => item.ok),
    skipped: false,
    moduleId,
    categoryId: String(category.id),
    accessRoleId: context.roles.accessRoleId,
    accessRoleName: String(context.roles.accessRole?.name || ''),
    changed,
    channels: results
  };
}

async function inspectModuleAccessPolicy(guild, moduleId, category, options = {}) {
  const context = await modulePolicyContext(guild, moduleId, category, options);
  if (!context.ok) return context;
  const channels = await managedCategoryChannels(guild, category);
  const results = channels.map((channel) => inspectChannelViewPolicy(channel, context.policy));
  return {
    ok: results.every((item) => item.ok),
    skipped: false,
    moduleId,
    categoryId: String(category.id),
    accessRoleId: context.roles.accessRoleId,
    accessRoleName: String(context.roles.accessRole?.name || ''),
    driftCount: results.reduce((sum, item) => sum + item.drift.length, 0),
    channels: results
  };
}

function strictCategoryMatch(channels, moduleId) {
  const layout = layoutFor(moduleId);
  const wanted = new Set([layout.category, ...(layout.aliases || [])].map(normalizeName).filter(Boolean));
  const matches = [...channels.values()].filter((channel) => channel?.type === ChannelType.GuildCategory && wanted.has(normalizeName(channel.name)));
  return matches.length === 1 ? matches[0] : null;
}

async function reconcileExistingModuleAccessPolicies(guild, { state = null, config = {}, moduleIds = null } = {}) {
  const channels = await guild.channels.fetch();
  const ids = Array.isArray(moduleIds) ? moduleIds : MODULES.map((module) => module.id);
  const modules = [];
  let changed = 0;
  for (const moduleId of ids) {
    if (!getModule(moduleId)) continue;
    const category = strictCategoryMatch(channels, moduleId);
    if (!category) {
      modules.push({ moduleId, ok: true, skipped: true, reason: 'no-unique-exact-category' });
      continue;
    }
    const result = await reconcileModuleAccessPolicy(guild, moduleId, category, { state, config });
    changed += result.changed || 0;
    modules.push(result);
  }
  return { ok: modules.every((item) => item.ok), changed, modules };
}

module.exports = {
  configuredRankRoleIds,
  desiredViewPolicy,
  explicitViewState,
  inspectChannelViewPolicy,
  inspectModuleAccessPolicy,
  managedCategoryChannels,
  normalizeName,
  reconcileChannelViewPolicy,
  reconcileExistingModuleAccessPolicies,
  reconcileModuleAccessPolicy,
  resolveModuleAccessPolicyRoles,
  savedAccessRoleIds,
  strictCategoryMatch
};
