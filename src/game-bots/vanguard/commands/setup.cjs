'use strict';

const { ChannelType, MessageFlags, OverwriteType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { errorClass } = require('../../command-failure.cjs');
const { csvIds, snowflake } = require('../config.cjs');
const { vanguardCategory } = require('../gate.cjs');
const { applyJtcLobby } = require('../jtc.cjs');
const { actorIsStaff } = require('../staff.cjs');

const SETUP_CHANNELS = Object.freeze([
  Object.freeze({ key: 'lfg', name: 'lfg', type: ChannelType.GuildText, envName: 'VANGUARD_LFG_CHANNEL_ID' }),
  Object.freeze({ key: 'fireteamFinder', name: 'fireteam-finder', type: ChannelType.GuildText, envName: 'VANGUARD_FIRETEAM_FINDER_CHANNEL_ID' }),
  Object.freeze({ key: 'panels', name: 'panels', type: ChannelType.GuildText, envName: 'VANGUARD_PANELS_CHANNEL_ID' }),
  Object.freeze({ key: 'staffAlerts', name: 'staff-alerts', type: ChannelType.GuildText, envName: 'VANGUARD_STAFF_ALERT_CHANNEL_ID' }),
  Object.freeze({ key: 'jtcLobby', name: 'lobby', type: ChannelType.GuildVoice, envName: 'VANGUARD_JTC_LOBBY_CHANNEL_ID' })
]);

const BOT_CHANNEL_ALLOW = Object.freeze(['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory']);

function roleList(guild) {
  const cache = guild?.roles?.cache;
  if (!cache) return [];
  if (typeof cache.values === 'function') return [...cache.values()];
  if (Array.isArray(cache)) return cache;
  return [];
}

async function findGuildRole(guild, id) {
  const cached = roleList(guild).find((role) => String(role?.id || '') === String(id));
  if (cached) return cached;
  if (typeof guild?.roles?.fetch !== 'function') return null;
  try {
    const role = await guild.roles.fetch(id);
    return role && String(role.id) === String(id) ? role : null;
  } catch {
    return null;
  }
}

async function resolveMemberRole(guild, env = {}) {
  const fromEnv = snowflake(env.VANGUARD_MEMBER_ROLE_ID);
  if (fromEnv) {
    const found = await findGuildRole(guild, fromEnv);
    if (found) return { id: fromEnv, source: 'env' };
    return { id: '', source: 'missing', missingId: fromEnv };
  }
  const found = roleList(guild).find((role) => String(role?.name || '').trim().toLowerCase() === 'destiny 2');
  const id = snowflake(found?.id);
  return id ? { id, source: 'name' } : { id: '', source: '' };
}

const MEMBER_ROLE_WARNING = 'Destiny 2 role was not found. #panels stays visible to @everyone until VANGUARD_MEMBER_ROLE_ID is set or a role named Destiny 2 exists.';

function missingMemberRoleWarning(roleId) {
  return `Destiny 2 role ${roleId} was not found. #panels stays visible to @everyone until VANGUARD_MEMBER_ROLE_ID points at a role in this server.`;
}

function channelAccessOverwrites(key, { everyoneId = '', botId = '', staffRoleIds = [], memberRoleId = '' } = {}) {
  if (key === 'staffAlerts') {
    const rows = [{ id: everyoneId, type: OverwriteType.Role, deny: ['ViewChannel'] }];
    if (botId) rows.push({ id: botId, type: OverwriteType.Member, allow: [...BOT_CHANNEL_ALLOW] });
    for (const roleId of staffRoleIds) {
      if (!roleId || roleId === everyoneId) continue;
      rows.push({ id: roleId, type: OverwriteType.Role, allow: ['ViewChannel', 'ReadMessageHistory'] });
    }
    return rows.filter((row) => row.id);
  }
  if (key === 'panels') {
    const rows = [];
    if (memberRoleId) {
      rows.push({
        id: memberRoleId,
        type: OverwriteType.Role,
        allow: ['ViewChannel', 'ReadMessageHistory'],
        deny: ['SendMessages', 'AddReactions', 'CreatePublicThreads']
      });
    }
    for (const roleId of staffRoleIds) {
      if (!roleId || roleId === everyoneId || roleId === memberRoleId) continue;
      rows.push({ id: roleId, type: OverwriteType.Role, allow: ['ViewChannel', 'ReadMessageHistory'] });
    }
    if (botId) rows.push({ id: botId, type: OverwriteType.Member, allow: [...BOT_CHANNEL_ALLOW, 'AttachFiles'] });
    if (memberRoleId) {
      rows.push({
        id: everyoneId,
        type: OverwriteType.Role,
        deny: ['ViewChannel', 'SendMessages'],
        clear: ['ReadMessageHistory']
      });
    } else {
      rows.push({
        id: everyoneId,
        type: OverwriteType.Role,
        allow: ['ViewChannel', 'ReadMessageHistory'],
        deny: ['SendMessages']
      });
    }
    return rows.filter((row) => row.id);
  }
  return [];
}

function bitfield(names = []) {
  return names.map((name) => PermissionFlagsBits[name]).filter((bit) => bit !== undefined);
}

function discordOverwrites(rows) {
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    allow: bitfield(row.allow),
    deny: bitfield(row.deny)
  }));
}

