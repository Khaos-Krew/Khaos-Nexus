'use strict';

const { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { errorClass } = require('../../command-failure.cjs');
const { snowflake } = require('../config.cjs');
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

function vanguardCommandBuilder() {
  return new SlashCommandBuilder()
    .setName('vanguard')
    .setDescription('Staff tools for Nexus Vanguard.')
    .addSubcommand((sub) => sub
      .setName('setup')
      .setDescription('Create missing lfg, fireteam, panel, alert, and lobby channels.'));
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
  const guild = interaction.guild;
  const fetched = typeof guild?.channels?.fetch === 'function' ? await guild.channels.fetch() : null;
  const list = fetched && typeof fetched.values === 'function' ? [...fetched.values()] : [];
  const savedRoot = ctx.channelStore.read();
  const saved = savedRoot[String(interaction.guildId)] || {};
  const plan = planSetup({ channels: list, env, categoryId: category.id, saved });
  const resolved = { ...saved };
  const created = [];
  const reused = [];
  const pinned = [];
  const invalid = [];
  try {
    for (const step of plan) {
      if (step.action === 'invalid') {
        invalid.push(step.name);
        continue;
      }
      if (step.action === 'env') {
        resolved[step.key] = step.id;
        pinned.push(step.name);
        continue;
      }
      if (step.action === 'reuse') {
        resolved[step.key] = step.id;
        reused.push(step.name);
        continue;
      }
      const channel = await guild.channels.create({
        name: step.name,
        type: step.type,
        parent: category.id,
        reason: 'Nexus Vanguard setup'
      });
      resolved[step.key] = String(channel.id);
      created.push(step.name);
    }
  } catch (error) {
    await ctx.channelStore.update((state) => {
      state[String(interaction.guildId)] = { ...(state[String(interaction.guildId)] || {}), ...resolved };
      return state;
    });
    publishRuntimeChannels(env, resolvedChannels(env, resolved), ctx.jtc);
    await interaction.editReply(ephemeral(`Channel setup stopped (class ${errorClass(error)}). Run it again to reuse channels that were already created.`));
    return true;
  }
  await ctx.channelStore.update((state) => {
    state[String(interaction.guildId)] = resolved;
    return state;
  });
  publishRuntimeChannels(env, resolvedChannels(env, resolved), ctx.jtc);
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
  vanguardCommandBuilder,
  planSetup,
  resolvedChannels,
  publishRuntimeChannels,
  runSetup
};
