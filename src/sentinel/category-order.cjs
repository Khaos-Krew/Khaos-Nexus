'use strict';

const { ChannelType, OverwriteType, PermissionFlagsBits } = require('discord.js');
const { MODULES } = require('../backend/modules/catalog.cjs');
const { layoutFor } = require('./module-layouts.cjs');
const {
  gameCategoryOrderIds,
  isStaffCategoryName,
  isVoiceCategoryName,
  respectsManualLayout
} = require('./manual-layout.cjs');
const { applyManagedOverwrites, existingOverwriteEntries, refusePermissionStaffFallback } = require('./staff-workspace.cjs');

const DEFAULT_BOUNDARY_NAMES = Object.freeze(['hidden server', 'staff']);
const STRUCTURAL_CATEGORY_ALIASES = Object.freeze({
  information: Object.freeze(['information', 'info', 'start here']),
  nexusHq: Object.freeze(['nexus hq', 'nexus headquarters', 'community hq']),
  supporterHub: Object.freeze(['supporter hub', 'supporters hub', 'supporter lounge', 'supporters']),
  staff: Object.freeze(['staff', 'staff operations']),
  nexusPrivate: Object.freeze(['khaos nexus', 'nexus private', 'khaos nexus private', 'nexus operations']),
  privateReports: Object.freeze(['private reports', 'safety reports', 'reports']),
  ownerOnly: Object.freeze(['hidden server', 'hidden server chat', 'owner only', 'owner-only', 'private server chat'])
});

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function normalizedCategoryName(value) {
  return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter((value) => /^\d{15,24}$/.test(value)))];
}

function permissionMask(values = []) {
  return (Array.isArray(values) ? values : []).reduce((mask, value) => mask | BigInt(value), 0n);
}

function overwriteMask(value) {
  if (typeof value === 'bigint') return value;
  if (value?.bitfield !== undefined) return BigInt(value.bitfield);
  if (value === undefined || value === null) return 0n;
  return BigInt(value);
}

function normalizedOverwritePlan(entries = []) {
  const byTarget = new Map();
  for (const entry of entries) {
    const id = String(entry?.id || '');
    if (!id) continue;
    const type = Number(entry?.type ?? OverwriteType.Role);
    const key = `${type}:${id}`;
    const current = byTarget.get(key) || { id, type, allow: 0n, deny: 0n };
    current.allow |= permissionMask(entry.allow || []);
    current.deny |= permissionMask(entry.deny || []);
    current.allow &= ~current.deny;
    byTarget.set(key, current);
  }
  return [...byTarget.values()].sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`));
}

function overwriteSetMatches(channel, desiredEntries = []) {
  const cache = channel?.permissionOverwrites?.cache;
  if (!cache || typeof cache.values !== 'function') return false;
  const actual = valuesOf(cache).map((entry) => ({
    id: String(entry?.id || ''),
    type: Number(entry?.type ?? OverwriteType.Role),
    allow: overwriteMask(entry?.allow),
    deny: overwriteMask(entry?.deny)
  })).sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`));
  const desired = normalizedOverwritePlan(desiredEntries);
  if (actual.length !== desired.length) return false;
  return actual.every((entry, index) => {
    const wanted = desired[index];
    return entry.id === wanted.id && entry.type === wanted.type && entry.allow === wanted.allow && entry.deny === wanted.deny;
  });
}

function categoryPosition(channel) {
  return Number.isFinite(Number(channel?.rawPosition)) ? Number(channel.rawPosition) : Number(channel?.position || 0);
}

function categoriesFrom(channels) {
  return valuesOf(channels).filter((channel) => channel?.type === ChannelType.GuildCategory);
}

function findCategoryByAliases(channels, aliases = []) {
  const wanted = new Set((aliases || []).map(normalizedCategoryName).filter(Boolean));
  return categoriesFrom(channels).find((category) => wanted.has(normalizedCategoryName(category.name))) || null;
}

