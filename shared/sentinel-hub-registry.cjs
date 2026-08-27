'use strict';

const { DEFAULT_LAYOUT, normalizeLayout } = require('./discord-automation.cjs');

const HUB_REGISTRY_SCHEMA_VERSION = 1;
const HUB_KINDS = new Set(['information', 'community', 'operations', 'staff', 'game', 'support']);
const HUB_AUDIENCES = new Set(['member', 'staff', 'administrator', 'owner']);

function cleanId(value, label = 'hub') {
  const id = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id)) throw new Error(`Invalid ${label} ID: ${value}`);
  return id;
}

function cleanText(value, max = 160, fallback = '') {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, max);
}

function normalizeHubDefinition(input = {}) {
  const id = cleanId(input.id);
  return Object.freeze({
    id,
    name: cleanText(input.name, 100, id),
    kind: HUB_KINDS.has(input.kind) ? input.kind : 'community',
    audience: HUB_AUDIENCES.has(input.audience) ? input.audience : 'member',
    categoryId: cleanId(input.categoryId, 'hub category'),
    channelId: cleanId(input.channelId, 'hub channel'),
    moduleId: cleanText(input.moduleId, 100, 'discord-runtime'),
    persistentMessageKey: cleanId(input.persistentMessageKey || `${id}-panel`, 'persistent message'),
    bannerKey: cleanText(input.bannerKey, 120),
    healthEnabled: Boolean(input.healthEnabled),
    enabled: input.enabled !== false
  });
}

const CORE_HUBS = Object.freeze([
  normalizeHubDefinition({
    id: 'about',
    name: 'About Khaos Nexus',
    kind: 'information',
    audience: 'member',
    categoryId: 'information',
    channelId: 'about',
    moduleId: 'discord-runtime',
    persistentMessageKey: 'community-about',
    bannerKey: 'information'
  }),
  normalizeHubDefinition({
    id: 'roles',
    name: 'Roles and Notifications',
    kind: 'information',
    audience: 'member',
    categoryId: 'information',
    channelId: 'roles',
    moduleId: 'discord-runtime',
    persistentMessageKey: 'role-menus',
    bannerKey: 'roles'
  }),
  normalizeHubDefinition({
    id: 'server-status',
    name: 'Game Server Status',
    kind: 'operations',
    audience: 'member',
    categoryId: 'operations',
    channelId: 'status',
    moduleId: 'game-server-control',
    persistentMessageKey: 'server-status',
    bannerKey: 'game-server-operations',
    healthEnabled: true
  }),
  normalizeHubDefinition({
    id: 'server-support',
    name: 'Game Server Support',
    kind: 'support',
    audience: 'member',
    categoryId: 'operations',
    channelId: 'support',
    moduleId: 'game-server-control',
    persistentMessageKey: 'server-support',
    bannerKey: 'game-server-operations'
  })
]);

function layoutBlueprintIndex(layoutInput = DEFAULT_LAYOUT) {
  const layout = normalizeLayout(layoutInput);
  const categories = new Map();
  for (const category of layout.categories) {
    const channels = new Map(category.channels.map((channel) => [channel.id, channel]));
    categories.set(category.id, { category, channels });
  }
  return { layout, categories };
}

function createHubRegistry({ layout = DEFAULT_LAYOUT, hubs = CORE_HUBS, strict = true } = {}) {
  const { layout: normalizedLayout, categories } = layoutBlueprintIndex(layout);
  const normalized = [];
  const seen = new Set();

  for (const source of Array.isArray(hubs) ? hubs : []) {
    const hub = normalizeHubDefinition(source);
    if (seen.has(hub.id)) throw new Error(`Duplicate Sentinel hub ID: ${hub.id}`);
    seen.add(hub.id);

    const category = categories.get(hub.categoryId);
    const channel = category?.channels.get(hub.channelId);
    if (strict && !category) throw new Error(`Sentinel hub ${hub.id} references missing layout category ${hub.categoryId}.`);
    if (strict && !channel) throw new Error(`Sentinel hub ${hub.id} references missing layout channel ${hub.categoryId}/${hub.channelId}.`);

    normalized.push(Object.freeze({
      ...hub,
      blueprint: Object.freeze({
        categoryName: category?.category?.name || '',
        channelName: channel?.name || '',
        channelType: channel?.type || ''
      })
    }));
  }

  const all = Object.freeze(normalized);
  return Object.freeze({
    schemaVersion: HUB_REGISTRY_SCHEMA_VERSION,
    layoutId: normalizedLayout.id,
    hubs: all,
    get(id) {
      const key = String(id || '').trim().toLowerCase();
      return all.find((hub) => hub.id === key) || null;
    },
    enabled() {
      return all.filter((hub) => hub.enabled);
    },
    forModule(moduleId) {
      const key = String(moduleId || '').trim();
      return all.filter((hub) => hub.enabled && hub.moduleId === key);
    },
    withHealth() {
      return all.filter((hub) => hub.enabled && hub.healthEnabled);
    }
  });
}

const DEFAULT_HUB_REGISTRY = createHubRegistry();

module.exports = {
  HUB_REGISTRY_SCHEMA_VERSION,
  HUB_KINDS,
  HUB_AUDIENCES,
  CORE_HUBS,
  normalizeHubDefinition,
  layoutBlueprintIndex,
  createHubRegistry,
  DEFAULT_HUB_REGISTRY
};
