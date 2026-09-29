'use strict';

const { ChannelType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { snowflake, upsertEmbed } = require('../game-bots/panel-message.cjs');
const { isStaff } = require('../game-bots/ops-spine.cjs');
const { probeServerStatus } = require('../craft/query.cjs');
const { COLORS, MOTTO } = require('../craft/embeds.cjs');
const { loadConfig } = require('../shared/config.cjs');
const { collectPublicServers } = require('./public-server-inventory.cjs');

const LIST_TITLE = 'Khaos Nexus servers';
const LIST_FOOTER = `${MOTTO} • servers`;
const LIST_IDENTITY = Object.freeze({
  titles: Object.freeze([LIST_TITLE]),
  footerPrefixes: Object.freeze([LIST_FOOTER])
});

function listEnabled(env = process.env) {
  const raw = String(env.NEXUS_PUBLIC_SERVER_LIST_ENABLED ?? 'true').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(raw);
}

function refreshMs(env = process.env) {
  const seconds = Number(env.NEXUS_PUBLIC_SERVER_LIST_REFRESH_SECONDS || 300);
  return Math.max(60, Math.min(900, Number.isFinite(seconds) ? seconds : 300)) * 1000;
}

function listChannel(meta = {}, env = process.env) {
  const raw = env.NEXUS_PUBLIC_SERVER_LIST_CHANNEL_ID;
  if (raw !== undefined && String(raw).trim() !== '') {
    const id = snowflake(raw);
    if (!id) return { id: '', source: 'invalid' };
    return { id, source: 'env' };
  }
  const saved = snowflake(meta.channelId);
  if (saved) return { id: saved, source: 'discord' };
  return { id: '', source: 'unset' };
}

function serverListCommand() {
  return new SlashCommandBuilder()
    .setName('serverlist')
    .setDescription('Post the public Khaos Nexus server list in a channel.')
    .setDMPermission(false)
    .addSubcommand((sub) => sub
      .setName('setup')
      .setDescription('Admin: save the Info channel and post one durable server list.')
      .addChannelOption((option) => option
        .setName('channel')
        .setDescription('Channel that should hold the server list.')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('refresh')
      .setDescription('Admin: edit the saved server list in place.'));
}

function renderServerValue(row) {
  const lines = [];
  if (row.kind === 'realm') {
    if (row.description) lines.push(row.description);
    lines.push('Apply on the Realms board.');
  } else {
    for (const join of row.joins || []) lines.push(`**Join:** ${join}`);
    if (row.description) lines.push(row.description);
  }
  if (row.status) {
    const players = row.players ? ` • ${row.players}` : '';
    lines.push(`**Status:** ${row.status}${players}`);
  }
  if (!lines.length) lines.push('Listed.');
  return lines.join('\n').slice(0, 1024);
}

function renderPublicServerList(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const fields = list.slice(0, 24).map((row) => ({
    name: `${row.game} • ${row.name}`.slice(0, 256),
    value: renderServerValue(row),
    inline: false
  }));
  if (!fields.length) {
    fields.push({ name: 'Public servers', value: 'No public game servers are configured yet.', inline: false });
  }
  return {
    embeds: [{
      title: LIST_TITLE,
      description: 'Public Khaos Nexus game servers.',
      color: list.length ? COLORS.fieryRed : COLORS.black,
      fields,
      footer: { text: LIST_FOOTER }
    }],
    allowedMentions: { parse: [] }
  };
}

async function applyLiveMinecraftStatus(rows, options = {}) {
  if (options.probe === false) return rows;
  const probe = options.probeServerStatus || probeServerStatus;
  const next = [];
  for (const row of rows) {
    if (row.kind !== 'java' && row.kind !== 'bedrock' && row.kind !== 'geyser') {
      next.push(row);
      continue;
    }
    const join = (row.joins || []).find((item) => row.kind === 'bedrock' ? item.startsWith('Bedrock ') : item.startsWith('Java ') || item.startsWith('Bedrock ')) || '';
    const address = join.replace(/^(Java|Bedrock)\s+/, '');
    const split = address.lastIndexOf(':');
    if (split < 1) {
      next.push(row);
      continue;
    }
    const host = address.slice(0, split);
    const port = Number(address.slice(split + 1));
    try {
      const snapshot = await probe({
        host,
        kind: row.kind === 'bedrock' ? 'bedrock' : 'java',
        javaPort: port,
        bedrockPort: port,
        timeoutMs: 1500
      });
      const status = row.kind === 'bedrock' ? snapshot.bedrock : snapshot.java;
      if (!status || status.offline) next.push({ ...row, status: 'Offline', players: '' });
      else {
        const players = Number.isFinite(Number(status.online)) && Number.isFinite(Number(status.max))
          ? `${status.online}/${status.max}`
          : '';
        next.push({ ...row, status: 'Online', players });
      }
    } catch {
      next.push({ ...row, status: 'Offline', players: '' });
    }
  }
  return next;
}

async function publishPublicServerList(client, options = {}) {
  const env = options.env || process.env;
  if (!listEnabled(env)) return { skipped: 'disabled' };
  const state = options.state;
  const meta = options.meta || (state?.getPublicServerList ? state.getPublicServerList() : {});
  const channel = listChannel(meta, env);
  if (!channel.id) return { skipped: channel.source === 'invalid' ? 'invalid-channel' : 'unset' };
  const config = options.config || options.runtime?.config || loadConfig();
  const runtime = options.runtime || { config, manifests() { return []; } };
  const rows = await applyLiveMinecraftStatus(collectPublicServers({
    env,
    arkRegistry: options.arkRegistry,
    craftStore: options.craftStore,
    hostedStore: options.hostedStore,
    runtime
  }), options);
  const payload = renderPublicServerList(rows);
  const result = await upsertEmbed(client, channel.id, meta.messageId, payload, {
    identity: LIST_IDENTITY,
    botId: options.botId || client?.user?.id,
    banner: false
  });
  if (state?.setPublicServerList && result?.messageId && result.messageId !== meta.messageId) {
    state.setPublicServerList({ channelId: channel.id, messageId: result.messageId });
  } else if (state?.setPublicServerList && channel.source === 'env' && channel.id !== meta.channelId) {
    state.setPublicServerList({ channelId: channel.id, messageId: result?.messageId || meta.messageId });
  }
  return { ...result, channelId: channel.id, servers: rows.length, payload };
}

function ephemeral(content) {
  return { content: String(content || '').slice(0, 1900), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

async function handleServerListCommand(interaction, context = {}) {
  if (typeof interaction.isChatInputCommand === 'function' && !interaction.isChatInputCommand()) return false;
  if (String(interaction.commandName || '') !== 'serverlist') return false;
  const env = context.env || process.env;
  const config = context.config || {};
  if (!isStaff(interaction, config)) {
    await interaction.reply(ephemeral('Only Nexus staff can set up the public server list.'));
    return true;
  }
  const sub = interaction.options?.getSubcommand?.(false) || '';
  const state = context.state;
  if (!state?.getPublicServerList || !state?.setPublicServerList) {
    await interaction.reply(ephemeral('The server list store is not available.'));
    return true;
  }
  if (sub === 'setup') {
    const current = listChannel(state.getPublicServerList(), env);
    if (current.source === 'env' || current.source === 'invalid') {
      await interaction.reply(ephemeral('The server list channel is set by NEXUS_PUBLIC_SERVER_LIST_CHANNEL_ID.'));
      return true;
    }
    const selected = interaction.options?.getChannel?.('channel');
    const id = snowflake(selected?.id);
    if (!id) {
      await interaction.reply(ephemeral('Choose a text channel for the server list.'));
      return true;
    }
    const saved = state.setPublicServerList({ channelId: id, messageId: state.getPublicServerList().messageId });
    if (!listEnabled(env)) {
      await interaction.reply(ephemeral(`Saved <#${saved.channelId}>. The public server list is turned off, so nothing was posted.`));
      return true;
    }
    const result = await publishPublicServerList(context.client || interaction.client, { ...context, env, state, meta: saved });
    const posted = result?.messageId ? `The server list is in <#${saved.channelId}> and later restarts edit that same message.` : 'The channel was saved, but the server list could not be posted.';
    await interaction.reply(ephemeral(posted));
    return true;
  }
  if (sub === 'refresh') {
    if (!listEnabled(env)) {
      await interaction.reply(ephemeral('The public server list is turned off.'));
      return true;
    }
    const result = await publishPublicServerList(context.client || interaction.client, { ...context, env, state });
    if (result.skipped) {
      await interaction.reply(ephemeral(result.skipped === 'unset'
        ? 'No server list channel is saved. Use /serverlist setup or set NEXUS_PUBLIC_SERVER_LIST_CHANNEL_ID.'
        : 'The server list channel is not a Discord channel id.'));
      return true;
    }
    await interaction.reply(ephemeral(result.messageId ? 'Updated the server list in place.' : 'The server list could not be posted.'));
    return true;
  }
  return true;
}

module.exports = {
  LIST_FOOTER,
  LIST_IDENTITY,
  LIST_TITLE,
  handleServerListCommand,
  listChannel,
  listEnabled,
  publishPublicServerList,
  refreshMs,
  renderPublicServerList,
  serverListCommand
};
