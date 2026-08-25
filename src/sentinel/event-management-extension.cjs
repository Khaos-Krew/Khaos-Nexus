'use strict';

const { ChannelType, Client, Events, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { EventManager, EventStore } = require('../backend/services/event-manager.cjs');
const { PollEngine } = require('../backend/services/poll-engine.cjs');
const { PollStore } = require('../backend/services/poll-store.cjs');
const { ensurePollsChannel, isAuthorizedPollManager, overwriteSatisfies, parseOptionList } = require('./poll-ui.cjs');
const { reconcilePollCard } = require('./poll-extension.cjs');
const { findHqCategory, normalizedName } = require('./nexus-hq.cjs');

const INSTALLED = Symbol.for('khaos.nexus.event.management.extension');
const BOUND = Symbol.for('khaos.nexus.event.management.bound');
const CHANNEL_NAME = 'events';
const CHANNEL_TOPIC = 'Official Khaos Nexus events, schedules, locations, and status updates.';
const CARD_PREFIX = 'Nexus Sentinal • Managed Event • ';
const INITIAL_DELAY_MS = 120_000;

function eventCommand() {
  const command = new SlashCommandBuilder().setName('event').setDescription('Create and manage official Nexus events.');
  command.addSubcommand((sub) => sub.setName('create').setDescription('Create an official event.')
    .addStringOption((option) => option.setName('title').setDescription('Event title.').setRequired(true).setMaxLength(180))
    .addStringOption((option) => option.setName('start_at').setDescription('ISO date/time including timezone, e.g. 2026-09-01T19:00-05:00.').setRequired(true).setMaxLength(80))
    .addStringOption((option) => option.setName('description').setDescription('What members should expect.').setMaxLength(1800))
    .addStringOption((option) => option.setName('location').setDescription('Discord channel, game server, or venue.').setMaxLength(200))
    .addStringOption((option) => option.setName('end_at').setDescription('Optional ISO end date/time including timezone.').setMaxLength(80))
    .addStringOption((option) => option.setName('schedule_options').setDescription('Optional time choices separated by semicolons.').setMaxLength(1000)));
  for (const [name, description] of [['status', 'Show an event.'], ['schedule', 'Set the final event time.'], ['cancel', 'Cancel an event.'], ['complete', 'Mark an event complete.']]) {
    command.addSubcommand((sub) => {
      sub.setName(name).setDescription(description).addStringOption((option) => option.setName('id').setDescription('Event ID, e.g. EVENT-0042.').setRequired(true).setMaxLength(20));
      if (name === 'schedule') sub.addStringOption((option) => option.setName('start_at').setDescription('ISO date/time including timezone.').setRequired(true).setMaxLength(80));
      if (name === 'cancel') sub.addStringOption((option) => option.setName('reason').setDescription('Reason for cancellation.').setMaxLength(500));
      return sub;
    });
  }
  command.addSubcommand((sub) => sub.setName('list').setDescription('List upcoming or recent events.')
    .addStringOption((option) => option.setName('status').setDescription('Optional lifecycle filter.').addChoices(
      { name: 'Draft', value: 'draft' }, { name: 'Scheduled', value: 'scheduled' },
      { name: 'Cancelled', value: 'cancelled' }, { name: 'Completed', value: 'completed' }
    )));
  return command;
}

async function registerEventCommand(guild) {
  const definition = eventCommand().toJSON();
  const commands = await guild.commands.fetch();
  const existing = commands.find((command) => command.name === definition.name);
  if (existing) await guild.commands.edit(existing, definition); else await guild.commands.create(definition);
  return definition.name;
}

async function ensureEventsChannel(guild) {
  const channels = await guild.channels.fetch();
  const hq = findHqCategory(channels);
  if (!hq) return { skipped: 'nexus-hq-missing' };
  const values = channels?.values ? [...channels.values()] : [];
  let channel = values.find((item) => item?.type === ChannelType.GuildText && normalizedName(item.name) === CHANNEL_NAME && String(item.parentId || '') === String(hq.id));
  let created = false;
  if (!channel) {
    channel = await guild.channels.create({ name: CHANNEL_NAME, type: ChannelType.GuildText, parent: hq.id, topic: CHANNEL_TOPIC, reason: 'Nexus Sentinal managed event surface' });
    created = true;
  }
  if (String(channel.topic || '') !== CHANNEL_TOPIC && channel.setTopic) await channel.setTopic(CHANNEL_TOPIC, 'Nexus Sentinal event channel purpose');
  if (!created && channel.permissionsLocked !== true && channel.lockPermissions) await channel.lockPermissions('Nexus Sentinal inherit Nexus HQ access for events').catch(() => {});
  const postingPlan = { deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads] };
  if (channel.permissionOverwrites?.edit && !overwriteSatisfies(channel, guild.roles.everyone.id, postingPlan)) {
    await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false, CreatePublicThreads: false, CreatePrivateThreads: false }, { reason: 'Official events are bot-published' });
  }
  return { channel, created };
}