function editPayload(row) {
  const payload = {};
  for (const name of row.allow || []) payload[name] = true;
  for (const name of row.deny || []) payload[name] = false;
  for (const name of row.clear || []) {
    if (!Object.prototype.hasOwnProperty.call(payload, name)) payload[name] = null;
  }
  return payload;
}

async function accessContext({ guild, env, botId }) {
  const memberRole = await resolveMemberRole(guild, env);
  return {
    everyoneId: snowflake(guild?.roles?.everyone?.id) || snowflake(guild?.id) || '',
    botId: snowflake(botId) || snowflake(guild?.members?.me?.id) || snowflake(guild?.client?.user?.id) || '',
    staffRoleIds: csvIds(env.VANGUARD_STAFF_ROLE_IDS),
    memberRoleId: memberRole.id,
    memberRoleSource: memberRole.source,
    memberRoleMissingId: memberRole.missingId || ''
  };
}

function openEveryoneRow(everyoneId) {
  return {
    id: everyoneId,
    type: OverwriteType.Role,
    allow: ['ViewChannel', 'ReadMessageHistory'],
    deny: ['SendMessages']
  };
}

async function restoreEveryoneView(channel, access) {
  if (!access?.everyoneId || typeof channel?.permissionOverwrites?.edit !== 'function') return;
  const open = openEveryoneRow(access.everyoneId);
  await channel.permissionOverwrites.edit(open.id, editPayload(open), {
    type: open.type,
    reason: 'Nexus Vanguard rollback channel access'
  });
}

function staffAlertConfigured(env = {}) {
  return Boolean(snowflake(env.VANGUARD_STAFF_ALERT_CHANNEL_ID) || snowflake(env.NEXUS_STAFF_ALERT_CHANNEL_ID));
}

async function applyChannelAccess(channel, key, access) {
  const rows = channelAccessOverwrites(key, access);
  if (!rows.length || typeof channel?.permissionOverwrites?.edit !== 'function') return rows;
  const locksEveryone = Boolean(access?.memberRoleId) && rows.some((row) => row.id === access.everyoneId && (row.deny || []).includes('ViewChannel'));
  try {
    for (const row of rows) {
      await channel.permissionOverwrites.edit(row.id, editPayload(row), { type: row.type, reason: 'Nexus Vanguard channel access' });
    }
  } catch (error) {
    if (locksEveryone) {
      try {
        await restoreEveryoneView(channel, access);
      } catch (rollbackError) {
        console.warn(`[Nexus Vanguard] panels rollback class=${errorClass(rollbackError)}`);
      }
    }
    throw error;
  }
  return rows;
}

function inCategory(channel, categoryId) {
  return Boolean(channel) && String(channel.parentId || '') === String(categoryId || '');
}

function staffChannelAlert(client, env = process.env) {
  return async (text) => {
    const channelId = snowflake(env.VANGUARD_STAFF_ALERT_CHANNEL_ID) || snowflake(env.NEXUS_STAFF_ALERT_CHANNEL_ID);
    if (!channelId || typeof client?.channels?.fetch !== 'function') return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (typeof channel?.send !== 'function') return;
    await channel.send({ content: String(text).slice(0, 1800), allowedMentions: { parse: [] } });
  };
}

function vanguardCommandBuilder() {
  return new SlashCommandBuilder()
    .setName('vanguard')
    .setDescription('Staff tools for Nexus Vanguard.')
    .addSubcommand((sub) => sub
      .setName('setup')
      .setDescription('Create any missing lfg, fireteam, panel, alert, and lobby channels.'))
    .addSubcommand((sub) => sub
      .setName('roster')
      .setDescription('Staff: paged clan roster.')
      .addStringOption((option) => option
        .setName('clan')
        .setDescription('Clan')
        .setAutocomplete(true))
      .addIntegerOption((option) => option
        .setName('page')
        .setDescription('Page number, starting at 1')
        .setMinValue(1)))
    .addSubcommandGroup((group) => group
      .setName('panels')
      .setDescription('Panel tools.')
      .addSubcommand((sub) => sub
        .setName('refresh')
        .setDescription('Refresh one panel now.')
        .addStringOption((option) => option
          .setName('panel')
          .setDescription('Which panel to refresh')
          .setRequired(true)
          .addChoices(
            { name: 'all', value: 'all' },
            { name: 'reset', value: 'reset' },
            { name: 'xur', value: 'xur' },
            { name: 'clan', value: 'clan' },
            { name: 'lfg-board', value: 'lfg-board' }
          ))));
}

