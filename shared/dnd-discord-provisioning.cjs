'use strict';

const crypto = require('node:crypto');

const PERMISSIONS = Object.freeze({
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MANAGE_ROLES: 1n << 28n
});

const DEFAULT_CAMPAIGN_CHANNEL_TEMPLATE = Object.freeze([
  { key: 'campaign-info', name: 'campaign-info', type: 'text', purpose: 'announcements', required: true, playerMode: 'read' },
  { key: 'table-chat', name: 'table-chat', type: 'text', purpose: 'main', required: true, playerMode: 'write' },
  { key: 'character-chat', name: 'character-chat', type: 'text', purpose: 'character_chat', required: false, playerMode: 'write' },
  { key: 'dice-rolls', name: 'dice-rolls', type: 'text', purpose: 'dice_log', required: false, playerMode: 'write' },
  { key: 'session-notes', name: 'session-notes', type: 'text', purpose: 'session_notes', required: false, playerMode: 'write' },
  { key: 'quests-and-loot', name: 'quests-and-loot', type: 'text', purpose: 'loot', required: false, playerMode: 'write' },
  { key: 'dm-private', name: 'dm-private', type: 'text', purpose: 'dm_private', required: false, playerMode: 'hidden' },
  { key: 'game-table', name: 'game-table', type: 'voice', purpose: 'voice', required: false, playerMode: 'voice' }
]);

const MAX_MEMBER_OVERWRITES = 50;

function clean(value, max = 100) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function channelName(value, fallback = 'campaign-channel') {
  const normalized = clean(value || fallback, 90)
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]+/g, '')
    .trim()
    .replace(/[ _]+/g, '-')
    .replace(/-+/g, '-');
  return normalized || fallback;
}

