'use strict';

const { envSecret } = require('../shared/config.cjs');
const { NEXUS_RANKS, normalizeId } = require('../shared/ranks.cjs');
const { commandNames } = require('./friendly-commands.cjs');

const ENTITLEMENT_SKU_TYPES = new Set([2, 5]); // Discord DURABLE and SUBSCRIPTION
const RANK_OFFERING_SUFFIXES = new Set([
  'subscription', 'subscriber', 'monthly', 'month', 'annual', 'yearly', 'year',
  'durable', 'lifetime', 'one', 'time', 'purchase', 'membership', 'tier', 'access'
]);

function desiredCommandNames() {
  return [...new Set(['nexus', 'nexus-pair', 'market', 'clear', ...commandNames()])];
}

async function commandStatus(controller) {
  const commands = await controller.guild.commands.fetch();
  const desired = desiredCommandNames();
  const current = desired.map((name) => {
    const command = commands.find((item) => item.name === name);
    return { name, registered: Boolean(command), id: command ? String(command.id) : '' };
  });
  return { ok: current.every((item) => item.registered), desired, commands: current, unrelatedCommandsPreserved: true };
}

function roleRows(roles, guildId = '') {
  const values = roles instanceof Map || typeof roles?.values === 'function' ? [...roles.values()] : Array.isArray(roles) ? roles : [];
  return values
    .filter((role) => role && String(role.id || '') !== String(guildId || '') && role.name !== '@everyone')
    .map((role) => ({ id: String(role.id || ''), name: String(role.name || ''), managed: role.managed === true, position: Number(role.position || 0) }));
}

function skuRows(skus) {
  return (Array.isArray(skus) ? skus : []).map((sku) => ({
    id: String(sku?.id || ''),
    name: String(sku?.name || ''),
    slug: String(sku?.slug || ''),
    type: Number(sku?.type || 0),
    flags: Number(sku?.flags || 0)
  })).filter((sku) => sku.id);
}

function exactRankMatch(value, rank) {
  const normalized = normalizeId(value);
  return Boolean(normalized && normalized === rank.id);
}

function rankOfferingMatch(value, rank) {
  const normalized = normalizeId(value);
  if (!normalized) return false;
  if (normalized === rank.id) return true;
  if (!normalized.startsWith(`${rank.id}-`)) return false;
  const suffix = normalized.slice(rank.id.length + 1).split('-').filter(Boolean);
  return suffix.length > 0 && suffix.every((token) => RANK_OFFERING_SUFFIXES.has(token));
}

function discoverMappingsFromData({ roles = [], skus = [], current = {}, guildId = '' } = {}) {
  const normalizedRoles = roleRows(roles, guildId);
  const normalizedSkus = skuRows(skus);
  const currentRoles = current.rankRoles || {};
  const currentSkus = current.rankSkus || {};
  const suggestedRankRoles = {};
  const suggestedRankSkus = {};
  const ranks = [];
  let discoveredRoles = 0;
  let discoveredSkus = 0;
  let attention = 0;

  for (const rank of NEXUS_RANKS) {
    const configuredRoleId = String(currentRoles[rank.id] || '');
    const roleCandidates = normalizedRoles.filter((role) => !role.managed && exactRankMatch(role.name, rank));
    const suggestedRoleId = configuredRoleId || (roleCandidates.length === 1 ? roleCandidates[0].id : '');
    suggestedRankRoles[rank.id] = suggestedRoleId;
    if (!configuredRoleId && roleCandidates.length === 1) discoveredRoles += 1;

    const configuredSkuIds = Array.isArray(currentSkus[rank.id]) ? currentSkus[rank.id].map(String).filter(Boolean) : [];
    const entitlementSkus = rank.level === 0 ? [] : normalizedSkus.filter((sku) =>
      ENTITLEMENT_SKU_TYPES.has(sku.type) && (rankOfferingMatch(sku.name, rank) || rankOfferingMatch(sku.slug, rank))
    );
    const suggestedSkuIds = configuredSkuIds.length ? configuredSkuIds : [...new Set(entitlementSkus.map((sku) => sku.id))];
    suggestedRankSkus[rank.id] = suggestedSkuIds;
    if (!configuredSkuIds.length && suggestedSkuIds.length) discoveredSkus += suggestedSkuIds.length;

    const roleStatus = configuredRoleId ? 'configured' : roleCandidates.length === 1 ? 'discovered' : roleCandidates.length > 1 ? 'ambiguous' : 'missing';
    const skuStatus = rank.level === 0 ? 'free-default' : configuredSkuIds.length ? 'configured' : entitlementSkus.length ? 'discovered' : 'missing';
    if (roleStatus === 'ambiguous' || roleStatus === 'missing' || (rank.level > 0 && skuStatus === 'missing')) attention += 1;

    ranks.push({
      id: rank.id,
      name: rank.name,
      level: rank.level,
      role: { status: roleStatus, id: suggestedRoleId, candidates: roleCandidates },
      skus: { status: skuStatus, ids: suggestedSkuIds, candidates: entitlementSkus }
    });
  }

  return {
    ok: attention === 0,
    counts: { discoveredRoles, discoveredSkus, attention },
    ranks,
    suggestedSettings: { rankRoles: suggestedRankRoles, rankSkus: suggestedRankSkus }
  };
}

async function fetchApplicationSkus(controller) {
  const config = controller.effectiveConfig();
  const token = envSecret(config.discord?.tokenEnv);
  const applicationId = String(controller.client?.application?.id || '');
  if (!token || !applicationId) throw new Error('Sentinal cannot discover Premium SKUs until its application and bot token are available.');
  const response = await controller.fetchImpl(`https://discord.com/api/v10/applications/${applicationId}/skus`, {
    headers: { authorization: `Bot ${token}`, accept: 'application/json', 'user-agent': 'Khaos-Nexus-Sentinal/0.1' }
  });
  if (!response.ok) throw new Error(`Discord SKU API returned HTTP ${response.status}.`);
  const skus = await response.json();
  if (!Array.isArray(skus)) throw new Error('Discord SKU API returned an unexpected response.');
  return { applicationId, skus };
}

async function discoverRankMappings(controller) {
  const [roles, skuResult] = await Promise.all([
    controller.guild.roles.fetch(),
    fetchApplicationSkus(controller)
  ]);
  return {
    ...discoverMappingsFromData({ roles, skus: skuResult.skus, current: controller.adminConfig(), guildId: controller.guild.id }),
    applicationId: skuResult.applicationId,
    skuCount: skuResult.skus.length
  };
}

module.exports = {
  ENTITLEMENT_SKU_TYPES,
  commandStatus,
  desiredCommandNames,
  discoverMappingsFromData,
  discoverRankMappings,
  exactRankMatch,
  fetchApplicationSkus,
  rankOfferingMatch,
  roleRows,
  skuRows
};
