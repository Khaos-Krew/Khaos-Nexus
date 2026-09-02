'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  ActionRowBuilder,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');

const INSTALLED = Symbol.for('khaos.nexus.guide.extension');
const BOUND = Symbol.for('khaos.nexus.guide.bound');
const GUIDE_CUSTOM_ID = 'nexusguide:topic';
const GUIDE_CHANNEL_NAME = 'nexus-guide';
const GUIDE_CONFIG_PATH = path.resolve(__dirname, '../../config/discord/nexus-guide.json');
const FORBIDDEN_PUBLIC_PATTERNS = [
  /dino\s*caches?/i,
  /nexus\s*anomal(?:y|ies)/i
];

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function loadGuideConfig(filePath = GUIDE_CONFIG_PATH) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  validateGuideConfig(parsed);
  return parsed;
}

function validateGuideConfig(guide) {
  if (!guide || typeof guide !== 'object') throw new Error('Nexus guide config must be an object.');
  if (Number(guide.schemaVersion) !== 1) throw new Error('Nexus guide schemaVersion must be 1.');
  if (!String(guide.title || '').trim()) throw new Error('Nexus guide title is required.');
  if (!String(guide.description || '').trim()) throw new Error('Nexus guide description is required.');
  if (!Array.isArray(guide.topics) || guide.topics.length < 1) throw new Error('Nexus guide must contain at least one topic.');
  if (guide.topics.length > 25) throw new Error('Nexus guide cannot exceed Discord select-menu limit of 25 topics.');

  const ids = new Set();
  for (const topic of guide.topics) {
    const id = String(topic?.id || '').trim();
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(id)) throw new Error(`Invalid Nexus guide topic id: ${id || '<missing>'}`);
    if (ids.has(id)) throw new Error(`Duplicate Nexus guide topic id: ${id}`);
    ids.add(id);
    if (!String(topic.label || '').trim()) throw new Error(`Nexus guide topic ${id} requires a label.`);
    if (!String(topic.summary || '').trim()) throw new Error(`Nexus guide topic ${id} requires a summary.`);
    if (!Array.isArray(topic.details) || !topic.details.length || topic.details.some((item) => !String(item || '').trim())) {
      throw new Error(`Nexus guide topic ${id} requires non-empty details.`);
    }
  }

  const publicText = JSON.stringify(guide);
  for (const pattern of FORBIDDEN_PUBLIC_PATTERNS) {
    if (pattern.test(publicText)) throw new Error(`Nexus guide contains a feature that is not approved for public documentation: ${pattern}`);
  }
  return true;
}

function buildGuideOverviewEmbed(guide) {
  const topics = guide.topics.map((topic) => `${topic.emoji || '•'} **${topic.label}** — ${topic.summary}`).join('\n');
  return new EmbedBuilder()
    .setTitle(String(guide.title).slice(0, 256))
    .setDescription(String(guide.description).slice(0, 4096))
    .addFields({ name: 'Choose a topic', value: topics.slice(0, 1024) })
    .setFooter({ text: 'Nexus Sentinal • Player Guide' });
}

function buildTopicEmbed(topic) {
  const body = topic.details.map((item) => `• ${String(item).trim()}`).join('\n\n');
  return new EmbedBuilder()
    .setTitle(`${topic.emoji || '📘'} ${String(topic.label).slice(0, 240)}`)
    .setDescription(body.slice(0, 4096))
    .setFooter({ text: 'Nexus Sentinal • /guide' });
}

function buildGuideComponents(guide, selectedId = '') {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(GUIDE_CUSTOM_ID)
    .setPlaceholder('Choose a Nexus guide topic')
    .setMinValues(1)
    .setMaxValues(1);

  for (const topic of guide.topics) {
    const option = new StringSelectMenuOptionBuilder()
      .setLabel(String(topic.label).slice(0, 100))
      .setValue(String(topic.id))
      .setDescription(String(topic.summary).slice(0, 100));
    if (topic.emoji) option.setEmoji(String(topic.emoji));
    if (selectedId && topic.id === selectedId) option.setDefault(true);
    menu.addOptions(option);
  }
  return [new ActionRowBuilder().addComponents(menu)];
}

function findCategory(guild, names = ['information', 'info']) {
  const wanted = new Set(names.map(normalizeName));
  return guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && wanted.has(normalizeName(channel.name))) || null;
}

async function ensureInformationCategory(guild) {
  const existing = findCategory(guild);
  if (existing) return existing;
  return guild.channels.create({ name: 'Information', type: ChannelType.GuildCategory, reason: 'Nexus Guide Hub' });
}

function publicReadOnlyOverwrites(guild) {
  return [{
    id: guild.roles.everyone.id,
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
    deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads]
  }];
}

