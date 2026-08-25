'use strict';

const { ChannelType, OverwriteType, PermissionFlagsBits } = require('discord.js');
const { MODULES } = require('../backend/modules/catalog.cjs');
const { layoutFor } = require('./module-layouts.cjs');

const DEFAULT_BOUNDARY_NAMES = Object.freeze(['hidden server', 'staff']);
const STRUCTURAL_CATEGORY_ALIASES = Object.freeze({
  information: Object.freeze(['information', 'info']),
  staff: Object.freeze(['staff', 'staff operations']),
  nexusPrivate: Object.freeze(['khaos nexus', 'nexus private', 'khaos nexus private', 'nexus operations']),
  privateReports: Object.freeze(['private reports', 'safety reports', 'reports']),
  ownerOnly: Object.freeze(['hidden server', 'hidden server chat', 'owner only', 'owner-only', 'private server chat'])
});

function normalizedCategoryName(value) {
  return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter((value) => /^\d{15,24}$/.test(value)))];
}

function categoryPosition(channel) {
  return Number.isFinite(Number(channel?.rawPosition)) ? Number(channel.rawPosition) : Number(channel?.position || 0);
}

function categoriesFrom(channels) {
  return [...channels.values()].filter((channel) => channel?.type === ChannelType.GuildCategory);
}

function findCategoryByAliases(channels, aliases = []) {
  const wanted = new Set((aliases || []).map(normalizedCategoryName).filter(Boolean));
  return categoriesFrom(channels).find((category) => wanted.has(normalizedCategoryName(category.name))) || null;
}

function structuralCategories(channels) {
  return {
    information: findCategoryByAliases(channels, STRUCTURAL_CATEGORY_ALIASES.information),
    staff: findCategoryByAliases(channels, STRUCTURAL_CATEGORY_ALIASES.staff),
    nexusPrivate: findCategoryByAliases(channels, STRUCTURAL_CATEGORY_ALIASES.nexusPrivate),
    privateReports: findCategoryByAliases(channels, STRUCTURAL_CATEGORY_ALIASES.privateReports),
    ownerOnly: findCategoryByAliases(channels, STRUCTURAL_CATEGORY_ALIASES.ownerOnly)
  };
}

function moduleCategoryEntries(channels) {
  const categories = categoriesFrom(channels);
  const claimed = new Set();
  const result = [];
  for (const module of MODULES) {
    let layout;
    try { layout = layoutFor(module.id); } catch { continue; }
    const names = new Set([layout.categoryDisplay, layout.category, module.name, ...(layout.aliases || [])].map(normalizedCategoryName).filter(Boolean));
    const category = categories.find((candidate) => !claimed.has(String(candidate.id)) && names.has(normalizedCategoryName(candidate.name)));
    if (!category) continue;
    claimed.add(String(category.id));
    result.push({
      moduleId: module.id,
      label: layout.category || module.name,
      displayName: layout.categoryDisplay || layout.category || module.name,
      category
    });
  }
  return result.sort((left, right) => left.label.localeCompare(right.label, 'en', { sensitivity: 'base', numeric: true }));
}

function categoryOrderPlan(channels, boundaryNames = DEFAULT_BOUNDARY_NAMES) {
  const categories = categoriesFrom(channels);
  const wantedBoundaries = new Set(boundaryNames.map(normalizedCategoryName));
  const boundaries = categories.filter((category) => wantedBoundaries.has(normalizedCategoryName(category.name))).sort((a, b) => categoryPosition(a) - categoryPosition(b));
  if (!boundaries.length) return { boundary: null, modules: [], reason: 'Staff/hidden-server category boundary was not found.' };
  return { boundary: boundaries[0], modules: moduleCategoryEntries(channels), reason: '' };
}

function categoryOrderIsCorrect(plan) {
  if (!plan?.boundary || !plan.modules?.length) return false;
  const boundaryPosition = categoryPosition(plan.boundary);
  if (!plan.modules.every((entry) => categoryPosition(entry.category) < boundaryPosition)) return false;
  const actual = [...plan.modules].sort((left, right) => categoryPosition(left.category) - categoryPosition(right.category)).map((entry) => entry.moduleId);
  const desired = plan.modules.map((entry) => entry.moduleId);
  return actual.length === desired.length && actual.every((moduleId, index) => moduleId === desired[index]);
}

