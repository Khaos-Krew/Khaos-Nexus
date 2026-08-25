'use strict';

const { Routes } = require('discord.js');
const { skuToRankMap } = require('../shared/ranks.cjs');
const { planSupporterRankReconciliation } = require('./supporter-rank-reconcile.cjs');

const MAX_ENTITLEMENT_PAGES = 10;
const ENTITLEMENT_PAGE_SIZE = 100;

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function configuredSkuIds(config = {}) {
  return [...skuToRankMap(config).keys()];
}

function normalizeEntitlement(entitlement = {}) {
  return {
    id: String(entitlement.id || ''),
    sku_id: String(entitlement.sku_id || entitlement.skuId || ''),
    user_id: String(entitlement.user_id || entitlement.userId || ''),
    guild_id: String(entitlement.guild_id || entitlement.guildId || ''),
    starts_at: entitlement.starts_at || entitlement.startsAt || null,
    ends_at: entitlement.ends_at || entitlement.endsAt || null,
    deleted: entitlement.deleted === true,
    type: entitlement.type ?? null
  };
}

function activeConfiguredEntitlements(entitlements = [], config = {}, now = Date.now()) {
  const allowed = new Set(configuredSkuIds(config));
  return (Array.isArray(entitlements) ? entitlements : [])
    .map(normalizeEntitlement)
    .filter((item) => item.id && item.sku_id && allowed.has(item.sku_id))
    .filter((item) => item.deleted !== true)
    .filter((item) => !item.starts_at || Date.parse(item.starts_at) <= now)
    .filter((item) => !item.ends_at || Date.parse(item.ends_at) > now);
}

function groupUserEntitlements(entitlements = []) {
  const users = new Map();
  const guildEntitlements = [];
  for (const entitlement of entitlements) {
    const normalized = normalizeEntitlement(entitlement);
    if (normalized.user_id) {
      if (!users.has(normalized.user_id)) users.set(normalized.user_id, []);
      users.get(normalized.user_id).push(normalized);
    } else if (normalized.guild_id) {
      guildEntitlements.push(normalized);
    }
  }
  return { users, guildEntitlements };
}

async function fetchConfiguredEntitlements(client, config = {}, options = {}) {
  const applicationId = String(options.applicationId || client?.application?.id || client?.user?.id || '');
  const skuIds = configuredSkuIds(config);
  if (!applicationId) return { ok: false, reason: 'application-id-unavailable', entitlements: [], pages: 0, truncated: false };
  if (!skuIds.length) return { ok: true, reason: 'no-configured-skus', entitlements: [], pages: 0, truncated: false };
  if (!client?.rest?.get) return { ok: false, reason: 'discord-rest-unavailable', entitlements: [], pages: 0, truncated: false };

  const collected = [];
  let after = '';
  let pages = 0;
  let truncated = false;
  for (; pages < MAX_ENTITLEMENT_PAGES; pages += 1) {
    const query = new URLSearchParams({
      limit: String(ENTITLEMENT_PAGE_SIZE),
      exclude_ended: 'true',
      exclude_deleted: 'true',
      sku_ids: skuIds.join(',')
    });
    if (after) query.set('after', after);
    const page = await client.rest.get(Routes.entitlements(applicationId), { query });
    const items = Array.isArray(page) ? page.map(normalizeEntitlement) : [];
    collected.push(...items);
    if (items.length < ENTITLEMENT_PAGE_SIZE) break;
    after = String(items.at(-1)?.id || '');
    if (!after) break;
    if (pages === MAX_ENTITLEMENT_PAGES - 1) truncated = true;
  }
  return {
    ok: true,
    reason: '',
    entitlements: activeConfiguredEntitlements(collected, config),
    pages: pages + (collected.length || pages ? 1 : 0),
    truncated
  };
}

function currentMemberRoleIds(member) {
  const cache = member?.roles?.cache;
  if (!cache) return [];
  if (typeof cache.keys === 'function') return [...cache.keys()].map(String);
  return valuesOf(cache).map((role) => String(role?.id || role)).filter(Boolean);
}

async function resolveAffectedRoles(guild, plan) {
  const roles = await guild.roles.fetch();
  const roleMap = new Map(valuesOf(roles).map((role) => [String(role?.id || ''), role]));
  const affected = [...new Set([...(plan.addRoleIds || []), ...(plan.removeRoleIds || [])])];
  const missing = [];
  const uneditable = [];
  for (const roleId of affected) {
    const role = roleMap.get(String(roleId));
    if (!role) missing.push(String(roleId));
    else if (role.editable === false) uneditable.push({ id: String(role.id), name: String(role.name || role.id) });
  }
  return { roleMap, missing, uneditable };
}

async function reconcileMemberSupporterRank(guild, userId, entitlements = [], config = {}) {
  const member = await guild.members.fetch(String(userId)).catch(() => null);
  if (!member) return { ok: false, skipped: true, reason: 'member-unavailable', userId: String(userId), added: [], removed: [] };

  const plan = planSupporterRankReconciliation({
    currentRoleIds: currentMemberRoleIds(member),
    entitlements,
    config
  });
  if (!plan.ok) return { ...plan, skipped: true, userId: String(userId), added: [], removed: [] };
  if (!plan.changed) return { ...plan, skipped: false, userId: String(userId), added: [], removed: [] };

  const resolved = await resolveAffectedRoles(guild, plan);
  if (resolved.missing.length) {
    return { ...plan, ok: false, skipped: true, reason: 'discord-role-missing', missingRoleIds: resolved.missing, userId: String(userId), added: [], removed: [] };
  }
  if (resolved.uneditable.length) {
    return { ...plan, ok: false, skipped: true, reason: 'discord-role-uneditable', uneditableRoles: resolved.uneditable, userId: String(userId), added: [], removed: [] };
  }

  const added = [];
  const removed = [];
  for (const roleId of plan.addRoleIds || []) {
    const role = resolved.roleMap.get(String(roleId));
    await member.roles.add(role, 'Nexus Sentinal Discord supporter entitlement reconciliation');
    added.push(String(roleId));
  }
  for (const roleId of plan.removeRoleIds || []) {
    const role = resolved.roleMap.get(String(roleId));
    await member.roles.remove(role, 'Nexus Sentinal Discord supporter entitlement reconciliation');
    removed.push(String(roleId));
  }
  return { ...plan, skipped: false, userId: String(userId), added, removed };
}

async function reconcileSupporterEntitlements(client, guild, config = {}, options = {}) {
  const fetched = await fetchConfiguredEntitlements(client, config, options);
  if (!fetched.ok) return { ...fetched, users: [], guildEntitlements: [] };
  const grouped = groupUserEntitlements(fetched.entitlements);
  const results = [];
  for (const [userId, entitlements] of grouped.users) {
    results.push(await reconcileMemberSupporterRank(guild, userId, entitlements, config));
  }
  return {
    ...fetched,
    users: results,
    guildEntitlements: grouped.guildEntitlements,
    changed: results.reduce((count, item) => count + Number((item.added?.length || 0) + (item.removed?.length || 0)), 0),
    failures: results.filter((item) => item.ok === false).length
  };
}

module.exports = {
  MAX_ENTITLEMENT_PAGES,
  ENTITLEMENT_PAGE_SIZE,
  configuredSkuIds,
  normalizeEntitlement,
  activeConfiguredEntitlements,
  groupUserEntitlements,
  fetchConfiguredEntitlements,
  currentMemberRoleIds,
  resolveAffectedRoles,
  reconcileMemberSupporterRank,
  reconcileSupporterEntitlements
};
