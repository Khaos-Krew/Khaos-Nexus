'use strict';

const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { searchActivities } = require('./activities-static.cjs');
const { boardEmbed, deliverPost, parseLfgButton, renderPost } = require('./lfg-buttons.cjs');
const { actorIsStaff } = require('../staff.cjs');
const { snowflake } = require('../config.cjs');
const { resolvedChannels } = require('../commands/setup.cjs');
const { upsertOwnedPanel } = require('../panels.cjs');
const crypto = require('node:crypto');

const REASONS = Object.freeze({
  cap: 'You already have the maximum number of open fireteams.',
  full: 'This fireteam is full.',
  joined: 'You are already in this fireteam.',
  'not-member': 'You are not in this fireteam.',
  host: 'Hosts close the fireteam instead of leaving it.',
  forbidden: 'Only the host or staff can close this fireteam.',
  missing: 'That fireteam is not open.',
  inactive: 'That fireteam is no longer open.',
  activity: 'Pick an activity from the list.',
  rate: 'Slow down a moment and try again.',
  slots: 'Slots must be a whole number from 2 to 12.'
});

function ephemeral(content) {
  return { content: String(content || '').slice(0, 1900), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

function lfgCommandBuilder() {
  return new SlashCommandBuilder()
    .setName('lfg')
    .setDescription('Post or manage a fireteam.')
    .addSubcommand((sub) => sub
      .setName('create')
      .setDescription('Post a fireteam.')
      .addStringOption((option) => option
        .setName('activity')
        .setDescription('Raid, dungeon, Nightfall, Trials, or another activity')
        .setRequired(true)
        .setAutocomplete(true))
      .addIntegerOption((option) => option
        .setName('slots')
        .setDescription('Fireteam size, from 2 to 12')
        .setMinValue(2)
        .setMaxValue(12))
      .addStringOption((option) => option
        .setName('when')
        .setDescription('When, such as now or 8pm CT')
        .setMaxLength(80))
      .addStringOption((option) => option
        .setName('note')
        .setDescription('Short note')
        .setMaxLength(200)))
    .addSubcommand((sub) => sub
      .setName('list')
      .setDescription('List open fireteams in this server.'))
    .addSubcommand((sub) => sub
      .setName('close')
      .setDescription('Close one of your fireteams. Staff can close any.')
      .addStringOption((option) => option
        .setName('post')
        .setDescription('Open fireteam')
        .setRequired(true)
        .setAutocomplete(true)));
}

function channelsFor(ctx, guildId) {
  const saved = ctx.channelStore.read()?.[String(guildId)] || {};
  return resolvedChannels(ctx.env, saved);
}

function reasonText(reason) {
  return REASONS[reason] || 'That fireteam action did not run.';
}

async function editLinked(ctx, post, { ping = false } = {}) {
  const channels = channelsFor(ctx, post.guildId || ctx.guildId);
  return deliverPost(ctx.client, { ...post, guildId: post.guildId }, {
    lobbyId: channels.jtcLobby,
    ping
  });
}

async function handleAutocomplete(interaction, ctx) {
  const focused = interaction.options?.getFocused?.(true);
  if (!focused) {
    await interaction.respond([]);
    return true;
  }
  if (focused.name === 'activity') {
    await interaction.respond(searchActivities(focused.value));
    return true;
  }
  if (focused.name === 'post') {
    const staff = actorIsStaff(interaction, ctx.env);
    const posts = ctx.lfg.listForClose({
      guildId: interaction.guildId,
      userId: interaction.user?.id,
      staff
    });
    const q = String(focused.value || '').trim().toLowerCase();
    const choices = posts
      .filter((post) => !q || post.id.includes(q) || post.activityKey.includes(q))
      .slice(0, 25)
      .map((post) => ({
        name: `${post.activityKey} ${post.members.length}/${post.slots} ${post.id}`.slice(0, 100),
        value: post.id
      }));
    await interaction.respond(choices);
    return true;
  }
  await interaction.respond([]);
  return true;
}

async function handleCreate(interaction, ctx) {
  const channels = channelsFor(ctx, interaction.guildId);
  if (!channels.lfg) {
    await interaction.reply(ephemeral('Fireteam posts are off until the lfg channel exists. Staff can run /vanguard setup.'));
    return true;
  }
  const result = await ctx.lfg.create({
    guildId: interaction.guildId,
    hostId: interaction.user?.id,
    activityKey: interaction.options.getString('activity', true),
    slots: interaction.options.getInteger('slots'),
    when: interaction.options.getString('when') || '',
    note: interaction.options.getString('note') || '',
    channelId: channels.lfg
  });
  if (!result.ok) {
    await interaction.reply(ephemeral(reasonText(result.reason)));
    return true;
  }
  const channel = await interaction.client.channels.fetch(channels.lfg).catch(() => null);
  if (!channel || typeof channel.send !== 'function') {
    await ctx.lfg.remove(interaction.guildId, result.post.id);
    await interaction.reply(ephemeral('The lfg channel is missing, so the fireteam was not posted.'));
    return true;
  }
  try {
    const message = await channel.send(renderPost(result.post, { lobbyId: channels.jtcLobby }));
    await ctx.lfg.attachMessage(interaction.guildId, result.post.id, {
      channelId: channel.id,
      messageId: message.id
    });
  } catch (error) {
    await ctx.lfg.remove(interaction.guildId, result.post.id);
    throw error;
  }
  await interaction.reply(ephemeral('Fireteam posted.'));
  ctx.scheduleBoard?.(interaction.guildId);
  return true;
}

async function handleList(interaction, ctx) {
  const posts = ctx.lfg.listOpen(interaction.guildId);
  if (!posts.length) {
    await interaction.reply(ephemeral('No open fireteams.'));
    return true;
  }
  const lines = posts.slice(0, 20).map((post) => `• ${post.activityKey} ${post.members.length}/${post.slots} \`${post.id}\``);
  await interaction.reply(ephemeral(lines.join('\n')));
  return true;
}

async function handleClose(interaction, ctx) {
  const postId = interaction.options.getString('post', true);
  const staff = actorIsStaff(interaction, ctx.env);
  const result = await ctx.lfg.close({
    guildId: interaction.guildId,
    postId,
    userId: interaction.user?.id,
    staff
  });
  if (!result.ok) {
    await interaction.reply(ephemeral(reasonText(result.reason)));
    return true;
  }
  await editLinked(ctx, { ...result.post, guildId: interaction.guildId });
  await interaction.reply(ephemeral('Fireteam closed.'));
  ctx.scheduleBoard?.(interaction.guildId);
  return true;
}

async function handleButton(interaction, ctx) {
  const parsed = parseLfgButton(interaction.customId);
  if (!parsed) return false;
  const staff = actorIsStaff(interaction, ctx.env);
  const input = {
    guildId: interaction.guildId,
    postId: parsed.postId,
    userId: interaction.user?.id,
    staff,
    lobbyId: channelsFor(ctx, interaction.guildId).jtcLobby
  };
  let result;
  if (parsed.action === 'join') result = await ctx.lfg.join(input);
  else if (parsed.action === 'leave') result = await ctx.lfg.leave(input);
  else result = await ctx.lfg.close(input);
  if (!result.ok) {
    await interaction.reply(ephemeral(reasonText(result.reason)));
    if (result.post) await editLinked(ctx, { ...result.post, guildId: interaction.guildId });
    return true;
  }
  await editLinked(ctx, { ...result.post, guildId: interaction.guildId }, { ping: Boolean(result.justFilled) });
  await interaction.reply(ephemeral(parsed.action === 'join' ? 'You joined the fireteam.' : parsed.action === 'leave' ? 'You left the fireteam.' : 'Fireteam closed.'));
  ctx.scheduleBoard?.(interaction.guildId);
  return true;
}

async function handleLfgInteraction(interaction, ctx) {
  if (typeof interaction?.isAutocomplete === 'function' && interaction.isAutocomplete()) {
    if (interaction.commandName !== 'lfg') return false;
    return handleAutocomplete(interaction, ctx);
  }
  if (typeof interaction?.isButton === 'function' && interaction.isButton()) return handleButton(interaction, ctx);
  if (typeof interaction?.isChatInputCommand === 'function' && !interaction.isChatInputCommand()) return false;
  if (interaction.commandName !== 'lfg') return false;
  const sub = interaction.options?.getSubcommand?.() || '';
  if (sub === 'create') return handleCreate(interaction, ctx);
  if (sub === 'list') return handleList(interaction, ctx);
  if (sub === 'close') return handleClose(interaction, ctx);
  await interaction.reply(ephemeral('That fireteam command is not available.'));
  return true;
}

function shortHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

async function refreshLfgBoard(ctx, { guildId, force = false } = {}) {
  const guild = String(guildId || '');
  if (!guild) return { refreshed: false, reason: 'guild' };
  const channels = channelsFor(ctx, guild);
  const channelId = channels.fireteamFinder || channels.lfg;
  if (!channelId) return { refreshed: false, reason: 'unset' };
  const posts = ctx.lfg.listOpen(guild);
  const embed = boardEmbed(posts);
  const hash = shortHash(embed);
  const savedRoot = ctx.panelStore.read();
  const saved = savedRoot?.[guild]?.['lfg-board'] || {};
  if (!force && saved.lastHash === hash && saved.messageId && saved.channelId === channelId) {
    return { refreshed: false, reason: 'unchanged', messageId: saved.messageId };
  }
  const result = await upsertOwnedPanel(ctx.client, {
    channelId,
    messageId: saved.channelId === channelId ? saved.messageId : '',
    panelId: 'lfg-board',
    embed,
    botId: ctx.client?.user?.id
  });
  if (!result?.messageId) return { refreshed: false, reason: result?.reason || 'missing' };
  await ctx.panelStore.update((state) => {
    state[guild] ||= {};
    state[guild]['lfg-board'] = {
      channelId,
      messageId: result.messageId,
      lastHash: hash,
      updatedAt: new Date().toISOString()
    };
    return state;
  });
  return { refreshed: true, messageId: result.messageId, created: Boolean(result.created) };
}

async function refreshStatusPanel(ctx, { guildId, force = false } = {}) {
  const guild = String(guildId || '');
  if (!guild) return { refreshed: false, reason: 'guild' };
  const channels = channelsFor(ctx, guild);
  if (!snowflake(channels.staffAlerts)) return { refreshed: false, reason: 'unset' };
  const { buildStatusText } = require('../commands/status.cjs');
  const description = buildStatusText({ client: ctx.client, env: ctx.env });
  const embed = { title: 'Vanguard • Status', description };
  const hash = shortHash(embed);
  const saved = ctx.panelStore.read()?.[guild]?.status || {};
  if (!force && saved.lastHash === hash && saved.messageId && saved.channelId === channels.staffAlerts) {
    return { refreshed: false, reason: 'unchanged' };
  }
  const result = await upsertOwnedPanel(ctx.client, {
    channelId: channels.staffAlerts,
    messageId: saved.channelId === channels.staffAlerts ? saved.messageId : '',
    panelId: 'status',
    embed,
    botId: ctx.client?.user?.id
  });
  if (!result?.messageId) return { refreshed: false, reason: result?.reason || 'missing' };
  await ctx.panelStore.update((state) => {
    state[guild] ||= {};
    state[guild].status = {
      channelId: channels.staffAlerts,
      messageId: result.messageId,
      lastHash: hash,
      updatedAt: new Date().toISOString()
    };
    return state;
  });
  return { refreshed: true, messageId: result.messageId };
}

module.exports = {
  REASONS,
  lfgCommandBuilder,
  handleLfgInteraction,
  refreshLfgBoard,
  refreshStatusPanel,
  channelsFor
};
