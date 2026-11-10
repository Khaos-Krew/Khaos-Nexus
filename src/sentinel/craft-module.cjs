'use strict';

const { Events, MessageFlags } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { categoryIdForInteraction } = require('../game-bots/category-gate.cjs');
const { errorClass } = require('../game-bots/command-failure.cjs');
const { craftIsStaff, decideCategory } = require('../craft/access.cjs');
const { craftCommands, handleCraftInteraction, listingPayload, notifyOwner, startStatusLoop, statusLoopHoldReason } = require('../craft/bot.cjs');
const { seedCraftFiles, seedStatusServers } = require('../craft/seed.cjs');
const { redactSecret } = require('../craft/protocol.cjs');
const { openCraftStore } = require('../craft/store.cjs');
const { installMcEconomyLoops } = require('../craft/mc-points-commands.cjs');
const { claimMinecraftStarter, openMinecraftShop } = require('./mc-shop-ui-extension.cjs');
const { NexusEconomyClient } = require('./nexus-economy-client.cjs');

const ATTACHED = Symbol.for('khaos.nexus.sentinal.craft.attached');

const CRAFT_COMMAND_NAMES = Object.freeze(['craft', 'mcrcon', 'mc', 'mcadmin', 'realm']);

const MODULE_OFF = 'The Minecraft module is off on Nexus Sentinal. Set SENTINAL_CRAFT_MODULE=true and restart to turn it on.';

function craftModuleEnabled(env = process.env) {
  return ['1', 'true', 'yes', 'on'].includes(String(env?.SENTINAL_CRAFT_MODULE || '').trim().toLowerCase());
}

function craftModuleLayoutPolicy() {
  return Object.freeze({
    createsChannels: false,
    rearrangesChannels: false,
    editsPermissions: false,
    postsMessages: true,
    editsOwnMessages: true
  });
}

function ephemeral(content) {
  return {
    content: String(content || '').slice(0, 1900),
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] }
  };
}

function writeLog(log, line) {
  if (typeof log === 'function') log(line);
  else if (log && typeof log.log === 'function') log.log(line);
  else console.log(line);
}

function writeWarn(log, line) {
  if (log && typeof log.warn === 'function') log.warn(line);
  else console.warn(line);
}

function snowflake(value) {
  const id = String(value || '').trim();
  return /^\d{17,20}$/.test(id) ? id : '';
}

function isAutocompleteInteraction(interaction) {
  return typeof interaction?.isAutocomplete === 'function' && interaction.isAutocomplete();
}

function isCraftInteraction(interaction) {
  const customId = String(interaction?.customId || '');
  if (customId.startsWith('craft:')) return true;
  const name = String(interaction?.commandName || '');
  if (!CRAFT_COMMAND_NAMES.includes(name)) return false;
  if (typeof interaction?.isChatInputCommand === 'function' && interaction.isChatInputCommand()) return true;
  if (isAutocompleteInteraction(interaction)) return true;
  return false;
}

function isRealmRepost(interaction) {
  if (typeof interaction?.isChatInputCommand !== 'function' || !interaction.isChatInputCommand()) return false;
  if (String(interaction.commandName || '') !== 'realm') return false;
  return interaction.options?.getSubcommand?.(false) === 'repost';
}

function guildIdOf(env, config) {
  return String(env.DISCORD_GUILD_ID || env.NEXUS_DISCORD_GUILD_ID || config?.discord?.guildId || '').trim();
}

function sentinalCraftCommands(env = process.env) {
  const commands = craftCommands(env);
  const realm = commands.find((command) => command.name === 'realm');
  if (realm) {
    realm.addSubcommand((sub) => sub
      .setName('repost')
      .setDescription('Staff: post open Realm listings again from this bot.'));
  }
  return commands;
}

function sentinalCraftContext(client, env, store, config) {
  const economy = new NexusEconomyClient();
  return {
    env,
    store,
    config,
    client,
    openShop(interaction) {
      return openMinecraftShop(interaction, economy);
    },
    openStarter(interaction) {
      return claimMinecraftStarter(interaction, economy);
    }
  };
}

