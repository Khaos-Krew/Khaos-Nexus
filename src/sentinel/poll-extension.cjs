'use strict';

const { Client, Events, MessageFlags } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { PollEngine } = require('../backend/services/poll-engine.cjs');
const { PollStore } = require('../backend/services/poll-store.cjs');
const {
  ensurePollsChannel,
  isAuthorizedPollManager,
  isManagedPollCard,
  parsePollCustomId,
  pollCommand,
  pollInputFromInteraction,
  pollStatusText,
  renderPollCard,
  roleIdsFromMember
} = require('./poll-ui.cjs');

const INSTALLED = Symbol.for('khaos.nexus.poll.extension');
const BOUND = Symbol.for('khaos.nexus.poll.bound');
const INITIAL_DELAY_MS = 90_000;
const TICK_MS = 60_000;

function ephemeral(content) {
  return { content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

async function registerPollCommand(guild) {
  const definition = pollCommand().toJSON();
  const commands = await guild.commands.fetch();
  const existing = commands.find((command) => command.name === definition.name);
  if (existing) await guild.commands.edit(existing, definition);
  else await guild.commands.create(definition);
  return definition.name;
}

async function findPollMessage(client, channel, poll) {
  if (poll.messageId) {
    const direct = await channel.messages.fetch(String(poll.messageId)).catch(() => null);
    if (direct) return direct;
  }
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  return recent?.find?.((message) => isManagedPollCard(message, poll.id, client.user?.id)) || null;
}

async function reconcilePollCard(client, channel, engine, pollId) {
  const poll = engine.get(pollId, { includeVotes: true });
  if (!poll) return { skipped: 'missing-poll' };
  let message = await findPollMessage(client, channel, poll);
  let created = false;
  if (message) await message.edit(renderPollCard(poll));
  else {
    message = await channel.send(renderPollCard(poll));
    created = true;
  }
  if (String(poll.channelId || '') !== String(channel.id) || String(poll.messageId || '') !== String(message.id)) {
    engine.store.update(poll.id, (record) => {
      record.channelId = String(channel.id);
      record.messageId = String(message.id);
      record.updatedAt = new Date().toISOString();
      return record;
    });
  }
  return { message, created, poll: engine.get(poll.id, { includeVotes: true }) };
}

async function reconcilePollCards(client, channel, engine, statuses = ['scheduled', 'open']) {
  let created = 0;
  let updated = 0;
  for (const poll of engine.list({ statuses, includeVotes: true })) {
    const result = await reconcilePollCard(client, channel, engine, poll.id);
    if (result.created) created += 1; else if (!result.skipped) updated += 1;
  }
  return { created, updated };
}

function voterFromInteraction(interaction) {
  return {
    id: String(interaction.user?.id || ''),
    bot: Boolean(interaction.user?.bot),
    roleIds: roleIdsFromMember(interaction.member)
  };
}

function requireManager(interaction, config) {
  if (!isAuthorizedPollManager(interaction.member, config, interaction.guild)) {
    throw new Error('Poll creation and management require Nexus staff authorization.');
  }
}

async function handlePollCommand(interaction, context) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'poll') return false;
  const { engine, channel, config } = context;
  const subcommand = interaction.options.getSubcommand();
  if (['create', 'close', 'cancel', 'audit'].includes(subcommand)) requireManager(interaction, config);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (subcommand === 'create') {
    const poll = engine.create({ ...pollInputFromInteraction(interaction), channelId: String(channel.id) });
    const card = await reconcilePollCard(interaction.client, channel, engine, poll.id);
    await interaction.editReply({ content: `✅ Created **${poll.id}** in <#${channel.id}>.`, allowedMentions: { parse: [] } });
    return { handled: true, poll: card.poll };
  }

  const id = String(interaction.options.getString('id') || '').toUpperCase();
  if (subcommand === 'status') {
    const poll = engine.get(id, { includeVotes: false });
    if (!poll) throw new Error(`Poll ${id} does not exist.`);
    await interaction.editReply({ content: pollStatusText(poll), allowedMentions: { parse: [] } });
  } else if (subcommand === 'results') {
    const poll = engine.get(id, { includeVotes: true });
    if (!poll) throw new Error(`Poll ${id} does not exist.`);
    const authorized = isAuthorizedPollManager(interaction.member, config, interaction.guild);
    const result = engine.results(id, { authorized });
    if (result?.hidden) await interaction.editReply({ content: `${id} results are hidden until the poll closes.`, allowedMentions: { parse: [] } });
    else await interaction.editReply(renderPollCard(poll));
  } else if (subcommand === 'close') {
    const poll = await engine.close(id, String(interaction.user.id));
    await reconcilePollCard(interaction.client, channel, engine, id);
    await interaction.editReply({ content: `✅ ${pollStatusText(poll)}`, allowedMentions: { parse: [] } });
  } else if (subcommand === 'cancel') {
    const poll = engine.cancel(id, String(interaction.user.id), interaction.options.getString('reason') || '');
    await reconcilePollCard(interaction.client, channel, engine, id);
    await interaction.editReply({ content: `✅ ${pollStatusText(poll)}`, allowedMentions: { parse: [] } });
  } else if (subcommand === 'audit') {
    const poll = engine.get(id, { includeVotes: false });
    if (!poll) throw new Error(`Poll ${id} does not exist.`);
    const lines = (poll.audit || []).slice(-20).map((entry) => `• <t:${Math.floor(Date.parse(entry.at) / 1000)}:f> — ${entry.action}${entry.actorId ? ` by ${entry.actorId === 'scheduler' ? 'scheduler' : `<@${entry.actorId}>`}` : ''}${entry.minutes ? ` (${entry.minutes}m)` : ''}`);
    await interaction.editReply({ content: `**${poll.id} administrative audit**\nSource: ${poll.source || 'manual'}${poll.sourceLink ? ` • ${poll.sourceLink}` : ''}\nStatus: ${poll.status} • ${(poll.audit || []).length} lifecycle entries\n\n${lines.join('\n') || 'No audit entries.'}`.slice(0, 1900), allowedMentions: { parse: [] } });
  } else if (subcommand === 'list') {
    const status = interaction.options.getString('status');
    const polls = engine.list({ ...(status ? { statuses: [status] } : {}), limit: 20 });
    await interaction.editReply({ content: polls.length ? polls.map((poll) => pollStatusText(poll)).join('\n\n').slice(0, 1900) : 'No matching managed polls.', allowedMentions: { parse: [] } });
  }
  return { handled: true };
}