function categoryMoveSequence(plan) {
  return [...(plan?.modules || [])].reverse();
}

function serverCategoryOrderPlan(channels) {
  const structural = structuralCategories(channels);
  const modules = moduleCategoryEntries(channels);
  const entries = [];
  if (structural.information) entries.push({ kind: 'information', label: 'INFORMATION', category: structural.information });
  for (const module of modules) entries.push({ kind: 'game', label: module.label, moduleId: module.moduleId, category: module.category });
  if (structural.staff) entries.push({ kind: 'staff', label: 'STAFF', category: structural.staff });
  if (structural.nexusPrivate) entries.push({ kind: 'nexus-private', label: 'KHAOS NEXUS', category: structural.nexusPrivate });
  if (structural.privateReports) entries.push({ kind: 'private-reports', label: 'PRIVATE REPORTS', category: structural.privateReports });
  if (structural.ownerOnly) entries.push({ kind: 'owner-only', label: 'HIDDEN SERVER', category: structural.ownerOnly });
  return { structural, modules, entries };
}

function serverCategoryOrderIsCorrect(plan) {
  if (!plan?.entries?.length) return false;
  const actual = [...plan.entries].sort((left, right) => categoryPosition(left.category) - categoryPosition(right.category));
  return actual.length === plan.entries.length && actual.every((entry, index) => String(entry.category.id) === String(plan.entries[index].category.id));
}

async function reconcileGameCategoryNames(guild, entries = null) {
  const channels = await guild.channels.fetch();
  const managed = entries || moduleCategoryEntries(channels);
  let renamed = 0;
  for (const entry of managed) {
    const desired = String(entry.displayName || entry.label || '').trim();
    if (!desired || String(entry.category?.name || '') === desired) continue;
    const category = await guild.channels.fetch(String(entry.category.id)).catch(() => entry.category);
    if (!category || category.type !== ChannelType.GuildCategory || typeof category.setName !== 'function') continue;
    await category.setName(desired, 'Nexus Sentinal: apply game category display style');
    renamed += 1;
  }
  return { renamed };
}

async function resolveAdminRoleIds(guild, config = {}) {
  const roles = await guild.roles.fetch();
  const explicit = normalizeIds(config.discord?.operatorRoleIds || []).filter((id) => {
    const role = roles.get(id);
    return Boolean(role && role.id !== guild.id && role.managed !== true);
  });
  if (explicit.length) return explicit;
  return [...roles.values()]
    .filter((role) => role && role.id !== guild.id && role.managed !== true)
    .filter((role) => role.permissions?.has?.(PermissionFlagsBits.Administrator)
      || role.permissions?.has?.(PermissionFlagsBits.ManageGuild))
    .map((role) => String(role.id));
}

function staffAdminOverwrites(guild, botId, adminRoleIds = [], ownerIds = []) {
  const allow = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.SendMessagesInThreads,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak
  ];
  return [
    { id: String(guild.id), type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    ...normalizeIds(adminRoleIds).map((id) => ({ id, type: OverwriteType.Role, allow })),
    ...normalizeIds(ownerIds).map((id) => ({ id, type: OverwriteType.Member, allow })),
    ...(botId ? [{ id: String(botId), type: OverwriteType.Member, allow: [...allow, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] }] : [])
  ];
}

function ownerOnlyOverwrites(guild, botId) {
  const allow = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.SendMessagesInThreads,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak
  ];
  const ownerId = String(guild.ownerId || '');
  return [
    { id: String(guild.id), type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    ...(ownerId ? [{ id: ownerId, type: OverwriteType.Member, allow }] : []),
    ...(botId ? [{ id: String(botId), type: OverwriteType.Member, allow: [...allow, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] }] : [])
  ];
}

async function lockCategoryChildren(guild, category, reason) {
  if (!category) return 0;
  const channels = await guild.channels.fetch();
  let locked = 0;
  for (const channel of channels.values()) {
    if (String(channel?.parentId || '') !== String(category.id)) continue;
    if (typeof channel.lockPermissions !== 'function') continue;
    await channel.lockPermissions(reason).catch(() => {});
    locked += 1;
  }
  return locked;
}

