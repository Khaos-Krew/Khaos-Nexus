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

function channelAccessOverwrites(key, { everyoneId = '', botId = '', staffRoleIds = [] } = {}) {
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
    const rows = [{
      id: everyoneId,
      type: OverwriteType.Role,
      allow: ['ViewChannel', 'ReadMessageHistory'],
      deny: ['SendMessages']
    }];
    if (botId) rows.push({ id: botId, type: OverwriteType.Member, allow: [...BOT_CHANNEL_ALLOW] });
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
  return payload;
}

function accessContext({ guild, env, botId }) {
  return {
    everyoneId: snowflake(guild?.roles?.everyone?.id) || snowflake(guild?.id) || '',
    botId: snowflake(botId) || snowflake(guild?.members?.me?.id) || snowflake(guild?.client?.user?.id) || '',
    staffRoleIds: csvIds(env.VANGUARD_STAFF_ROLE_IDS)
  };
}

async function applyChannelAccess(channel, key, access) {
  const rows = channelAccessOverwrites(key, access);
  if (!rows.length || typeof channel?.permissionOverwrites?.edit !== 'function') return rows;
  for (const row of rows) {
    await channel.permissionOverwrites.edit(row.id, editPayload(row), { type: row.type, reason: 'Nexus Vanguard channel access' });
  }
  return rows;
}

function vanguardCommandBuilder() {
  return new SlashCommandBuilder()
    .setName('vanguard')
    .setDescription('Staff tools for Nexus Vanguard.')
    .addSubcommand((sub) => sub
      .setName('setup')
      .setDescription('Create any missing lfg, fireteam, panel, alert, and lobby channels.'))
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

async function provisionChannels({ guild, env = {}, categoryId, saved = {}, reason = 'Nexus Vanguard setup', botId = '' } = {}) {
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
  const access = accessContext({ guild, env, botId });
  try {
    for (const step of plan) {
      if (step.action === 'invalid') {
        invalid.push(step.name);
        continue;
      }
      const rows = channelAccessOverwrites(step.key, access);
      if (step.action === 'env' || step.action === 'reuse') {
        resolved[step.key] = step.id;
        if (step.action === 'env') pinned.push(step.name);
        else reused.push(step.name);
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
    }
  } catch (error) {
    return { ok: false, reason: 'partial', errorClass: errorClass(error), created, reused, pinned, invalid, resolved };
  }
  return { ok: true, reason: 'ready', created, reused, pinned, invalid, resolved };
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
    botId: interaction.client?.user?.id || interaction.guild?.members?.me?.id || ''
  });
  await ctx.channelStore.update((state) => {
    state[String(interaction.guildId)] = { ...(state[String(interaction.guildId)] || {}), ...result.resolved };
    return state;
  });
  publishRuntimeChannels(env, resolvedChannels(env, result.resolved), ctx.jtc);
  if (!result.ok) {
    await interaction.editReply(ephemeral(`Channel setup stopped (class ${result.errorClass || 'error'}). Run it again to reuse channels that were already created.`));
    return true;
  }
  const { created, reused, pinned, invalid } = result;
  const lines = ['**Vanguard channel setup**'];
  lines.push(created.length ? `Created: ${created.join(', ')}` : 'Created: none');
  lines.push(reused.length ? `Reused: ${reused.join(', ')}` : 'Reused: none');
  lines.push(pinned.length ? `Left on env ids: ${pinned.join(', ')}` : 'Left on env ids: none');
  if (invalid.length) lines.push(`Ignored invalid env ids (fix them in Railway): ${invalid.join(', ')}`);
  lines.push('Channel names stay free of the game name.');
  await interaction.editReply(ephemeral(lines.join('\n')));
  return true;
}

module.exports = {
  SETUP_CHANNELS,
  channelAccessOverwrites,
  vanguardCommandBuilder,
  planSetup,
  resolvedChannels,
  publishRuntimeChannels,
  provisionChannels,
  runSetup
};