async function registerSentinalCraftCommands(client, env, config, log) {
  const guildId = guildIdOf(env, config);
  if (!/^\d{17,20}$/.test(guildId)) {
    writeWarn(log, '[Nexus Sentinal] craft module registration skipped: guild id missing');
    return [];
  }
  const guild = await client.guilds.fetch(guildId);
  const commands = await guild.commands.fetch();
  const definitions = sentinalCraftCommands(env);
  const names = [];
  for (const command of definitions) {
    const json = command.toJSON();
    names.push(json.name);
    const existing = commands.find((item) => item.name === json.name);
    if (existing) await guild.commands.edit(existing, json);
    else await guild.commands.create(json);
  }
  writeLog(log, `[Nexus Sentinal] craft module registered ${names.map((name) => `/${name}`).join(', ')}`);
  return names;
}

async function deleteMessage(channel, messageId) {
  if (!messageId || typeof channel?.messages?.fetch !== 'function') return false;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (typeof message?.delete !== 'function') return false;
  try {
    await message.delete();
    return true;
  } catch {
    return false;
  }
}

async function repostOpenRealms({ store, client }) {
  const open = (store.listListings?.() || []).filter((listing) => listing && listing.status !== 'closed' && listing.id);
  const posted = [];
  const skipped = [];
  const leftovers = [];
  const applicationsNotified = [];
  const applicationsUnsent = [];
  for (const listing of open) {
    const channelId = snowflake(listing.channelId);
    const channel = channelId && typeof client?.channels?.fetch === 'function'
      ? await client.channels.fetch(channelId).catch(() => null)
      : null;
    if (!channel || typeof channel.send !== 'function') {
      skipped.push(listing.id);
      continue;
    }
    const sent = await channel.send(listingPayload(listing));
    const messageId = snowflake(sent?.id);
    const previous = snowflake(listing.messageId);
    store.saveListing({
      ...listing,
      messageId: messageId || listing.messageId,
      channelId: snowflake(channel.id) || channelId
    });
    posted.push(listing.id);
    if (previous && previous !== messageId) {
      const removed = await deleteMessage(channel, previous);
      if (!removed) leftovers.push(previous);
    }
  }
  const pending = typeof store.listApplications === 'function'
    ? store.listApplications().filter((application) => application && application.status === 'pending' && open.some((listing) => listing.id === application.listingId))
    : [];
  for (const application of pending) {
    const listing = store.getListing(application.listingId);
    if (!listing) continue;
    const where = await notifyOwner(client, listing, application);
    if (where === 'dm') applicationsNotified.push(application.id);
    else applicationsUnsent.push(application.id);
  }
  return { posted, skipped, leftovers, applicationsNotified, applicationsUnsent };
}