async function reconcileStructuralPrivacy(guild, options = {}, structural = null) {
  const channels = await guild.channels.fetch();
  const categories = structural || structuralCategories(channels);
  const config = options.config || {};
  const botId = String(options.botId || '');
  const ownerIds = normalizeIds([...(config.discord?.ownerUserIds || []), guild.ownerId]);
  let nexusUpdated = false;
  let ownerUpdated = false;
  let childrenLocked = 0;

  if (categories.nexusPrivate?.permissionOverwrites?.set) {
    const adminRoleIds = await resolveAdminRoleIds(guild, config);
    await categories.nexusPrivate.permissionOverwrites.set(
      staffAdminOverwrites(guild, botId, adminRoleIds, ownerIds),
      'Nexus Sentinal: Khaos Nexus category is Staff Admin+ only'
    );
    childrenLocked += await lockCategoryChildren(guild, categories.nexusPrivate, 'Nexus Sentinal: inherit Staff Admin+ Khaos Nexus privacy');
    nexusUpdated = true;
  }

  if (categories.ownerOnly?.permissionOverwrites?.set) {
    await categories.ownerOnly.permissionOverwrites.set(
      ownerOnlyOverwrites(guild, botId),
      'Nexus Sentinal: Hidden Server category is owner-only'
    );
    childrenLocked += await lockCategoryChildren(guild, categories.ownerOnly, 'Nexus Sentinal: inherit owner-only Hidden Server privacy');
    ownerUpdated = true;
  }

  return { nexusUpdated, ownerUpdated, childrenLocked };
}

async function reconcileServerCategoryOrder(guild, options = {}) {
  let channels = await guild.channels.fetch();
  let plan = serverCategoryOrderPlan(channels);
  if (!plan.modules.length) return { ok: false, skipped: true, moved: 0, renamed: 0, reason: 'No game module categories found.' };

  const names = await reconcileGameCategoryNames(guild, plan.modules);
  if (names.renamed) {
    channels = await guild.channels.fetch();
    plan = serverCategoryOrderPlan(channels);
  }

  const privacy = await reconcileStructuralPrivacy(guild, options, plan.structural);
  const desired = plan.entries.map((entry) => entry.label);
  let moved = 0;

  if (!serverCategoryOrderIsCorrect(plan)) {
    for (let index = 0; index < plan.entries.length; index += 1) {
      const entry = plan.entries[index];
      const category = await guild.channels.fetch(String(entry.category.id)).catch(() => entry.category);
      if (!category || typeof category.setPosition !== 'function') continue;
      await category.setPosition(index, { relative: false, reason: 'Nexus Sentinal: enforce canonical server category hierarchy' });
      moved += 1;
    }
  }

  const missing = Object.entries(plan.structural).filter(([, value]) => !value).map(([key]) => key);
  return {
    ok: true,
    skipped: false,
    moved,
    renamed: names.renamed,
    ordered: plan.modules.map((entry) => entry.label),
    hierarchy: desired,
    missing,
    boundary: String(plan.structural.staff?.name || ''),
    privacy
  };
}

async function reconcileGameCategoryOrder(guild, options = {}) {
  return reconcileServerCategoryOrder(guild, options);
}

module.exports = {
  DEFAULT_BOUNDARY_NAMES,
  STRUCTURAL_CATEGORY_ALIASES,
  normalizedCategoryName,
  normalizeIds,
  categoryPosition,
  categoriesFrom,
  findCategoryByAliases,
  structuralCategories,
  moduleCategoryEntries,
  categoryOrderPlan,
  categoryOrderIsCorrect,
  categoryMoveSequence,
  serverCategoryOrderPlan,
  serverCategoryOrderIsCorrect,
  reconcileGameCategoryNames,
  resolveAdminRoleIds,
  staffAdminOverwrites,
  ownerOnlyOverwrites,
  lockCategoryChildren,
  reconcileStructuralPrivacy,
  reconcileServerCategoryOrder,
  reconcileGameCategoryOrder
};