function eventStatus(event) {
  const when = Math.floor(Date.parse(event.startAt) / 1000);
  return `**${event.id}** — ${event.title}\n${String(event.status).toUpperCase()} • <t:${when}:F> (<t:${when}:R>)`;
}

function renderEventCard(event) {
  const when = Math.floor(Date.parse(event.startAt) / 1000);
  const fields = [
    { name: 'Status', value: String(event.status).toUpperCase(), inline: true },
    { name: 'Starts', value: `<t:${when}:F>\n<t:${when}:R>`, inline: true },
    { name: 'Location', value: event.location || 'Discord', inline: true }
  ];
  if (event.endAt) fields.push({ name: 'Ends', value: `<t:${Math.floor(Date.parse(event.endAt) / 1000)}:F>`, inline: true });
  if (event.pollId) fields.push({ name: 'Scheduling Poll', value: `**${event.pollId}** — vote in #polls`, inline: true });
  if (event.cancelReason) fields.push({ name: 'Cancellation', value: event.cancelReason, inline: false });
  return { embeds: [{ title: event.title, description: event.description || 'Official Khaos Nexus event.', color: event.status === 'cancelled' ? 0x992d22 : event.status === 'completed' ? 0x2ecc71 : 0x5865f2, fields, footer: { text: `${CARD_PREFIX}${event.id}` }, timestamp: event.updatedAt }], allowedMentions: { parse: [] } };
}

async function reconcileEventCard(client, channel, manager, id) {
  const event = manager.store.get(id);
  if (!event) return { skipped: 'missing-event' };
  let message = event.messageId ? await channel.messages.fetch(String(event.messageId)).catch(() => null) : null;
  if (!message) {
    const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    message = recent?.find?.((candidate) => String(candidate.author?.id || '') === String(client.user?.id || '') && (candidate.embeds || []).some((embed) => embed?.footer?.text === `${CARD_PREFIX}${event.id}`)) || null;
  }
  const created = !message;
  message = message ? await message.edit(renderEventCard(event)) : await channel.send(renderEventCard(event));
  if (String(event.channelId || '') !== String(channel.id) || String(event.messageId || '') !== String(message.id)) manager.linkMessage(event.id, channel.id, message.id);
  return { created, message, event: manager.store.get(id) };
}

function requireEventManager(interaction, config) {
  if (!isAuthorizedPollManager(interaction.member, config, interaction.guild)) throw new Error('Event management requires Nexus staff authorization.');
}