function planSetup({ channels = [], env = {}, categoryId, saved = {} } = {}) {
  const actions = [];
  for (const spec of SETUP_CHANNELS) {
    const raw = env[spec.envName];
    const fromEnv = snowflake(raw);
    if (raw !== undefined && String(raw).trim() !== '' && !fromEnv) {
      actions.push({ ...spec, action: 'invalid', id: '' });
      continue;
    }
    if (fromEnv) {
      actions.push({ ...spec, action: 'env', id: fromEnv });
      continue;
    }
    const fromSaved = snowflake(saved[spec.key]);
    const match = channels.find((channel) => {
      if (String(channel?.parentId || '') !== String(categoryId || '')) return false;
      if (Number(channel?.type) !== Number(spec.type)) return false;
      if (fromSaved && String(channel.id) === fromSaved) return true;
      return String(channel?.name || '') === spec.name;
    });
    if (match) actions.push({ ...spec, action: 'reuse', id: String(match.id) });
    else actions.push({ ...spec, action: 'create', id: '' });
  }
  return actions;
}

function resolvedChannels(env = process.env, saved = {}) {
  const out = {};
  for (const spec of SETUP_CHANNELS) {
    out[spec.key] = snowflake(env[spec.envName]) || snowflake(saved?.[spec.key]) || '';
  }
  return out;
}

function publishRuntimeChannels(env, channels, controller) {
  if (channels.jtcLobby && !snowflake(env.VANGUARD_JTC_LOBBY_CHANNEL_ID)) {
    env.VANGUARD_JTC_LOBBY_CHANNEL_ID = channels.jtcLobby;
  }
  if (channels.staffAlerts && !snowflake(env.VANGUARD_STAFF_ALERT_CHANNEL_ID)) {
    env.VANGUARD_STAFF_ALERT_CHANNEL_ID = channels.staffAlerts;
  }
  if (channels.staffAlerts && !snowflake(env.NEXUS_STAFF_ALERT_CHANNEL_ID)) {
    env.NEXUS_STAFF_ALERT_CHANNEL_ID = channels.staffAlerts;
  }
  applyJtcLobby(controller, env);
  return channels;
}

function channelList(fetched) {
  if (!fetched) return [];
  if (typeof fetched.values === 'function') return [...fetched.values()];
  if (Array.isArray(fetched)) return fetched;
  return [];
}

function channelById(list, id) {
  return list.find((channel) => String(channel?.id || '') === String(id || '')) || null;
}

async function provisionChannels({ guild, env = {}, categoryId, saved = {}, reason = 'Nexus Vanguard setup', botId = '', alert } = {}) {
  const gateId = snowflake(categoryId);
  if (!gateId) {
    return { ok: false, reason: 'fail-closed', created: [], reused: [], pinned: [], invalid: [], resolved: {} };
  }
  const fetched = typeof guild?.channels?.fetch === 'function' ? await guild.channels.fetch() : null;
  const plan = planSetup({ channels: channelList(fetched), env, categoryId: gateId, saved });
  const resolved = { ...saved };
  const created = [];
  const reused = [];
  const pinned = [];
  const invalid = [];
  const known = channelList(fetched);
  const access = await accessContext({ guild, env, botId });
  const failed = [];
  const skipped = [];
  const warnings = [];
  const alertReady = staffAlertConfigured(env);
  if (access.memberRoleSource === 'missing') warnings.push(missingMemberRoleWarning(access.memberRoleMissingId));
  else if (!access.memberRoleId) warnings.push(MEMBER_ROLE_WARNING);
  async function notify(text) {
    console.warn(`[Nexus Vanguard] ${text}`);
    if (typeof alert !== 'function') return;
    try {
      await alert(text);
    } catch (error) {
      console.warn(`[Nexus Vanguard] staff alert class=${errorClass(error)}`);
    }
  }
  for (const step of plan) {
    try {
      if (step.action === 'invalid') {
        invalid.push(step.name);
        continue;
      }
      const rows = channelAccessOverwrites(step.key, access);
      if (step.action === 'env') {
        resolved[step.key] = step.id;
        pinned.push(step.name);
        const existing = channelById(known, step.id);
        if (!inCategory(existing, gateId)) {
          skipped.push(step.name);
          await notify(`Skipped permission changes on ${step.name} (${step.id}): it is not in the Vanguard category.`);
          continue;
        }
        await applyChannelAccess(existing, step.key, access);
        continue;
      }
      if (step.action === 'reuse') {
        resolved[step.key] = step.id;
        reused.push(step.name);
        await applyChannelAccess(channelById(known, step.id), step.key, access);
        continue;
      }
      const options = {
        name: step.name,
        type: step.type,
        parent: gateId,
        reason
      };
      if (rows.length) options.permissionOverwrites = discordOverwrites(rows);
      const channel = await guild.channels.create(options);
      resolved[step.key] = String(channel.id);
      created.push(step.name);
      await applyChannelAccess(channel, step.key, access);
    } catch (error) {
      failed.push(step.name);
      await notify(`Permission update failed on ${step.name} (class=${errorClass(error)}). Setup continued with the other channels.`);
    }
  }
  for (const text of warnings) await notify(text);
  return {
    ok: failed.length === 0,
    reason: failed.length ? 'partial' : 'ready',
    created,
    reused,
    pinned,
    invalid,
    skipped,
    failed,
    resolved,
    warnings,
    alertReady
  };
}