async function handlePollComponent(interaction, context) {
  if (!interaction.isButton?.() && !interaction.isStringSelectMenu?.()) return false;
  const parsed = parsePollCustomId(interaction.customId);
  if (!parsed) return false;
  const { engine, channel } = context;
  const choices = parsed.action === 'select' ? interaction.values : parsed.optionIds;
  let poll;
  if (parsed.action === 'remove') poll = engine.removeVote(parsed.pollId, voterFromInteraction(interaction));
  else poll = engine.castVote(parsed.pollId, voterFromInteraction(interaction), choices);
  await reconcilePollCard(interaction.client, channel, engine, parsed.pollId);
  const action = parsed.action === 'remove' ? 'removed' : 'recorded';
  await interaction.reply(ephemeral(`✅ Your vote in **${poll.id}** was ${action}. You can change it while the poll remains open.`));
  return { handled: true, poll };
}

async function handlePollInteraction(interaction, context) {
  try {
    if (await handlePollCommand(interaction, context)) return true;
    return Boolean(await handlePollComponent(interaction, context));
  } catch (error) {
    const payload = ephemeral(`⚠️ ${String(error?.message || error).slice(0, 1700)}`);
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: payload.content, embeds: [], components: [], allowedMentions: payload.allowedMentions }).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
    return true;
  }
}

async function pollTick(client, channel, engine) {
  const result = await engine.tick();
  for (const id of [...result.opened, ...result.closed]) await reconcilePollCard(client, channel, engine, id);
  for (const reminder of result.reminders || []) {
    const poll = engine.get(reminder.id, { includeVotes: false });
    if (poll) await channel.send({ content: `⏰ **${poll.id}** closes <t:${Math.floor(Date.parse(poll.closesAt) / 1000)}:R>. Cast or update your vote on the managed card above.`, allowedMentions: { parse: [] } });
  }
  return result;
}

function installPollExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const engine = new PollEngine({ store: new PollStore() });
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusPollLogin(...args) {
    const client = this;
    let channel = null;
    if (!client[BOUND]) {
      client[BOUND] = true;
      client.on(Events.InteractionCreate, (interaction) => {
        if (!channel || String(interaction.guildId || '') !== String(config.discord?.guildId || '')) return;
        void handlePollInteraction(interaction, { engine, channel, config });
      });
    }
    client.once(Events.ClientReady, () => {
      const run = async (reason) => {
        const guild = await client.guilds.fetch(String(config.discord?.guildId || ''));
        const channelResult = await ensurePollsChannel(guild, config, client.user?.id);
        if (channelResult.skipped) throw new Error(channelResult.skipped);
        channel = channelResult.channel;
        const command = await registerPollCommand(guild);
        const tick = await pollTick(client, channel, engine);
        const cards = await reconcilePollCards(client, channel, engine);
        console.log(`[Nexus Sentinal] polls (${reason}): channel=${channel.id} channelCreated=${channelResult.created} command=/${command} opened=${tick.opened.length} closed=${tick.closed.length} cardsCreated=${cards.created} cardsUpdated=${cards.updated}`);
      };
      const initial = setTimeout(() => void run('startup').catch((error) => console.warn(`[Nexus Sentinal] polls unavailable: ${String(error?.message || error).slice(0, 240)}`)), INITIAL_DELAY_MS);
      initial.unref?.();
      const periodic = setInterval(() => {
        if (channel) void pollTick(client, channel, engine).catch((error) => console.warn(`[Nexus Sentinal] poll scheduler unavailable: ${String(error?.message || error).slice(0, 240)}`));
      }, TICK_MS);
      periodic.unref?.();
    });
    return originalLogin.apply(client, args);
  };
}

module.exports = {
  INITIAL_DELAY_MS,
  TICK_MS,
  ephemeral,
  findPollMessage,
  handlePollCommand,
  handlePollComponent,
  handlePollInteraction,
  installPollExtension,
  pollTick,
  reconcilePollCard,
  reconcilePollCards,
  registerPollCommand,
  requireManager,
  voterFromInteraction
};