function structuralCategories(channels) {
  return {
    information: findCategoryByAliases(channels, STRUCTURAL_CATEGORY_ALIASES.information),
    nexusHq: findCategoryByAliases(channels, STRUCTURAL_CATEGORY_ALIASES.nexusHq),
    supporterHub: findCategoryByAliases(channels, STRUCTURAL_CATEGORY_ALIASES.supporterHub),
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
  return sortGameCategoryEntries(result);
}

function compareGameLabels(left, right) {
  return String(left?.label || '').localeCompare(String(right?.label || ''), 'en', { sensitivity: 'base', numeric: true });
}

function sortGameCategoryEntries(entries = [], priorityIds = null) {
  const priority = new Map((priorityIds || []).map((id, index) => [String(id), index]));
  const ranked = priority.size > 0;
  return [...entries].sort((left, right) => {
    if (ranked) {
      const leftRank = priority.has(left.moduleId) ? priority.get(left.moduleId) : Number.MAX_SAFE_INTEGER;
      const rightRank = priority.has(right.moduleId) ? priority.get(right.moduleId) : Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
    }
    return compareGameLabels(left, right);
  });
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
  if (structural.nexusHq) entries.push({ kind: 'nexus-hq', label: 'NEXUS HQ', category: structural.nexusHq });
  if (structural.supporterHub) entries.push({ kind: 'supporter-hub', label: 'SUPPORTER HUB', category: structural.supporterHub });
  for (const module of modules) entries.push({ kind: 'game', label: module.label, moduleId: module.moduleId, category: module.category });
  const voice = findCategoryByAliases(channels, ['voice']);
  // VOICE is explicit so a position batch cannot leave it out. An omitted
  // category is what Discord shifts to position 0 (the top of the list).
  if (voice) entries.push({ kind: 'voice', label: 'VOICE', category: voice });
  if (structural.staff) entries.push({ kind: 'staff', label: 'STAFF', category: structural.staff });
  if (structural.nexusPrivate) entries.push({ kind: 'nexus-private', label: 'KHAOS NEXUS', category: structural.nexusPrivate });
  if (structural.privateReports) entries.push({ kind: 'private-reports', label: 'PRIVATE REPORTS', category: structural.privateReports });
  if (structural.ownerOnly) entries.push({ kind: 'owner-only', label: 'HIDDEN SERVER', category: structural.ownerOnly });
  return { structural, modules, entries };
}

function compareCategoryPosition(left, right) {
  const delta = categoryPosition(left) - categoryPosition(right);
  if (delta) return delta;
  return String(left?.id || '').localeCompare(String(right?.id || ''));
}

function moveVoiceImmediatelyAboveStaff(categories) {
  const voiceIndex = categories.findIndex((category) => isVoiceCategoryName(category?.name));
  const staffIndex = categories.findIndex((category) => isStaffCategoryName(category?.name));
  if (voiceIndex < 0 || staffIndex < 0 || voiceIndex === staffIndex - 1) return categories;
  const voice = categories[voiceIndex];
  const withoutVoice = categories.filter((_, index) => index !== voiceIndex);
  const insertAt = withoutVoice.findIndex((category) => isStaffCategoryName(category?.name));
  if (insertAt < 0) return categories;
  withoutVoice.splice(insertAt, 0, voice);
  return withoutVoice;
}

// Game categories trade places inside the slots they already occupy. Every
// other category, including VOICE, stays put until VOICE is slid to sit
// directly above STAFF. The returned list contains every category so the
// position update cannot omit one and drop it at the top.
function arrangeCategories(categories, orderedGameCategories = []) {
  const sorted = [...categories].sort(compareCategoryPosition);
  const gameIds = new Set(orderedGameCategories.map((category) => String(category?.id || '')));
  const ordered = orderedGameCategories.filter((category) => sorted.some((item) => String(item.id) === String(category?.id || '')));
  let cursor = 0;
  const slotted = sorted.map((category) => {
    if (!gameIds.has(String(category.id))) return category;
    const next = ordered[cursor];
    cursor += 1;
    return next || category;
  });
  return moveVoiceImmediatelyAboveStaff(slotted);
}

function sameCategoryOrder(left = [], right = []) {
  if (left.length !== right.length) return false;
  return left.every((category, index) => String(category?.id || '') === String(right[index]?.id || ''));
}

async function applyCategoryPositions(guild, categories, reason) {
  const updates = categories.map((category, index) => ({ channel: String(category.id), position: index }));
  if (!updates.length) return 0;
  if (typeof guild.channels?.setPositions === 'function') {
    await guild.channels.setPositions(updates, reason);
    return updates.length;
  }
  let moved = 0;
  for (let index = 0; index < categories.length; index += 1) {
    const category = categories[index];
    if (typeof category?.setPosition !== 'function') continue;
    await category.setPosition(index, { relative: false, reason });
    moved += 1;
  }
  return moved;
}

function hierarchyLabels(entries, orderedModules, configured) {
  if (!configured) return entries.map((entry) => entry.label);
  const labels = [];
  let gamesInserted = false;
  const games = orderedModules.map((module) => module.label);
  const hasVoice = entries.some((entry) => entry.kind === 'voice');
  for (const entry of entries) {
    if (entry.kind === 'game' || entry.kind === 'voice') continue;
    if (!gamesInserted && (entry.kind === 'staff' || entry.kind === 'nexus-private' || entry.kind === 'private-reports' || entry.kind === 'owner-only')) {
      labels.push(...games);
      if (hasVoice) labels.push('VOICE');
      gamesInserted = true;
    }
    labels.push(entry.label);
  }
  if (!gamesInserted) {
    labels.push(...games);
    if (hasVoice) labels.push('VOICE');
  }
  return labels;
}

function serverCategoryOrderIsCorrect(plan) {
  if (!plan?.entries?.length) return false;
  const actual = [...plan.entries].sort((left, right) => categoryPosition(left.category) - categoryPosition(right.category));
  return actual.length === plan.entries.length && actual.every((entry, index) => String(entry.category.id) === String(plan.entries[index].category.id));
}

function categoryPositionUpdates(plan) {
  return (plan?.entries || []).map((entry, index) => ({ channel: String(entry.category.id), position: index }));
}

function snapshotOrCache(snapshot, manager) {
  if (snapshot) return snapshot;
  const cache = manager?.cache;
  return cache && Number(cache.size || 0) > 0 ? cache : null;
}

async function reconcileGameCategoryNames(guild, entries = null, channelsSnapshot = null) {
  const channels = channelsSnapshot || snapshotOrCache(null, guild.channels) || await guild.channels.fetch();
  const managed = entries || moduleCategoryEntries(channels);
  let renamed = 0;
  for (const entry of managed) {
    const desired = String(entry.displayName || entry.label || '').trim();
    if (!desired || String(entry.category?.name || '') === desired) continue;
    const category = entry.category;
    if (!category || category.type !== ChannelType.GuildCategory || typeof category.setName !== 'function') continue;
    await category.setName(desired, 'Nexus Sentinal: apply game category display style');
    renamed += 1;
  }
  return { renamed };
}

async function resolveAdminRoleIds(guild, config = {}, rolesSnapshot = null) {
  const roles = rolesSnapshot || snapshotOrCache(null, guild.roles) || await guild.roles.fetch();
  const explicit = normalizeIds(config.discord?.operatorRoleIds || []).filter((id) => {
    const role = roles.get(id);
    return Boolean(role && role.id !== guild.id && role.managed !== true);
  });
  if (explicit.length) return explicit;
  return refusePermissionStaffFallback('category order', guild?.id);
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

async function applyOverwriteSet(channel, desiredEntries, reason) {
  return applyManagedOverwrites(channel, desiredEntries, reason);
}

async function lockCategoryChildren(category, channels, reason) {
  if (!category) return 0;
  const parentOverwrites = existingOverwriteEntries(category);
  let locked = 0;
  for (const channel of valuesOf(channels)) {
    if (String(channel?.parentId || '') !== String(category.id)) continue;
    if (channel.permissionsLocked === true) continue;
    if (await applyManagedOverwrites(channel, parentOverwrites, reason)) locked += 1;
  }
  return locked;
}

async function reconcileStructuralPrivacy(guild, options = {}, structural = null, channelsSnapshot = null, rolesSnapshot = null) {
  const channels = channelsSnapshot || snapshotOrCache(null, guild.channels) || await guild.channels.fetch();
  const categories = structural || structuralCategories(channels);
  const config = options.config || {};
  const botId = String(options.botId || '');
  const ownerIds = normalizeIds([...(config.discord?.ownerUserIds || []), guild.ownerId]);
  let nexusUpdated = false;
  let ownerUpdated = false;
  let childrenLocked = 0;

  if (categories.nexusPrivate?.permissionOverwrites?.set) {
    const roles = rolesSnapshot || snapshotOrCache(null, guild.roles) || await guild.roles.fetch();
    const adminRoleIds = await resolveAdminRoleIds(guild, config, roles);
    nexusUpdated = await applyOverwriteSet(
      categories.nexusPrivate,
      staffAdminOverwrites(guild, botId, adminRoleIds, ownerIds),
      'Nexus Sentinal: Khaos Nexus category is Staff Admin+ only'
    );
    childrenLocked += await lockCategoryChildren(
      categories.nexusPrivate,
      channels,
      'Nexus Sentinal: inherit Staff Admin+ Khaos Nexus privacy'
    );
  }

  if (categories.ownerOnly?.permissionOverwrites?.set) {
    ownerUpdated = await applyOverwriteSet(
      categories.ownerOnly,
      ownerOnlyOverwrites(guild, botId),
      'Nexus Sentinal: Hidden Server category is owner-only'
    );
    childrenLocked += await lockCategoryChildren(
      categories.ownerOnly,
      channels,
      'Nexus Sentinal: inherit owner-only Hidden Server privacy'
    );
  }

  return { nexusUpdated, ownerUpdated, childrenLocked };
}

async function reconcileServerCategoryOrder(guild, options = {}) {
  let channels = options.channelsSnapshot || snapshotOrCache(null, guild.channels) || await guild.channels.fetch();
  const roles = options.rolesSnapshot || snapshotOrCache(null, guild.roles) || null;
  let plan = serverCategoryOrderPlan(channels);
  if (!plan.modules.length) return { ok: false, skipped: true, moved: 0, renamed: 0, reason: 'No game module categories found.' };

  const names = await reconcileGameCategoryNames(guild, plan.modules, channels);
  if (names.renamed) plan = serverCategoryOrderPlan(channels);

  const privacy = await reconcileStructuralPrivacy(guild, options, plan.structural, channels, roles);
  const configuredIds = gameCategoryOrderIds(options.config || {}, guild?.id);
  const preserveOrder = !configuredIds && (options.preserveCategoryOrder === true || respectsManualLayout(options.config || {}, guild?.id));
  let moved = 0;
  let orderedModules = plan.modules;

  if (configuredIds || preserveOrder) {
    const categories = categoriesFrom(channels);
    orderedModules = configuredIds
      ? sortGameCategoryEntries(plan.modules, configuredIds)
      : [...plan.modules].sort((left, right) => compareCategoryPosition(left.category, right.category));
    const sequence = arrangeCategories(categories, orderedModules.map((entry) => entry.category));
    const current = [...categories].sort(compareCategoryPosition);
    if (!sameCategoryOrder(sequence, current)) {
      moved = await applyCategoryPositions(
        guild,
        sequence,
        configuredIds
          ? 'Nexus Sentinal: apply configured game category order'
          : 'Nexus Sentinal: keep VOICE directly above STAFF'
      );
    }
  } else if (!serverCategoryOrderIsCorrect(plan)) {
    const updates = categoryPositionUpdates(plan);
    if (updates.length && typeof guild.channels?.setPositions === 'function') {
      await guild.channels.setPositions(updates, 'Nexus Sentinal: enforce canonical server category hierarchy');
      moved = updates.length;
    } else {
      for (let index = 0; index < plan.entries.length; index += 1) {
        const category = plan.entries[index]?.category;
        if (!category || typeof category.setPosition !== 'function') continue;
        await category.setPosition(index, { relative: false, reason: 'Nexus Sentinal: enforce canonical server category hierarchy' });
        moved += 1;
      }
    }
  }

  const missing = Object.entries(plan.structural).filter(([, value]) => !value).map(([key]) => key);
  const hierarchy = hierarchyLabels(plan.entries, orderedModules, Boolean(configuredIds));
  return {
    ok: true,
    skipped: false,
    moved,
    renamed: names.renamed,
    orderPreserved: preserveOrder,
    orderMode: configuredIds ? 'configured' : (preserveOrder ? 'preserved' : 'alphabetical'),
    ordered: orderedModules.map((entry) => entry.label),
    hierarchy: hierarchy.length ? hierarchy : plan.entries.map((entry) => entry.label),
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
  valuesOf,
  normalizedCategoryName,
  normalizeIds,
  permissionMask,
  overwriteMask,
  normalizedOverwritePlan,
  overwriteSetMatches,
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
  sortGameCategoryEntries,
  arrangeCategories,
  moveVoiceImmediatelyAboveStaff,
  sameCategoryOrder,
  applyCategoryPositions,
  categoryPositionUpdates,
  snapshotOrCache,
  reconcileGameCategoryNames,
  resolveAdminRoleIds,
  staffAdminOverwrites,
  ownerOnlyOverwrites,
  applyOverwriteSet,
  lockCategoryChildren,
  reconcileStructuralPrivacy,
  reconcileServerCategoryOrder,
  reconcileGameCategoryOrder
};