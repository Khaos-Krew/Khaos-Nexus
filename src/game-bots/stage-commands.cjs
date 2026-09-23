'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Events, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { reportCommandFailure, errorClass, BOT_LABELS } = require('./command-failure.cjs');
const { normalizeBot } = require('./category-gate.cjs');
const { isStaff } = require('./ops-spine.cjs');
const { stageCommandNames } = require('./stage-catalog.cjs');
const { WorldstateCache } = require('./warframe-worldstate.cjs');
const { dojoChecklist } = require('./warframe-dojo.cjs');
const { parseCosmeticRoles, cosmeticPlan, cosmeticListText } = require('./warframe-cosmetics.cjs');
const { EventCalendarStore, calendarEmbed } = require('./event-calendar.cjs');
const { welcomeText } = require('./welcome-card.cjs');
const { RateCardStore, ratesText, breedText, bossText } = require('./ark-rate-cards.cjs');
const { wipeChecklist } = require('./wipe-checklist.cjs');
const { ascendedHealthSnapshot, checkRconPrefix, HEALTH_PREFIXES, openStore } = require('./ascended-rcon-health.cjs');

const INSTALLED = Symbol.for('khaos.nexus.gamebot.stageCommands');

function ephemeral(content, extra = {}) {
  return { content: String(content || '').slice(0, 1900), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] }, ...extra };
}

function stageBuilders(bot) {
  const names = new Set(stageCommandNames(bot));
  const commands = [];
  if (names.has('worldstate')) {
    commands.push(new SlashCommandBuilder().setName('worldstate').setDescription('Cetus, Orb Vallis, and Duviri cycles, plus a short invasion digest.'));
  }
  if (names.has('dojo')) {
    commands.push(new SlashCommandBuilder().setName('dojo').setDescription('Clan dojo checklist and official wiki links.'));
  }
  if (names.has('calendar')) {
    const command = new SlashCommandBuilder().setName('calendar').setDescription('Show or refresh the Warframe event calendar.');
    command.addSubcommand((sub) => sub.setName('show').setDescription('Show the pinned Warframe event.'));
    command.addSubcommand((sub) => sub.setName('set').setDescription('Staff: set the pinned event.')
      .addStringOption((option) => option.setName('title').setDescription('Event title').setRequired(true).setMaxLength(120))
      .addStringOption((option) => option.setName('when').setDescription('When it happens').setRequired(true).setMaxLength(80))
      .addStringOption((option) => option.setName('note').setDescription('Short note').setMaxLength(500)));
    command.addSubcommand((sub) => sub.setName('clear').setDescription('Staff: clear the pinned event.'));
    commands.push(command);
  }
  if (names.has('cosmetic')) {
    commands.push(new SlashCommandBuilder().setName('cosmetic').setDescription('Toggle a cosmetic Discord role. This does not change Nexus Sentinal ranks.')
      .addStringOption((option) => option.setName('role').setDescription('Allowlisted cosmetic role id').setMinLength(17).setMaxLength(20)));
  }
  if (names.has('rates')) {
    const command = new SlashCommandBuilder().setName('rates').setDescription('Show tribe rates, breed timers, and the boss checklist.');
    command.addSubcommand((sub) => sub.setName('show').setDescription('Show the current rate card.'));
    command.addSubcommand((sub) => sub.setName('breed').setDescription('Show a planning breed timer.')
      .addStringOption((option) => option.setName('creature').setDescription('Creature').setRequired(true)
        .addChoices({ name: 'Rex', value: 'rex' }, { name: 'Therizinosaur', value: 'therizino' }, { name: 'Wyvern', value: 'wyvern' })));
    command.addSubcommand((sub) => sub.setName('boss').setDescription('Show the boss checklist.'));
    command.addSubcommand((sub) => sub.setName('edit').setDescription('Staff: edit one rate-card field.')
      .addStringOption((option) => option.setName('field').setDescription('Field').setRequired(true)
        .addChoices(
          { name: 'Taming', value: 'taming' },
          { name: 'Breeding', value: 'breeding' },
          { name: 'Harvest', value: 'harvest' },
          { name: 'XP', value: 'xp' },
          { name: 'Note', value: 'note' }
        ))
      .addStringOption((option) => option.setName('value').setDescription('New value, such as 5x or a short note').setRequired(true).setMaxLength(200)));
    commands.push(command);
  }
  if (names.has('wipe')) {
    commands.push(new SlashCommandBuilder().setName('wipe').setDescription('Staff wipe and transfer checklist. Does not change the server.'));
  }
  if (names.has('welcome')) {
    commands.push(new SlashCommandBuilder().setName('welcome').setDescription('Show this bot welcome card. Wallet and ranks stay on Nexus Sentinal.'));
  }
  return commands;
}