async function resolveGuideChannel(guild, env = process.env) {
  const configuredId = String(env.NEXUS_GUIDE_CHANNEL_ID || '').trim();
  if (configuredId) {
    try {
      const configured = await guild.channels.fetch(configuredId);
      if (configured?.isTextBased?.()) return configured;
    } catch (error) {
      console.warn(`[Nexus Sentinal] configured Nexus guide channel unavailable: ${String(error?.message || error).slice(0, 180)}`);
    }
  }

  const existing = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildText && normalizeName(channel.name) === GUIDE_CHANNEL_NAME);
  if (existing) return existing;
  const category = await ensureInformationCategory(guild);
  return guild.channels.create({
    name: GUIDE_CHANNEL_NAME,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: 'Start here for Khaos Nexus player guides and currently supported systems.',
    permissionOverwrites: publicReadOnlyOverwrites(guild),
    reason: 'Nexus Guide Hub'
  });
}

async function upsertGuidePanel(channel, clientUserId, guide) {
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const botMessages = messages ? [...messages.values()].filter((message) => message.author?.id === clientUserId) : [];
  const panelCandidates = botMessages.filter((message) => {
    if (message.components?.some((row) => row.components?.some((component) => component.customId === GUIDE_CUSTOM_ID))) return true;
    return message.embeds?.some((embed) => String(embed.title || '').includes('Khaos Nexus Guide'));
  });

  const payload = { embeds: [buildGuideOverviewEmbed(guide)], components: buildGuideComponents(guide) };
  const primary = panelCandidates.sort((a, b) => a.createdTimestamp - b.createdTimestamp)[0];
  let panel;
  if (primary) panel = await primary.edit(payload);
  else panel = await channel.send(payload);

  for (const duplicate of panelCandidates) {
    if (duplicate.id === panel.id) continue;
    await duplicate.delete().catch(() => {});
  }
  return panel;
}

async function ensureGuideCommand(guild) {
  const commands = await guild.commands.fetch();
  const existing = commands.find((command) => command.name === 'guide');
  const desired = { name: 'guide', description: 'Open the Khaos Nexus player guide' };
  if (!existing) return guild.commands.create(desired);
  if (existing.description !== desired.description || existing.options?.length) return existing.edit(desired);
  return existing;
}

async function reconcileGuide(client, config = loadConfig()) {
  const guildId = String(config.discord?.guildId || '').trim();
  if (!guildId) throw new Error('Discord guild ID is not configured.');
  const guild = await client.guilds.fetch(guildId);
  await guild.channels.fetch();
  const guide = loadGuideConfig();
  const channel = await resolveGuideChannel(guild);
  await upsertGuidePanel(channel, client.user.id, guide);
  await ensureGuideCommand(guild);
  console.log(`[Nexus Sentinal] Nexus Guide Hub ready channel=#${channel.name} topics=${guide.topics.length}`);
  return { guild, channel, guide };
}

async function handleGuideInteraction(interaction) {
  const isGuideCommand = interaction.isChatInputCommand?.() && interaction.commandName === 'guide';
  const isGuideSelect = interaction.isStringSelectMenu?.() && interaction.customId === GUIDE_CUSTOM_ID;
  if (!isGuideCommand && !isGuideSelect) return false;

  try {
    const guide = loadGuideConfig();
    if (isGuideCommand) {
      await interaction.reply({
        embeds: [buildGuideOverviewEmbed(guide)],
        components: buildGuideComponents(guide),
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const selectedId = String(interaction.values?.[0] || '');
    const topic = guide.topics.find((item) => item.id === selectedId);
    if (!topic) {
      await interaction.reply({ content: 'That guide topic is no longer available. Run `/guide` to refresh.', flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.reply({
      embeds: [buildTopicEmbed(topic)],
      components: buildGuideComponents(guide, topic.id),
      flags: MessageFlags.Ephemeral
    });
    return true;
  } catch (error) {
    console.warn(`[Nexus Sentinal] Nexus guide interaction failed: ${String(error?.message || error).slice(0, 300)}`);
    const payload = { content: 'The Nexus Guide is temporarily unavailable. Please try again shortly.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
    return true;
  }
}

function installNexusGuideExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;
  const config = loadConfig();

  Client.prototype.login = function nexusGuideLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      client.on(Events.InteractionCreate, (interaction) => void handleGuideInteraction(interaction));
      client.once(Events.ClientReady, () => {
        void reconcileGuide(client, config).catch((error) => {
          console.warn(`[Nexus Sentinal] Nexus Guide Hub reconcile failed: ${String(error?.message || error).slice(0, 300)}`);
        });
      });
    }
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  GUIDE_CONFIG_PATH,
  GUIDE_CUSTOM_ID,
  loadGuideConfig,
  validateGuideConfig,
  buildGuideOverviewEmbed,
  buildTopicEmbed,
  buildGuideComponents,
  reconcileGuide,
  handleGuideInteraction,
  installNexusGuideExtension
};
