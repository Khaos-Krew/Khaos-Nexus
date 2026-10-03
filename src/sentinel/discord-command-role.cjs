'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { hasListedRole } = require('../game-bots/vanguard/config.cjs');

function ownerUserIds(config = {}) {
  return (config.discord?.ownerUserIds || []).map((id) => String(id || '').trim()).filter(Boolean);
}

function configuredDiscordRole(interaction, config = {}) {
  const userId = String(interaction?.user?.id || '');
  if (userId && ownerUserIds(config).includes(userId)) return 'owner';
  if (hasListedRole(interaction, config.discord?.operatorRoleIds || [])) return 'operator';
  return 'viewer';
}

async function discordCommandRole(interaction, config = {}, backend = null) {
  const configured = configuredDiscordRole(interaction, config);
  if (configured !== 'viewer') return configured;
  const linked = await backend?.accountByDiscord?.(String(interaction?.user?.id || '')).catch(() => null);
  if (linked?.ok && ['owner', 'co-owner'].includes(linked.account?.role)) return 'owner';
  return 'viewer';
}

function hostedServerManagerAuthorized(interaction, config = {}) {
  const userId = String(interaction?.user?.id || '');
  if (!userId) return false;
  if (userId === String(interaction?.guild?.ownerId || '')) return true;
  if (ownerUserIds(config).includes(userId)) return true;
  const permissions = interaction?.member?.permissions;
  if (permissions?.has?.(PermissionFlagsBits.Administrator) || permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  return hasListedRole(interaction, config.discord?.operatorRoleIds || []);
}

module.exports = {
  configuredDiscordRole,
  discordCommandRole,
  hostedServerManagerAuthorized
};