async function handleEventCommand(interaction, context) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'event') return false;
  requireEventManager(interaction, context.config);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const subcommand = interaction.options.getSubcommand();
  let event;
  if (subcommand === 'create') {
    const scheduleOptions = parseOptionList(interaction.options.getString('schedule_options') || '');
    event = context.manager.create({ title: interaction.options.getString('title', true), startAt: interaction.options.getString('start_at', true), endAt: interaction.options.getString('end_at') || '', description: interaction.options.getString('description') || '', location: interaction.options.getString('location') || 'Discord', scheduleOptions, hostId: interaction.user.id, guildId: interaction.guildId, channelId: context.pollChannel.id });
    await reconcileEventCard(interaction.client, context.channel, context.manager, event.id);
    if (event.pollId) await reconcilePollCard(interaction.client, context.pollChannel, context.pollEngine, event.pollId);
    await interaction.editReply({ content: `✅ Created **${event.id}** in <#${context.channel.id}>${event.pollId ? ` with scheduling poll **${event.pollId}**` : ''}.`, allowedMentions: { parse: [] } });
    return { handled: true, event };
  }
  const id = String(interaction.options.getString('id') || '').toUpperCase();
  if (subcommand === 'status') event = context.manager.store.get(id);
  else if (subcommand === 'schedule') event = context.manager.schedule(id, interaction.options.getString('start_at', true), interaction.user.id);
  else if (subcommand === 'cancel') event = context.manager.cancel(id, interaction.user.id, interaction.options.getString('reason') || '');
  else if (subcommand === 'complete') event = context.manager.complete(id, interaction.user.id);
  else if (subcommand === 'list') {
    const status = interaction.options.getString('status');
    const events = context.manager.store.list({ ...(status ? { statuses: [status] } : {}), limit: 20 });
    await interaction.editReply({ content: events.length ? events.map(eventStatus).join('\n\n').slice(0, 1900) : 'No matching managed events.', allowedMentions: { parse: [] } });
    return { handled: true };
  }
  if (!event) throw new Error(`${id} does not exist.`);
  if (subcommand !== 'status') await reconcileEventCard(interaction.client, context.channel, context.manager, event.id);
  await interaction.editReply({ content: eventStatus(event), allowedMentions: { parse: [] } });
  return { handled: true, event };
}

function installEventManagementExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const pollEngine = new PollEngine({ store: new PollStore() });
  const manager = new EventManager({ store: new EventStore(), pollEngine });
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusEventManagementLogin(...args) {
    const client = this;
    let context = null;
    if (!client[BOUND]) {
      client[BOUND] = true;
      client.on(Events.InteractionCreate, (interaction) => {
        if (!context || String(interaction.guildId || '') !== String(config.discord?.guildId || '')) return;
        void handleEventCommand(interaction, context).catch(async (error) => {
          const payload = { content: `⚠️ ${String(error?.message || error).slice(0, 1700)}`, allowedMentions: { parse: [] } };
          if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {}); else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
        });
      });
    }
    client.once(Events.ClientReady, () => {
      const timer = setTimeout(() => void (async () => {
        const guild = await client.guilds.fetch(String(config.discord?.guildId || ''));
        const [eventResult, pollResult] = await Promise.all([ensureEventsChannel(guild), ensurePollsChannel(guild, config, client.user?.id)]);
        if (eventResult.skipped || pollResult.skipped) throw new Error(eventResult.skipped || pollResult.skipped);
        context = { manager, pollEngine, channel: eventResult.channel, pollChannel: pollResult.channel, config };
        const command = await registerEventCommand(guild);
        let created = 0;
        for (const event of manager.store.list({ statuses: ['draft', 'scheduled'] })) if ((await reconcileEventCard(client, context.channel, manager, event.id)).created) created += 1;
        console.log(`[Nexus Sentinal] events: channel=${context.channel.id} channelCreated=${eventResult.created} command=/${command} active=${manager.store.list({ statuses: ['draft', 'scheduled'] }).length} cardsCreated=${created}`);
      })().catch((error) => console.warn(`[Nexus Sentinal] events unavailable: ${String(error?.message || error).slice(0, 240)}`)), INITIAL_DELAY_MS);
      timer.unref?.();
    });
    return originalLogin.apply(client, args);
  };
}

module.exports = { CARD_PREFIX, CHANNEL_NAME, ensureEventsChannel, eventCommand, eventStatus, handleEventCommand, installEventManagementExtension, reconcileEventCard, registerEventCommand, renderEventCard, requireEventManager };