function repostSummary(result) {
  const lines = [];
  if (result.posted.length) {
    lines.push(`Posted ${result.posted.length} open Realm listing(s) from Sentinal: ${result.posted.map((id) => `\`${id}\``).join(', ')}.`);
  } else {
    lines.push('No open Realm listings to post.');
  }
  if (result.skipped.length) {
    lines.push(`Could not post ${result.skipped.map((id) => `\`${id}\``).join(', ')}. The saved channel was missing.`);
  }
  if (result.leftovers.length) {
    lines.push(`Old messages still in the channel: ${result.leftovers.map((id) => `\`${id}\``).join(', ')}. Delete those Craft embeds by hand.`);
  }
  if (result.applicationsNotified?.length) {
    lines.push(`Sent ${result.applicationsNotified.length} pending application review(s) to the Realm owner by private message.`);
  }
  if (result.applicationsUnsent?.length) {
    lines.push(`Could not privately message the owner for ${result.applicationsUnsent.length} pending application(s).`);
  }
  lines.push('Apply buttons on the new messages belong to Sentinal. The channel list was left as it is.');
  return lines.join('\n').slice(0, 1900);
}

async function safeReply(interaction, payload) {
  if (isAutocompleteInteraction(interaction)) {
    if (typeof interaction.respond === 'function') await interaction.respond([]);
    return;
  }
  if (interaction.deferred || interaction.replied) {
    if (typeof interaction.followUp === 'function') await interaction.followUp(payload);
    else if (typeof interaction.editReply === 'function') await interaction.editReply(payload);
    return;
  }
  await interaction.reply(payload);
}

async function handleRealmRepost(interaction, context) {
  const env = context.env || process.env;
  const categoryId = await categoryIdForInteraction(interaction);
  const gate = decideCategory(env, categoryId, {
    channelId: interaction.channelId || interaction.channel?.id,
    interaction,
    config: context.config || {}
  });
  if (!gate.allow) {
    await safeReply(interaction, ephemeral(gate.message));
    return;
  }
  if (!craftIsStaff(interaction, context.config || {})) {
    await safeReply(interaction, ephemeral('Only Nexus staff can use that command.'));
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await repostOpenRealms({ store: context.store, client: context.client || interaction.client });
  await interaction.editReply({ content: repostSummary(result), allowedMentions: { parse: [] } });
}

function failureText(error) {
  const detail = redactSecret(String(error?.message || ''), []);
  if (detail && detail.length <= 300 && !/token|secret|password\s*[:=]/i.test(detail)) return detail;
  return 'Something went wrong running that command.';
}

async function handleSentinalCraftInteraction(interaction, context) {
  if (!isCraftInteraction(interaction)) return false;
  const env = context.env || process.env;
  if (!craftModuleEnabled(env)) {
    if (isAutocompleteInteraction(interaction)) {
      if (typeof interaction.respond === 'function') await interaction.respond([]);
      return true;
    }
    await safeReply(interaction, ephemeral(MODULE_OFF));
    return true;
  }
  if (isRealmRepost(interaction)) {
    await handleRealmRepost(interaction, context);
    return true;
  }
  await handleCraftInteraction(interaction, context);
  return true;
}

function attachCraftModule(client, options = {}) {
  if (!client || client[ATTACHED]) return client?.[ATTACHED] || { enabled: false };
  const env = options.env || process.env;
  const log = options.log || console;
  const enabled = craftModuleEnabled(env);
  if (!enabled) {
    client.on(Events.InteractionCreate, (interaction) => {
      if (!isCraftInteraction(interaction)) return;
      void safeReply(interaction, ephemeral(MODULE_OFF)).catch(() => {});
    });
    writeLog(log, '[Nexus Sentinal] craft module off');
    client[ATTACHED] = { enabled: false };
    return client[ATTACHED];
  }

  const config = options.config || loadConfig();
  const store = options.store || openCraftStore(env);
  seedCraftFiles({ dir: store.dir, env, log });
  seedStatusServers({ dir: store.dir, env, log, store });
  const context = sentinalCraftContext(client, env, store, config);
  const loops = options.loops !== false;

  client.on(Events.InteractionCreate, (interaction) => {
    if (!isCraftInteraction(interaction)) return;
    void handleSentinalCraftInteraction(interaction, context).catch(async (error) => {
      writeWarn(log, `[Nexus Sentinal] craft module interaction class=${errorClass(error)}`);
      try {
        await safeReply(interaction, ephemeral(failureText(error)));
      } catch {}
    });
  });

  client.once(Events.ClientReady, () => {
    const start = async () => {
      await registerSentinalCraftCommands(client, env, config, log);
      const statusHold = statusLoopHoldReason(store);
      if (statusHold) writeLog(log, `[Nexus Sentinal] craft status loop not started: ${statusHold}`);
      else startStatusLoop(client, store, env);
      if (loops) installMcEconomyLoops({ store, env, log: (line) => writeLog(log, line) });
    };
    return start().catch((error) => {
      writeWarn(log, `[Nexus Sentinal] craft module startup class=${errorClass(error)}`);
    });
  });

  client[ATTACHED] = { enabled: true, store };
  return client[ATTACHED];
}

module.exports = {
  CRAFT_COMMAND_NAMES,
  MODULE_OFF,
  attachCraftModule,
  isAutocompleteInteraction,
  craftModuleEnabled,
  craftModuleLayoutPolicy,
  handleRealmRepost,
  handleSentinalCraftInteraction,
  isCraftInteraction,
  isRealmRepost,
  registerSentinalCraftCommands,
  repostOpenRealms,
  repostSummary,
  sentinalCraftCommands,
  sentinalCraftContext
};
