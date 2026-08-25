'use strict';

const { ChannelType } = require('discord.js');
const { MODULES } = require('../backend/modules/catalog.cjs');
const { layoutFor } = require('./module-layouts.cjs');

const DEFAULT_BOUNDARY_NAMES = Object.freeze(['hidden server', 'staff']);

function normalizedCategoryName(value) {
  return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function categoryPosition(channel) {
  return Number.isFinite(Number(channel?.rawPosition)) ? Number(channel.rawPosition) : Number(channel?.position || 0);
}

function moduleCategoryEntries(channels) {
  const categories = [...channels.values()].filter((channel) => channel?.type === ChannelType.GuildCategory);
  const claimed = new Set();
  const result = [];
  for (const module of MODULES.filter((item) => item.console !== false)) {
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
  const categories = [...channels.values()].filter((channel) => channel?.type === ChannelType.GuildCategory);
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

async function reconcileGameCategoryOrder(guild, options = {}) {
  let channels = await guild.channels.fetch();
  let plan = categoryOrderPlan(channels, options.boundaryNames || DEFAULT_BOUNDARY_NAMES);
  if (!plan.boundary || !plan.modules.length) return { ok: false, skipped: true, moved: 0, renamed: 0, reason: plan.reason || 'No game module categories found.' };

  const names = await reconcileGameCategoryNames(guild, plan.modules);
  if (names.renamed) {
    channels = await guild.channels.fetch();
    plan = categoryOrderPlan(channels, options.boundaryNames || DEFAULT_BOUNDARY_NAMES);
  }

  const ordered = plan.modules.map((entry) => entry.label);
  if (categoryOrderIsCorrect(plan)) {
    return { ok: true, skipped: false, moved: 0, renamed: names.renamed, ordered, boundary: String(plan.boundary.name || '') };
  }

  let moved = 0;
  // Every move inserts immediately before the Staff/Hidden Server boundary. Insert
  // from Z -> A so the final visible order becomes A -> Z instead of reversing
  // the list and leaving ARK at the bottom of the game block.
  for (const entry of categoryMoveSequence(plan)) {
    const boundary = await guild.channels.fetch(String(plan.boundary.id)).catch(() => plan.boundary);
    const category = await guild.channels.fetch(String(entry.category.id)).catch(() => entry.category);
    if (!category || !boundary) continue;
    const targetPosition = Math.max(0, categoryPosition(boundary) - 1);
    await category.setPosition(targetPosition, { relative: false, reason: 'Nexus Sentinal: alphabetize game categories above Staff/Hidden Server' });
    moved += 1;
  }

  return { ok: true, skipped: false, moved, renamed: names.renamed, ordered, boundary: String(plan.boundary.name || '') };
}

module.exports = {
  DEFAULT_BOUNDARY_NAMES,
  normalizedCategoryName,
  categoryPosition,
  moduleCategoryEntries,
  categoryOrderPlan,
  categoryOrderIsCorrect,
  categoryMoveSequence,
  reconcileGameCategoryNames,
  reconcileGameCategoryOrder
};