function dataDir(env = process.env) {
  const configured = String(env.NEXUS_DATA_DIR || '').trim();
  return configured || path.resolve(__dirname, '../../data');
}

function welcomePinFile(dir, bot) {
  return path.join(dir, `${bot}-welcome-pin.json`);
}

function readWelcomePin(dir, bot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(welcomePinFile(dir, bot), 'utf8'));
    return { messageId: String(parsed.messageId || '').replace(/\D/g, '').slice(0, 20) };
  } catch {
    return { messageId: '' };
  }
}

function writeWelcomePin(dir, bot, messageId) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(welcomePinFile(dir, bot), `${JSON.stringify({ messageId: String(messageId || '').replace(/\D/g, '').slice(0, 20) })}\n`, { encoding: 'utf8', mode: 0o600 });
}

function roleIdsOf(interaction) {
  const cache = interaction.member?.roles?.cache;
  if (!cache) return [];
  if (typeof cache.keys === 'function') return [...cache.keys()].map(String);
  if (Array.isArray(cache)) return cache.map(String);
  return [];
}

async function refreshPinnedEmbed(client, env, channelEnvName, entry, embed) {
  const channelId = String(env[channelEnvName] || '').trim();
  if (!/^\d{17,20}$/.test(channelId) || typeof client?.channels?.fetch !== 'function') return { pinned: false };
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) return { pinned: false };
  if (entry?.messageId && channel.messages?.fetch) {
    const message = await channel.messages.fetch(entry.messageId).catch(() => null);
    if (message?.edit) {
      await message.edit({ embeds: [embed], allowedMentions: { parse: [] } });
      return { pinned: true, messageId: entry.messageId };
    }
  }
  const sent = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  return { pinned: true, messageId: String(sent?.id || '') };
}

async function handleStageCommand(interaction, context) {
  if (typeof interaction?.isChatInputCommand === 'function' && !interaction.isChatInputCommand()) return false;
  const name = String(interaction?.commandName || '');
  const bot = normalizeBot(context.bot);
  if (!stageCommandNames(bot).includes(name)) return false;
  const env = context.env || process.env;
  const config = context.config || loadConfig();
  const dir = dataDir(env);

  if (name === 'worldstate') {
    const cache = context.worldstate || new WorldstateCache({
      provider: context.provider || new (require('../backend/providers/warframe-provider.cjs').WarframeProvider)(),
      ttlMs: Number(env.CEPHALON_WORLDSTATE_CACHE_MS) || 60_000
    });
    const view = await cache.load();
    await interaction.reply(ephemeral(view.text));
    return true;
  }
  if (name === 'dojo') {
    await interaction.reply(ephemeral(dojoChecklist()));
    return true;
  }
  if (name === 'welcome') {
    await interaction.reply(ephemeral(welcomeText(bot)));
    if (isStaff(interaction, config)) {
      const channelEnv = bot === 'ascended' ? 'ASCENDED_WELCOME_CHANNEL_ID' : 'CEPHALON_WELCOME_CHANNEL_ID';
      const pin = readWelcomePin(dir, bot);
      const pinned = await refreshPinnedEmbed(context.client || interaction.client, env, channelEnv, pin, {
        title: bot === 'ascended' ? 'Welcome to Nexus Ascended' : 'Welcome to Cephalon Nexus',
        description: welcomeText(bot)
      }).catch(() => null);
      if (pinned?.messageId) writeWelcomePin(dir, bot, pinned.messageId);
    }
    return true;
  }
  if (name === 'cosmetic') {
    const roles = parseCosmeticRoles(env);
    const requested = interaction.options?.getString?.('role');
    if (!requested) {
      await interaction.reply(ephemeral(cosmeticListText(roles)));
      return true;
    }
    const plan = cosmeticPlan(roles, roleIdsOf(interaction), requested);
    if (!plan.ok) {
      await interaction.reply(ephemeral('That role is not a Warframe cosmetic. Nexus Sentinal ranks were not changed.'));
      return true;
    }
    if (plan.action === 'add') await interaction.member.roles.add(plan.roleId);
    else await interaction.member.roles.remove(plan.roleId);
    await interaction.reply(ephemeral(`${plan.action === 'add' ? 'Added' : 'Removed'} **${plan.label}**. This is a Discord cosmetic and does not change Nexus Sentinal ranks.`));
    return true;
  }
  if (name === 'calendar') {
    const store = context.calendar || new EventCalendarStore(dir);
    const sub = interaction.options?.getSubcommand?.() || 'show';
    if (sub !== 'show' && !isStaff(interaction, config)) {
      await interaction.reply(ephemeral('The event calendar can only be changed by Nexus staff.'));
      return true;
    }
    if (sub === 'clear') store.clear(interaction.user?.id);
    if (sub === 'set') {
      store.write({
        title: interaction.options.getString('title', true),
        when: interaction.options.getString('when', true),
        note: interaction.options.getString('note') || '',
        updatedBy: interaction.user?.id,
        messageId: store.read().messageId
      });
    }
    const entry = store.read();
    const embed = calendarEmbed(entry);
    if (isStaff(interaction, config) && entry.title) {
      const pinned = await refreshPinnedEmbed(context.client || interaction.client, env, 'CEPHALON_EVENT_CHANNEL_ID', entry, embed).catch(() => ({ pinned: false }));
      if (pinned?.messageId && pinned.messageId !== entry.messageId) store.write({ ...entry, messageId: pinned.messageId });
    }
    await interaction.reply({ ...ephemeral(entry.title ? `${entry.title}\n${entry.when}` : 'No Warframe event is pinned.'), embeds: [embed] });
    return true;
  }
  if (name === 'rates') {
    const store = context.rates || new RateCardStore(dir);
    const sub = interaction.options?.getSubcommand?.() || 'show';
    if (sub === 'edit') {
      if (!isStaff(interaction, config)) {
        await interaction.reply(ephemeral('Rate card edits are restricted to Nexus staff.'));
        return true;
      }
      const field = interaction.options.getString('field', true);
      const value = interaction.options.getString('value', true);
      const card = store.read();
      if (field === 'note') card.note = value;
      else card[field] = value;
      const saved = store.write(card);
      await interaction.reply(ephemeral(ratesText(saved)));
      return true;
    }
    const card = store.read();
    if (sub === 'boss') await interaction.reply(ephemeral(bossText()));
    else if (sub === 'breed') await interaction.reply(ephemeral(breedText(card, interaction.options.getString('creature', true))));
    else await interaction.reply(ephemeral(ratesText(card)));
    return true;
  }
  if (name === 'wipe') {
    if (!isStaff(interaction, config)) {
      await interaction.reply(ephemeral('The wipe checklist is restricted to Nexus staff.'));
      return true;
    }
    let snapshot = typeof context.healthSnapshot === 'function' ? context.healthSnapshot() : ascendedHealthSnapshot();
    if (!snapshot.length && context.checkHealth !== false) {
      const store = openStore(env);
      const rows = [];
      for (const prefix of HEALTH_PREFIXES) {
        const result = await checkRconPrefix(prefix, { store, env });
        rows.push(result.row);
      }
      snapshot = rows;
    }
    await interaction.reply(ephemeral(wipeChecklist(snapshot)));
    return true;
  }
  return false;
}