function categoryName(value) {
  return clean(value || 'D&D Campaign', 90) || 'D&D Campaign';
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeTemplate(input = [], campaign = {}) {
  const supplied = new Map((Array.isArray(input) ? input : []).map((item) => [String(item?.key || ''), item]));
  return DEFAULT_CAMPAIGN_CHANNEL_TEMPLATE.map((base) => {
    const override = supplied.get(base.key) || {};
    return {
      ...base,
      name: channelName(override.name || base.name, base.name),
      enabled: base.required ? true : override.enabled !== false
    };
  });
}

function normalizeProvisioningRecord(input = {}) {
  const resources = {};
  const resourceKeysById = new Map();
  const categoryId = clean(input.categoryId, 25);
  for (const [key, value] of Object.entries(input.resources || {})) {
    if (!value?.id) continue;
    const resourceId = clean(value.id, 25);
    if (!resourceId) continue;
    if (categoryId && resourceId === categoryId) {
      const error = new Error(`Discord resource ${resourceId} cannot be bound as both the campaign category and channel ${key}. Re-provision the stale binding.`);
      error.code = 'DND_PROVISIONING_RESOURCE_CONFLICT';
      throw error;
    }
    const existingKey = resourceKeysById.get(resourceId);
    if (existingKey && existingKey !== key) {
      const error = new Error(`Discord resource ${resourceId} is bound to both ${existingKey} and ${key}. Re-provision the stale binding.`);
      error.code = 'DND_PROVISIONING_RESOURCE_CONFLICT';
      throw error;
    }
    resourceKeysById.set(resourceId, key);
    resources[key] = {
      id: resourceId,
      name: channelName(value.name || key, key),
      type: value.type === 'voice' ? 'voice' : 'text',
      purpose: clean(value.purpose, 80)
    };
  }
  return {
    id: clean(input.id, 160) || `provisioning_${crypto.randomUUID()}`,
    campaignId: clean(input.campaignId, 100),
    appId: clean(input.appId, 100),
    guildId: clean(input.guildId, 25),
    categoryId,
    categoryName: categoryName(input.categoryName),
    resources,
    templateHash: clean(input.templateHash, 128),
    status: ['partial', 'ready', 'failed'].includes(input.status) ? input.status : 'partial',
    createdBy: clean(input.createdBy, 100),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function permissionValue(...values) {
  return values.reduce((total, value) => total | value, 0n).toString();
}

function memberRole(member = {}) {
  return ['admin', 'dm', 'assistant_dm', 'player', 'viewer'].includes(member.role) ? member.role : 'viewer';
}

function uniqueProvisioningMembers(members = []) {
  const unique = new Map();
  for (const member of members) {
    if (member?.active === false || !member?.discordUserId) continue;
    const discordUserId = String(member.discordUserId);
    const existing = unique.get(discordUserId);
    if (!existing) {
      unique.set(discordUserId, member);
      continue;
    }
    if (memberRole(existing) !== memberRole(member)) {
      const error = new Error(`Discord user ${discordUserId} has conflicting active campaign roles. Resolve the duplicate membership before provisioning.`);
      error.code = 'DND_PROVISIONING_MEMBER_CONFLICT';
      throw error;
    }
  }
  return [...unique.values()];
}

function memberPermission(member, channel) {
  const role = memberRole(member);
  const isManager = ['admin', 'dm', 'assistant_dm'].includes(role);
  if (channel.key === 'dm-private' && !isManager) {
    return { allow: '0', deny: permissionValue(PERMISSIONS.VIEW_CHANNEL) };
  }
  if (channel.type === 'voice') {
    const allow = isManager || role === 'player'
      ? permissionValue(PERMISSIONS.VIEW_CHANNEL, PERMISSIONS.CONNECT, PERMISSIONS.SPEAK)
      : permissionValue(PERMISSIONS.VIEW_CHANNEL, PERMISSIONS.CONNECT);
    const deny = role === 'viewer' ? permissionValue(PERMISSIONS.SPEAK) : '0';
    return { allow, deny };
  }
  if (channel.playerMode === 'read' && !isManager) {
    return {
      allow: permissionValue(PERMISSIONS.VIEW_CHANNEL, PERMISSIONS.READ_MESSAGE_HISTORY),
      deny: permissionValue(PERMISSIONS.SEND_MESSAGES)
    };
  }
  if (role === 'viewer') {
    return {
      allow: permissionValue(PERMISSIONS.VIEW_CHANNEL, PERMISSIONS.READ_MESSAGE_HISTORY),
      deny: permissionValue(PERMISSIONS.SEND_MESSAGES)
    };
  }
  return {
    allow: permissionValue(
      PERMISSIONS.VIEW_CHANNEL,
      PERMISSIONS.SEND_MESSAGES,
      PERMISSIONS.EMBED_LINKS,
      PERMISSIONS.ATTACH_FILES,
      PERMISSIONS.READ_MESSAGE_HISTORY
    ),
    deny: '0'
  };
}

function buildPermissionOverwrites({ guildId, botUserId, members = [], channel }) {
  const active = uniqueProvisioningMembers(members);
  if (active.length > MAX_MEMBER_OVERWRITES) {
    const error = new Error(`This campaign has ${active.length} mapped members; individual channel provisioning supports at most ${MAX_MEMBER_OVERWRITES}. Configure Discord roles before provisioning.`);
    error.code = 'DND_PROVISIONING_MEMBER_LIMIT';
    throw error;
  }
  const overwrites = [{
    id: String(guildId),
    type: 0,
    allow: '0',
    deny: permissionValue(PERMISSIONS.VIEW_CHANNEL)
  }];
  if (botUserId) {
    overwrites.push({
      id: String(botUserId),
      type: 1,
      allow: permissionValue(
        PERMISSIONS.VIEW_CHANNEL,
        PERMISSIONS.SEND_MESSAGES,
        PERMISSIONS.EMBED_LINKS,
        PERMISSIONS.ATTACH_FILES,
        PERMISSIONS.READ_MESSAGE_HISTORY,
        PERMISSIONS.CONNECT,
        PERMISSIONS.SPEAK
      ),
      deny: '0'
    });
  }
  for (const member of active) {
    const permission = memberPermission(member, channel);
    overwrites.push({ id: String(member.discordUserId), type: 1, ...permission });
  }
  return overwrites;
}

function computeBasePermissions(member = {}, roles = [], guildId = '') {
  const roleMap = new Map(roles.map((role) => [String(role.id), BigInt(String(role.permissions || '0'))]));
  let permissions = roleMap.get(String(guildId)) || 0n;
  for (const roleId of member.roles || []) permissions |= roleMap.get(String(roleId)) || 0n;
  return permissions;
}

function hasPermission(permissions, permission) {
  const value = BigInt(permissions || 0);
  return (value & PERMISSIONS.ADMINISTRATOR) === PERMISSIONS.ADMINISTRATOR || (value & permission) === permission;
}

function provisioningIdentity({ campaignId, appId, guildId }) {
  return `provisioning:${clean(campaignId, 100)}:${clean(appId, 100)}:${clean(guildId, 25)}`;
}

module.exports = {
  PERMISSIONS,
  DEFAULT_CAMPAIGN_CHANNEL_TEMPLATE,
  MAX_MEMBER_OVERWRITES,
  clean,
  channelName,
  categoryName,
  stableHash,
  normalizeTemplate,
  normalizeProvisioningRecord,
  permissionValue,
  memberPermission,
  buildPermissionOverwrites,
  computeBasePermissions,
  hasPermission,
  provisioningIdentity
};