function ephemeral(content) {
  return { content: String(content || '').slice(0, 1900), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

async function runSetup(interaction, ctx) {
  const env = ctx.env || process.env;
  if (!actorIsStaff(interaction, env)) {
    await interaction.reply(ephemeral('Channel setup is restricted to Nexus staff.'));
    return true;
  }
  const category = vanguardCategory(env);
  if (!category.id) {
    await interaction.reply(ephemeral(`Vanguard is fail-closed: ${category.envName || 'VANGUARD_DISCORD_CATEGORY_ID'} is missing or not a Discord category id.`));
    return true;
  }
  const perms = interaction.appPermissions || interaction.guild?.members?.me?.permissions;
  if (perms && typeof perms.has === 'function' && !perms.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply(ephemeral('I need Manage Channels in this category before I can create channels.'));
    return true;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const saved = ctx.channelStore.read()?.[String(interaction.guildId)] || {};
  const result = await provisionChannels({
    guild: interaction.guild,
    env,
    categoryId: category.id,
    saved,
    reason: 'Nexus Vanguard setup',
    botId: interaction.client?.user?.id || interaction.guild?.members?.me?.id || '',
    alert: staffChannelAlert(interaction.client, env)
  });
  await ctx.channelStore.update((state) => {
    state[String(interaction.guildId)] = { ...(state[String(interaction.guildId)] || {}), ...result.resolved };
    return state;
  });
  publishRuntimeChannels(env, resolvedChannels(env, result.resolved), ctx.jtc);
  if (result.warnings?.length && !result.alertReady) {
    const alert = staffChannelAlert(interaction.client, env);
    for (const text of result.warnings) {
      try {
        await alert(text);
      } catch (error) {
        console.warn(`[Nexus Vanguard] staff alert class=${errorClass(error)}`);
      }
    }
  }
  if (!result.ok && result.reason !== 'partial') {
    await interaction.editReply(ephemeral(`Channel setup stopped (class ${result.errorClass || 'error'}). Run it again to reuse channels that were already created.`));
    return true;
  }
  const { created, reused, pinned, invalid } = result;
  const lines = ['**Vanguard channel setup**'];
  lines.push(created.length ? `Created: ${created.join(', ')}` : 'Created: none');
  lines.push(reused.length ? `Reused: ${reused.join(', ')}` : 'Reused: none');
  lines.push(pinned.length ? `Left on env ids: ${pinned.join(', ')}` : 'Left on env ids: none');
  if (invalid.length) lines.push(`Ignored invalid env ids (fix them in Railway): ${invalid.join(', ')}`);
  if (result.skipped?.length) lines.push(`Left unchanged (outside the category): ${result.skipped.join(', ')}`);
  if (result.failed?.length) lines.push(`Permission update failed, other channels continued: ${result.failed.join(', ')}`);
  for (const text of result.warnings || []) lines.push(text);
  lines.push('Channel names stay free of the game name.');
  await interaction.editReply(ephemeral(lines.join('\n')));
  return true;
}

module.exports = {
  SETUP_CHANNELS,
  MEMBER_ROLE_WARNING,
  missingMemberRoleWarning,
  channelAccessOverwrites,
  resolveMemberRole,
  staffAlertConfigured,
  staffChannelAlert,
  vanguardCommandBuilder,
  planSetup,
  resolvedChannels,
  publishRuntimeChannels,
  provisionChannels,
  runSetup
};