async function registerStageCommands(client, bot, env = process.env, options = {}) {
  const builders = stageBuilders(bot);
  if (!builders.length) return { registered: false, reason: 'none' };
  const config = options.config || loadConfig();
  const guildId = String(config?.discord?.guildId || env.NEXUS_DISCORD_GUILD_ID || env.DISCORD_GUILD_ID || '').trim();
  if (!guildId) return { registered: false, reason: 'guild-missing' };
  const guild = await client.guilds.fetch(guildId);
  const commands = await guild.commands.fetch();
  for (const builder of builders) {
    const definition = builder.toJSON();
    const existing = commands.find((item) => item.name === definition.name);
    if (existing) await guild.commands.edit(existing, definition);
    else await guild.commands.create(definition);
  }
  console.log(`[${BOT_LABELS[bot]}] registered stage commands ${stageCommandNames(bot).map((name) => `/${name}`).join(', ')}`);
  return { registered: true };
}

function installStageCommands(client, { bot, env = process.env, config, provider, worldstate, calendar, rates, healthSnapshot } = {}) {
  const key = normalizeBot(bot);
  if (!client || client[INSTALLED] || !key) return client;
  client[INSTALLED] = true;
  const context = { bot: key, env, config, client, provider, worldstate, calendar, rates, healthSnapshot };
  client.on(Events.InteractionCreate, (interaction) => {
    void handleStageCommand(interaction, context).catch((error) => reportCommandFailure(interaction, error, { bot: key, botName: BOT_LABELS[key], env }));
  });
  client.once(Events.ClientReady, () => {
    void registerStageCommands(client, key, env, { config }).catch((error) => {
      console.warn(`[${BOT_LABELS[key]}] stage command registration failed: class=${errorClass(error)}`);
    });
  });
  return client;
}

module.exports = {
  stageBuilders,
  handleStageCommand,
  registerStageCommands,
  installStageCommands,
  refreshPinnedEmbed
};
