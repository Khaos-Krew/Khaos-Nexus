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
  for (const module of MODULES) {
    let layout;
    try { layout = layoutFor(module.id); } catch { continue; }
    const names = new Set([layout.category, module.name, ...(layout.aliases || [])].map(normalizedCategoryName).filter(Boolean));
    const category = categories.find((candidate) => !claimed.has(String(candidate.id)) && names.has(normalizedCategoryName(candidate.name)));
    if (!category) continue;
    claimed.add(String(category.id));
    result.push({ moduleId: module.id, label: layout.category || module.name, category });
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

async function reconcileGameCategoryOrder(guild, options = {}) {
  const channels = await guild.channels.fetch();
  const plan = categoryOrderPlan(channels, options.boundaryNames || DEFAULT_BOUNDARY_NAMES);
  if (!plan.boundary || !plan.modules.length) return { ok: false, skipped: true, moved: 0, reason: plan.reason || 'No game module categories found.' };

  let moved = 0;
  const ordered = [];
  for (const entry of plan.modules) {
    const boundary = await guild.channels.fetch(String(plan.boundary.id)).catch(() => plan.boundary);
    const category = await guild.channels.fetch(String(entry.category.id)).catch(() => entry.category);
    if (!category || !boundary) continue;
    const targetPosition = Math.max(0, categoryPosition(boundary) - 1);
    await category.setPosition(targetPosition, { relative: false, reason: 'Nexus Sentinal: alphabetize game categories above Staff/Hidden Server' });
    moved += 1;
    ordered.push(entry.label);
  }

  return { ok: true, skipped: false, moved, ordered, boundary: String(plan.boundary.name || '') };
}

module.exports = {
  DEFAULT_BOUNDARY_NAMES,
  normalizedCategoryName,
  categoryPosition,
  moduleCategoryEntries,
  categoryOrderPlan,
  reconcileGameCategoryOrder
};
