'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { valuesOf, roleHasStaffPower } = require('./self-role-manager.cjs');

const STAFF_PERMISSION_SUMMARY = Object.freeze([
  ['administrator', 'Administrator', PermissionFlagsBits.Administrator],
  ['manageGuild', 'Manage Guild', PermissionFlagsBits.ManageGuild],
  ['manageRoles', 'Manage Roles', PermissionFlagsBits.ManageRoles],
  ['kickMembers', 'Kick Members', PermissionFlagsBits.KickMembers],
  ['banMembers', 'Ban Members', PermissionFlagsBits.BanMembers],
  ['moderateMembers', 'Moderate Members', PermissionFlagsBits.ModerateMembers]
].filter(([, , bit]) => Boolean(bit)));

function rolePosition(role) {
  return Number(role?.position ?? role?.rawPosition ?? 0);
}

function roleColor(role) {
  const numeric = Number(role?.color || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function roleHex(role) {
  const direct = String(role?.hexColor || '').trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(direct)) return direct;
  const numeric = roleColor(role);
  return numeric ? `#${numeric.toString(16).padStart(6, '0').toUpperCase()}` : '#000000';
}

function configuredColorRoleIds(config = {}) {
  const result = new Set();
  for (const menu of config.discord?.selfRoleMenus || []) {
    if (String(menu?.kind || '').toLowerCase() !== 'colors') continue;
    for (const option of menu.options || []) {
      const id = String(option?.roleId || '').trim();
      if (id) result.add(id);
    }
  }
  return result;
}

function isSelectableColorRole(role, configuredIds = new Set()) {
  const id = String(role?.id || '');
  const name = String(role?.name || '').trim();
  return configuredIds.has(id) || /^color\s*:/i.test(name);
}

function permissionSummary(role) {
  return STAFF_PERMISSION_SUMMARY
    .filter(([, , bit]) => role?.permissions?.has?.(bit))
    .map(([id, label]) => ({ id, label }));
}

function inspectProtectedRole(role, context) {
  const position = rolePosition(role);
  const color = roleColor(role);
  const managed = role?.managed === true;
  const editable = role?.editable !== false;
  const aboveColors = position > context.highestColorPosition;
  const overridesSelectableColor = Boolean(color && aboveColors);
  const blockers = [];

  if (!overridesSelectableColor) blockers.push(color ? 'not-above-selectable-colors' : 'no-color');
  if (managed) blockers.push('managed-role');
  if (!editable) blockers.push('not-editable');
  if (String(role?.id || '') === context.guildId) blockers.push('everyone-role');
  if (context.botHighestPosition > 0 && position >= context.botHighestPosition) blockers.push('not-below-sentinal');

  return {
    id: String(role?.id || ''),
    name: String(role?.name || ''),
    position,
    color,
    hexColor: roleHex(role),
    managed,
    editable,
    hoist: role?.hoist === true,
    permissions: permissionSummary(role),
    overridesSelectableColor,
    eligibleForColorNeutralPreview: overridesSelectableColor && blockers.length === 0,
    blockers
  };
}

function buildStaffNameColorPreview({ guildId = '', roles, botHighestRole = null, config = {} } = {}) {
  const allRoles = valuesOf(roles).filter(Boolean);
  const configuredIds = configuredColorRoleIds(config);
  const selectable = allRoles
    .filter((role) => isSelectableColorRole(role, configuredIds))
    .sort((a, b) => rolePosition(b) - rolePosition(a));

  const highest = selectable[0] || null;
  const highestColorPosition = highest ? rolePosition(highest) : 0;
  const operatorIds = new Set((config.discord?.operatorRoleIds || []).map(String));
  const botHighestPosition = rolePosition(botHighestRole);

  const protectedRoles = allRoles
    .filter((role) => !isSelectableColorRole(role, configuredIds))
    .filter((role) => rolePosition(role) > highestColorPosition)
    .filter((role) => operatorIds.has(String(role?.id || '')) || roleHasStaffPower(role))
    .map((role) => inspectProtectedRole(role, {
      guildId: String(guildId || ''),
      highestColorPosition,
      botHighestPosition
    }))
    .sort((a, b) => b.position - a.position);

  const proposedRoleIds = protectedRoles
    .filter((role) => role.eligibleForColorNeutralPreview)
    .map((role) => role.id);
  const blockedRoleIds = protectedRoles
    .filter((role) => role.overridesSelectableColor && !role.eligibleForColorNeutralPreview)
    .map((role) => role.id);

  return {
    ok: true,
    readOnly: true,
    mutationAuthorized: false,
    needsOwnerReview: proposedRoleIds.length > 0,
    selectableColorRoleCount: selectable.length,
    highestSelectableColorRole: highest ? {
      id: String(highest.id || ''),
      name: String(highest.name || ''),
      position: rolePosition(highest),
      hexColor: roleHex(highest)
    } : null,
    selectableColorRoles: selectable.map((role) => ({
      id: String(role.id || ''),
      name: String(role.name || ''),
      position: rolePosition(role),
      hexColor: roleHex(role)
    })),
    protectedStaffRoles: protectedRoles,
    proposedRoleIds,
    blockedRoleIds
  };
}

module.exports = {
  STAFF_PERMISSION_SUMMARY,
  rolePosition,
  roleColor,
  roleHex,
  configuredColorRoleIds,
  isSelectableColorRole,
  permissionSummary,
  inspectProtectedRole,
  buildStaffNameColorPreview
};
