'use strict';

const { Client, Events, MessageFlags, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.ops.extension');
const BOUND = Symbol.for('khaos.nexus.ark.ops.bound');

function arkCommand() {
  const command = new SlashCommandBuilder()
    .setName('ark')
    .setDescription('Manage the Khaos Nexus ARK server and ArkShop.');

  command.addSubcommand((sub) => sub.setName('status').setDescription('Test ARK RCON and show the current player response.'));
  command.addSubcommand((sub) => sub.setName('players').setDescription('List connected ARK players.'));
  command.addSubcommand((sub) => sub.setName('save').setDescription('Save the ARK world.'));
  command.addSubcommand((sub) => sub.setName('broadcast').setDescription('Broadcast a message in ARK.')
    .addStringOption((option) => option.setName('message').setDescription('Message to broadcast.').setRequired(true).setMaxLength(450)));
  command.addSubcommand((sub) => sub.setName('shop-reload').setDescription('Reload the ArkShop configuration.'));
  command.addSubcommand((sub) => sub.setName('shop-balance').setDescription('Get ArkShop points for an EOS ID.')
    .addStringOption((option) => option.setName('eos_id').setDescription('Player EOS ID.').setRequired(true).setMaxLength(80)));
  for (const [name, description] of [
    ['shop-add-points', 'Add ArkShop points to an EOS ID.'],
    ['shop-remove-points', 'Remove ArkShop points from an EOS ID.'],
    ['shop-set-points', 'Set the ArkShop point balance for an EOS ID.']
  ]) {
    command.addSubcommand((sub) => sub.setName(name).setDescription(description)
      .addStringOption((option) => option.setName('eos_id').setDescription('Player EOS ID.').setRequired(true).setMaxLength(80))
      .addIntegerOption((option) => option.setName('amount').setDescription('Point amount.').setRequired(true).setMinValue(0).setMaxValue(100000000)));
  }
  return command;
}

function isStaff(interaction, config) {
  const userId = String(interaction.user?.id || '');
  const owners = new Set((config.discord?.ownerUserIds || []).map(String));
  if (owners.has(userId)) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  const operatorRoles = new Set((config.discord?.operatorRoleIds || []).map(String));
  return interaction.member?.roles?.cache?.some?.((role) => operatorRoles.has(String(role.id))) || false;
}

function safeEos(value) {
  const eos = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(eos)) throw new Error('EOS ID format is invalid.');
  return eos;
}

async function registerArkCommand(guild) {
  const definition = arkCommand().toJSON();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === definition.name);
  if (existing) await guild.commands.edit(existing, definition); else await guild.commands.create(definition);
}

async function handleArkInteraction(interaction, context) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'ark') return false;
  if (!isStaff(interaction, context.config)) throw new Error('ARK server controls require Nexus staff authorization.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const sub = interaction.options.getSubcommand();
  let command;
  if (sub === 'status' || sub === 'players') command = 'ListPlayers';
  else if (sub === 'save') command = 'SaveWorld';
  else if (sub === 'broadcast') command = `Broadcast ${interaction.options.getString('message', true)}`;
  else if (sub === 'shop-reload') command = 'ArkShop.Reload';
  else if (sub === 'shop-balance') command = `GetPlayerPoints ${safeEos(interaction.options.getString('eos_id', true))}`;
  else {
    const eos = safeEos(interaction.options.getString('eos_id', true));
    const amount = interaction.options.getInteger('amount', true);
    if (sub === 'shop-add-points') command = `AddPoints ${eos} ${amount}`;
    else if (sub === 'shop-remove-points') command = `ChangePoints ${eos} -${amount}`;
    else if (sub === 'shop-set-points') command = `SetPoints ${eos} ${amount}`;
  }
  if (!command) throw new Error('Unsupported ARK operation.');

  const result = await context.rcon.execute(command);
  const content = sub === 'status'
    ? `🟢 **${context.server.name}** RCON is responding.\n\n${result || 'No players are currently connected.'}`
    : `✅ **${context.server.name}**\n\n${result || 'Command accepted.'}`;
  await interaction.editReply({ content: content.slice(0, 1900), allowedMentions: { parse: [] } });
  return true;
}

function installArkOpsExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const server = arkServerFromEnv('ARK_GEN1');
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkOpsLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      client.on(Events.InteractionCreate, (interaction) => {
        const context = client.__nexusArkContext;
        if (!context || String(interaction.guildId || '') !== String(config.discord?.guildId || '')) return;
        void handleArkInteraction(interaction, context).catch(async (error) => {
          const payload = { content: `⚠️ ${String(error?.message || error).slice(0, 1700)}`, allowedMentions: { parse: [] } };
          if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
          else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
        });
      });
    }

    client.once(Events.ClientReady, () => {
      void (async () => {
        if (!server.enabled) {
          console.log('[Nexus Sentinal] ARK ops disabled by ARK_GEN1_ENABLED.');
          return;
        }
        if (!server.host || !server.port || !server.password) throw new Error('ARK_GEN1 RCON variables are incomplete.');
        const guild = await client.guilds.fetch(String(config.discord?.guildId || ''));
        const rcon = new ArkRconClient(server);
        client.__nexusArkContext = { config, server, rcon };
        await registerArkCommand(guild);
        const result = await rcon.execute('ListPlayers');
        console.log(`[Nexus Sentinal] ARK RCON ready: server=${server.name} host=${server.host}:${server.port} playersResponse=${String(result || 'none').slice(0, 120)}`);
      })().catch((error) => console.warn(`[Nexus Sentinal] ARK ops unavailable: ${String(error?.message || error).slice(0, 240)}`));
    });

    return originalLogin.apply(this, args);
  };
}

module.exports = { arkCommand, isStaff, safeEos, handleArkInteraction, installArkOpsExtension };
