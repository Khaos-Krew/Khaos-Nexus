'use strict';

const crypto = require('node:crypto');

const MAX_ROLE_MENUS = 40;
const MAX_ROLE_OPTIONS = 25;
const MAX_LAYOUTS = 20;
const MAX_AUDIT_ENTRIES = 1000;
const BUTTON_STYLES = Object.freeze({ primary: 1, secondary: 2, success: 3, danger: 4 });
const CHANNEL_TYPES = Object.freeze({ text: 0, voice: 2, category: 4, announcement: 5 });

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function cleanText(value, max, fallback = '') {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, max);
}
function normalizeId(value, prefix) {
  const raw = String(value || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(raw) ? raw : `${prefix}-${crypto.randomUUID()}`;
}
function snowflake(value) {
  const raw = String(value || '').trim();
  return /^\d{5,25}$/.test(raw) ? raw : '';
}
function hexColor(value, fallback = '#e3264f') {
  const raw = String(value || '').trim();
  const normalized = raw.startsWith('#') ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toLowerCase() : fallback;
}
function safeEmoji(value) { return cleanText(value, 32); }
function buttonId(menuId, optionId) {
  const id = `kn-role:${normalizeId(menuId, 'menu')}:${normalizeId(optionId, 'option')}`;
  if (id.length > 100) throw new Error('Role menu button identifier is too long.');
  return id;
}
function parseButtonId(value) {
  const match = /^kn-role:([A-Za-z0-9_-]{1,80}):([A-Za-z0-9_-]{1,80})$/.exec(String(value || ''));
  return match ? { menuId: match[1], optionId: match[2] } : null;
}
function normalizeRoleOption(option = {}, kind = 'roles') {
  const label = cleanText(option.label, 80);
  const roleId = snowflake(option.roleId);
  if (!label || !roleId) return null;
  return {
    id: normalizeId(option.id, 'option'),
    label,
    roleId,
    description: cleanText(option.description, 100),
    emoji: safeEmoji(option.emoji),
    style: Object.prototype.hasOwnProperty.call(BUTTON_STYLES, option.style) ? option.style : 'secondary',
    ...(kind === 'colors' ? { color: hexColor(option.color || '#808080', '#808080') } : {})
  };
}
function normalizeRoleMenu(menu = {}) {
  const kind = menu.kind === 'colors' ? 'colors' : 'roles';
  const options = [];
  const seen = new Set();
  for (const source of Array.isArray(menu.options) ? menu.options : []) {
    const option = normalizeRoleOption(source, kind);
    if (!option || seen.has(option.id)) continue;
    seen.add(option.id);
    options.push(option);
  }
  return {
    id: normalizeId(menu.id, 'menu'),
    name: cleanText(menu.name, 80, kind === 'colors' ? 'Name Colors' : 'Role Menu'),
    kind,
    mode: kind === 'colors' || menu.mode === 'exclusive' ? 'exclusive' : 'toggle',
    title: cleanText(menu.title, 256, kind === 'colors' ? 'Choose Your Name Color' : 'Choose Your Roles'),
    description: cleanText(menu.description, 4000, 'Use the buttons below to update your roles.'),
    color: hexColor(menu.color),
    guildId: snowflake(menu.guildId),
    channelId: snowflake(menu.channelId),
    messageId: snowflake(menu.messageId),
    enabled: menu.enabled !== false,
    options: options.slice(0, MAX_ROLE_OPTIONS),
    publishedAt: menu.publishedAt ? String(menu.publishedAt) : null
  };
}
function renderRoleMenu(menuInput) {
  const menu = normalizeRoleMenu(menuInput);
  const rows = [];
  for (let index = 0; index < menu.options.length; index += 5) {
    rows.push({
      type: 1,
      components: menu.options.slice(index, index + 5).map((option) => ({
        type: 2,
        style: BUTTON_STYLES[option.style],
        label: option.label,
        custom_id: buttonId(menu.id, option.id),
        ...(option.emoji ? { emoji: { name: option.emoji } } : {})
      }))
    });
  }
  return {
    embeds: [{
      title: menu.title,
      description: menu.description,
      color: Number.parseInt(menu.color.slice(1), 16),
      footer: { text: menu.kind === 'colors' ? 'Khaos Nexus • One color at a time' : 'Khaos Nexus • Click again to remove a role' }
    }],
    components: rows,
    allowed_mentions: { parse: [] }
  };
}
function roleMutation(menuInput, optionId, currentRoles = []) {
  const menu = normalizeRoleMenu(menuInput);
  const option = menu.options.find((item) => item.id === optionId);
  if (!option) throw new Error('That role option is no longer configured.');
  const current = new Set((Array.isArray(currentRoles) ? currentRoles : []).map(String));
  const siblingRoles = menu.options.map((item) => item.roleId).filter((id) => id !== option.roleId);
  if (current.has(option.roleId)) {
    return { action: 'removed', addRoleId: '', removeRoleIds: menu.mode === 'exclusive' ? [option.roleId, ...siblingRoles.filter((id) => current.has(id))] : [option.roleId], option };
  }
  return {
    action: menu.mode === 'exclusive' && siblingRoles.some((id) => current.has(id)) ? 'replaced' : 'added',
    addRoleId: option.roleId,
    removeRoleIds: menu.mode === 'exclusive' ? siblingRoles.filter((id) => current.has(id)) : [],
    option
  };
}
function normalizeChannel(channel = {}) {
  const type = ['text', 'announcement', 'voice'].includes(channel.type) ? channel.type : 'text';
  return {
    id: normalizeId(channel.id, 'channel'),
    name: cleanText(channel.name, 100, type === 'voice' ? 'voice-chat' : 'new-channel').toLowerCase().replace(/\s+/g, '-'),
    type,
    topic: type === 'voice' ? '' : cleanText(channel.topic, 1024),
    nsfw: type === 'voice' ? false : Boolean(channel.nsfw),
    bitrate: type === 'voice' ? Math.min(384000, Math.max(8000, Number(channel.bitrate) || 64000)) : 0,
    userLimit: type === 'voice' ? Math.min(99, Math.max(0, Number(channel.userLimit) || 0)) : 0
  };
}
function normalizeCategory(category = {}) {
  const channels = [];
  const seen = new Set();
  for (const source of Array.isArray(category.channels) ? category.channels : []) {
    const channel = normalizeChannel(source);
    const key = `${channel.type}:${channel.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    channels.push(channel);
  }
  return {
    id: normalizeId(category.id, 'category'),
    name: cleanText(category.name, 100, 'NEW CATEGORY'),
    channels: channels.slice(0, 50)
  };
}
function normalizeLayout(layout = {}) {
  const categories = [];
  const seen = new Set();
  for (const source of Array.isArray(layout.categories) ? layout.categories : []) {
    const category = normalizeCategory(source);
    const key = category.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    categories.push(category);
  }
  return {
    id: normalizeId(layout.id, 'layout'),
    name: cleanText(layout.name, 80, 'Discord Server Layout'),
    description: cleanText(layout.description, 500, 'Additive category and channel layout managed by Khaos Nexus.'),
    guildId: snowflake(layout.guildId),
    enabled: layout.enabled !== false,
    categories: categories.slice(0, 30),
    lastAppliedAt: layout.lastAppliedAt ? String(layout.lastAppliedAt) : null
  };
}
const DEFAULT_LAYOUT = Object.freeze(normalizeLayout({
  id: 'default-nexus-layout',
  name: 'Khaos Nexus Community Layout',
  description: 'Safe additive baseline. Existing channels are never deleted.',
  categories: [
    { id: 'information', name: 'NEXUS INFORMATION', channels: [
      { id: 'welcome', name: 'welcome', type: 'text', topic: 'Welcome and getting-started information.' },
      { id: 'announcements', name: 'announcements', type: 'announcement', topic: 'Official Khaos Nexus announcements.' },
      { id: 'roles', name: 'roles-and-notifications', type: 'text', topic: 'Role menus, colors, platforms, games, and notifications.' }
    ] },
    { id: 'community', name: 'KHAOS COMMUNITY', channels: [
      { id: 'general', name: 'general', type: 'text', topic: 'Community conversation.' },
      { id: 'lfg', name: 'looking-for-group', type: 'text', topic: 'Find players and groups.' },
      { id: 'lounge', name: 'Nexus Lounge', type: 'voice', userLimit: 0 }
    ] },
    { id: 'operations', name: 'GAME SERVER OPERATIONS', channels: [
      { id: 'status', name: 'server-status', type: 'text', topic: 'Automated server status panels.' },
      { id: 'support', name: 'server-support', type: 'text', topic: 'Game server help and reports.' },
      { id: 'squad', name: 'Server Squad', type: 'voice', userLimit: 0 }
    ] }
  ]
}));
function channelTypeValue(type) { return CHANNEL_TYPES[type] ?? CHANNEL_TYPES.text; }
function planLayout(layoutInput, existingInput = []) {
  const layout = normalizeLayout(layoutInput);
  const existing = (Array.isArray(existingInput) ? existingInput : []).map((item) => ({
    id: String(item.id || ''),
    name: String(item.name || ''),
    type: typeof item.type === 'number' ? item.type : channelTypeValue(item.type),
    parentId: String(item.parentId || item.parent_id || '')
  }));
  const operations = [];
  for (const category of layout.categories) {
    const foundCategory = existing.find((item) => item.type === CHANNEL_TYPES.category && item.name.toLowerCase() === category.name.toLowerCase());
    const categoryRef = foundCategory?.id || `planned:${category.id}`;
    operations.push(foundCategory
      ? { action: 'unchanged', kind: 'category', name: category.name, existingId: foundCategory.id, ref: categoryRef }
      : { action: 'create', kind: 'category', name: category.name, blueprintId: category.id, ref: categoryRef });
    for (const channel of category.channels) {
      const type = channelTypeValue(channel.type);
      const foundChannel = existing.find((item) => item.type === type && item.name.toLowerCase() === channel.name.toLowerCase() && (!foundCategory || item.parentId === foundCategory.id));
      operations.push(foundChannel
        ? { action: 'unchanged', kind: channel.type, name: channel.name, existingId: foundChannel.id, parentRef: categoryRef }
        : { action: 'create', kind: channel.type, name: channel.name, blueprintId: channel.id, parentRef: categoryRef, settings: channel });
    }
  }
  return {
    layout,
    operations,
    createCount: operations.filter((item) => item.action === 'create').length,
    unchangedCount: operations.filter((item) => item.action === 'unchanged').length,
    destructiveCount: 0
  };
}
function normalizeAuditEntry(entry = {}) {
  return {
    id: normalizeId(entry.id, 'audit'),
    time: entry.time ? String(entry.time) : new Date().toISOString(),
    category: cleanText(entry.category, 40, 'discord-automation'),
    action: cleanText(entry.action, 100, 'unknown'),
    outcome: ['success', 'blocked', 'failed'].includes(entry.outcome) ? entry.outcome : 'success',
    actorId: snowflake(entry.actorId),
    actorName: cleanText(entry.actorName, 100, 'Local operator'),
    actorRole: ['owner', 'operator', 'viewer', 'local-admin'].includes(entry.actorRole) ? entry.actorRole : 'local-admin',
    targetType: cleanText(entry.targetType, 50),
    targetId: cleanText(entry.targetId, 100),
    targetName: cleanText(entry.targetName, 120),
    summary: cleanText(entry.summary, 500),
    details: entry.details && typeof entry.details === 'object' ? clone(entry.details) : {}
  };
}
function defaultDiscordAutomationConfig() {
  return {
    schemaVersion: 1,
    roleMenus: [],
    layouts: [clone(DEFAULT_LAYOUT)],
    audit: { publishToDiscord: false, channelId: '', retention: 500 },
    auditEntries: []
  };
}
function normalizeDiscordAutomationConfig(input = {}) {
  const roleMenus = [];
  const menuIds = new Set();
  for (const source of Array.isArray(input.roleMenus) ? input.roleMenus : []) {
    const item = normalizeRoleMenu(source);
    if (menuIds.has(item.id)) continue;
    menuIds.add(item.id); roleMenus.push(item);
  }
  const layouts = [];
  const layoutIds = new Set();
  for (const source of [DEFAULT_LAYOUT, ...(Array.isArray(input.layouts) ? input.layouts : [])]) {
    const item = normalizeLayout(source);
    const index = layouts.findIndex((entry) => entry.id === item.id);
    if (index >= 0) { if (source !== DEFAULT_LAYOUT) layouts[index] = item; continue; }
    if (layoutIds.has(item.id)) continue;
    layoutIds.add(item.id); layouts.push(item);
  }
  const retention = Math.min(MAX_AUDIT_ENTRIES, Math.max(50, Number(input.audit?.retention) || 500));
  return {
    schemaVersion: 1,
    roleMenus: roleMenus.slice(0, MAX_ROLE_MENUS),
    layouts: layouts.slice(0, MAX_LAYOUTS),
    audit: { publishToDiscord: Boolean(input.audit?.publishToDiscord), channelId: snowflake(input.audit?.channelId), retention },
    auditEntries: (Array.isArray(input.auditEntries) ? input.auditEntries : []).map(normalizeAuditEntry).slice(-retention)
  };
}

module.exports = {
  MAX_ROLE_MENUS, MAX_ROLE_OPTIONS, MAX_LAYOUTS, MAX_AUDIT_ENTRIES, BUTTON_STYLES, CHANNEL_TYPES,
  DEFAULT_LAYOUT, normalizeId, snowflake, hexColor, buttonId, parseButtonId, normalizeRoleOption,
  normalizeRoleMenu, renderRoleMenu, roleMutation, normalizeChannel, normalizeCategory, normalizeLayout,
  channelTypeValue, planLayout, normalizeAuditEntry, defaultDiscordAutomationConfig, normalizeDiscordAutomationConfig
};
