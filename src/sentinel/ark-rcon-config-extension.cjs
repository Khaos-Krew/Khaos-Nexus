'use strict';

const {
  ActionRowBuilder,
  Client,
  Events,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { ArkRconConfigStore, normalizePrefix } = require('./ark-rcon-config-store.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.rcon.config.extension');
const BOUND = Symbol.for('khaos.nexus.ark.rcon.config.bound');
const COMMAND_NAME = 'arkrcon';
const PASSWORD_MODAL_PREFIX = 'nexus:arkrcon:password:';

function isOwner(interaction, config = {}) {
  const userId = String(interaction.user?.id || '');
  const owners = new Set((config.discord?.ownerUserIds || []).map(String));
  return owners.has(userId) || userId === String(interaction.guild?.ownerId || '');
}

function isStaff(interaction, config = {}) {
  if (isOwner(interaction, config)) return true;
  if (interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const operatorRoles = new Set((config.discord?.operatorRoleIds || []).map(String));
  return interaction.member?.roles?.cache?.some?.((role) => operatorRoles.has(String(role.id))) || false;
}

function serverChoices(registry = new ArkClusterRegistry()) {
  const byPrefix = new Map();
  const add = (name, value) => {
    try {
      const prefix = normalizePrefix(value);
      if (!byPrefix.has(prefix)) byPrefix.set(prefix, { name: String(name || prefix).slice(0, 100), value: prefix });
    } catch {}
  };

  add(process.env.ARK_GEN1_NAME || 'Gen1', 'ARK_GEN1');
  add(process.env.ARK_MAP2_NAME || 'Astraeos', 'ARK_MAP2');
  try {
    for (const server of registry.list({ includeDisabled: true })) add(server.mapName || server.name || server.envPrefix, server.envPrefix);
  } catch {}
  return [...byPrefix.values()].slice(0, 25);
}

function addServerOption(sub, choices) {
  return sub.addStringOption((option) => option
    .setName('server')
    .setDescription('ARK map/server RCON target.')
    .setRequired(true)
    .addChoices(...choices));
}

function rconCommand(registry = new ArkClusterRegistry()) {
  const choices = serverChoices(registry);
  const command = new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription('Owner/staff ARK RCON diagnostics, configuration, and raw command console.');

  command.addSubcommand((sub) => addServerOption(sub.setName('status').setDescription('Show effective RCON configuration without exposing the password.'), choices));
  command.addSubcommand((sub) => addServerOption(sub.setName('test').setDescription('Test RCON authentication and ListPlayers.'), choices));
  command.addSubcommand((sub) => addServerOption(sub.setName('configure').setDescription('Owner-only: persist an RCON endpoint override.'), choices)
    .addStringOption((option) => option.setName('host').setDescription('Citadel RCON host/IP.').setRequired(true).setMaxLength(255))
    .addIntegerOption((option) => option.setName('port').setDescription('Citadel RCON port.').setRequired(true).setMinValue(1).setMaxValue(65535))
    .addBooleanOption((option) => option.setName('enabled').setDescription('Enable this RCON target.'))
    .addIntegerOption((option) => option.setName('timeout_ms').setDescription('Connection/auth timeout in milliseconds.').setMinValue(1000).setMaxValue(30000)));
  command.addSubcommand((sub) => addServerOption(sub.setName('password').setDescription('Owner-only: open a protected modal to set the RCON password.'), choices));
  command.addSubcommand((sub) => addServerOption(sub.setName('send').setDescription('Owner-only: send an exact raw command with no prefix rewriting.'), choices)
    .addStringOption((option) => option.setName('command').setDescription('Exact RCON command, e.g. scriptcommand SpawnDinoInBall ...').setRequired(true).setMaxLength(1800)));
  command.addSubcommand((sub) => addServerOption(sub.setName('clear').setDescription('Owner-only: clear the Discord RCON override and return to Railway env settings.'), choices)
    .addBooleanOption((option) => option.setName('confirm').setDescription('Confirm clearing this server override.').setRequired(true)));
  return command;
}

function safeBlock(value, max = 1200) {
  return String(value || '').replace(/```/g, "'''").replace(/\u0000/g, '').slice(0, max);
}

function safeError(error, prefix = '') {
  let text = String(error?.message || error || 'Unknown RCON error').replace(/[\r\n]+/g, ' ').slice(0, 1200);
  try {
    const store = new ArkRconConfigStore();
    const prefixes = prefix ? [normalizePrefix(prefix)] : serverChoices().map((item) => item.value);
    for (const candidate of prefixes) {
      const server = store.resolve(candidate);
      if (server.password && server.password.length >= 3) text = text.split(server.password).join('[redacted]');
    }
  } catch {}
  return text;
}

async function registerCommand(guild) {
  const definition = rconCommand().toJSON();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === definition.name);
  if (existing) await guild.commands.edit(existing, definition);
  else await guild.commands.create(definition);
  return definition;
}

function statusText(prefix) {
  const store = new ArkRconConfigStore();
  const server = store.resolve(prefix);
  const state = store.status(prefix);
  return [
    `🔧 **${server.name} RCON configuration**`,
    `Target: \`${server.host || 'missing'}:${server.port || 'missing'}\``,
    `Enabled: **${server.enabled ? 'yes' : 'no'}**`,
    `Timeout: **${server.timeoutMs} ms**`,
    `Endpoint source: **${server.source}**`,
    `Host source: **${state.hostSource}** • Port source: **${state.portSource}**`,
    `Password: **${state.passwordConfigured ? 'configured' : 'missing'}** (${state.passwordSource})`,
    state.updatedAt ? `Discord override updated: <t:${Math.floor(Date.parse(state.updatedAt) / 1000)}:R>` : 'Discord override: **none**',
    '',
    'Passwords are never echoed to Discord or committed to Git.'
  ].join('\n');
}

function resultText(server, result, responseLabel = 'Response') {
  const lines = [
    `✅ **${server.name} RCON command sent**`,
    `Transport: **${result.status}** • authenticated: **${result.authenticated ? 'yes' : 'no'}** • ${result.elapsedMs} ms`,
    `Response packets: **${result.packets}**`
  ];
  if (result.response) lines.push('', `**${responseLabel}**`, `\`\`\`text\n${safeBlock(result.response, 1200)}\n\`\`\``);
  else if (result.status === 'sent_no_reply') lines.push('', 'ℹ️ No command-response packet was returned. ASA/mod ScriptCommands can still execute in this state; verify the game-side effect before retrying.');
  else if (result.status === 'sent_blank_reply') lines.push('', 'ℹ️ The server returned a blank RCON response packet. The command was sent; verify the game-side effect if this was a mod ScriptCommand.');
  return lines.join('\n');
}

function passwordModal(prefix) {
  const modal = new ModalBuilder()
    .setCustomId(`${PASSWORD_MODAL_PREFIX}${normalizePrefix(prefix)}`)
    .setTitle(`Set ${normalizePrefix(prefix)} RCON Password`);
  const input = new TextInputBuilder()
    .setCustomId('password')
    .setLabel('RCON / Server Admin Password')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(256)
    .setPlaceholder('Password is stored encrypted and is never echoed.');
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

async function handleCommand(interaction, config) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== COMMAND_NAME) return false;
  const sub = interaction.options.getSubcommand();
  const prefix = normalizePrefix(interaction.options.getString('server', true));

  if (!isStaff(interaction, config)) throw new Error('ARK RCON controls require Nexus staff authorization.');
  if (['configure', 'password', 'send', 'clear'].includes(sub) && !isOwner(interaction, config)) throw new Error('RCON configuration and raw command execution are restricted to the Nexus owner.');

  if (sub === 'password') {
    await interaction.showModal(passwordModal(prefix));
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const store = new ArkRconConfigStore();

  if (sub === 'status') {
    await interaction.editReply({ content: statusText(prefix), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'configure') {
    store.setEndpoint(prefix, {
      host: interaction.options.getString('host', true),
      port: interaction.options.getInteger('port', true),
      enabled: interaction.options.getBoolean('enabled') ?? true,
      timeoutMs: interaction.options.getInteger('timeout_ms') || 8000,
      actorId: interaction.user.id
    });
    await interaction.editReply({ content: `✅ RCON endpoint override saved.\n\n${statusText(prefix)}`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'clear') {
    if (interaction.options.getBoolean('confirm', true) !== true) throw new Error('RCON override clear was not confirmed.');
    const existed = store.clear(prefix);
    await interaction.editReply({ content: `${existed ? '✅' : 'ℹ️'} ${existed ? 'Discord RCON override cleared.' : 'No Discord RCON override existed.'}\n\n${statusText(prefix)}`, allowedMentions: { parse: [] } });
    return true;
  }

  const server = arkServerFromEnv(prefix);
  if (!server.enabled) throw new Error(`${prefix} RCON is disabled.`);
  if (!server.host || !server.port || !server.password) throw new Error(`${prefix} RCON configuration is incomplete. Use /arkrcon status, configure, and password.`);
  const rcon = new ArkRconClient(server);

  if (sub === 'test') {
    const result = await rcon.executeDetailed('ListPlayers');
    await interaction.editReply({ content: resultText(server, result, 'ListPlayers'), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'send') {
    const rawCommand = interaction.options.getString('command', true);
    const result = await rcon.executeDetailed(rawCommand);
    await interaction.editReply({ content: resultText(server, result), allowedMentions: { parse: [] } });
    return true;
  }

  throw new Error('Unsupported ARK RCON operation.');
}

async function handlePasswordModal(interaction, config) {
  if (!interaction.isModalSubmit?.() || !String(interaction.customId || '').startsWith(PASSWORD_MODAL_PREFIX)) return false;
  const prefix = normalizePrefix(String(interaction.customId).slice(PASSWORD_MODAL_PREFIX.length));
  if (!isOwner(interaction, config)) throw new Error('RCON password changes are restricted to the Nexus owner.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const password = interaction.fields.getTextInputValue('password');
  const store = new ArkRconConfigStore();
  store.setPassword(prefix, password, interaction.user.id);
  await interaction.editReply({ content: `🔐 **${prefix} RCON password saved to protected runtime storage.**\nThe password was not echoed or logged.\n\n${statusText(prefix)}`, allowedMentions: { parse: [] } });
  return true;
}

function installArkRconConfigExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkRconConfigLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      client.on(Events.InteractionCreate, (interaction) => {
        if (String(interaction.guildId || '') !== String(config.discord?.guildId || '')) return;
        void (async () => {
          if (await handleCommand(interaction, config)) return;
          await handlePasswordModal(interaction, config);
        })().catch(async (error) => {
          const payload = { content: `⚠️ ${safeError(error).slice(0, 1700)}`, allowedMentions: { parse: [] } };
          if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
          else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
        });
      });
      client.once(Events.ClientReady, () => {
        void (async () => {
          const guild = await client.guilds.fetch(String(config.discord?.guildId || ''));
          await registerCommand(guild);
          console.log(`[Nexus Sentinal] /${COMMAND_NAME} registered: cluster-aware RCON status/config/test/raw-send`);
        })().catch((error) => console.warn(`[Nexus Sentinal] ARK RCON config command unavailable: ${safeError(error).slice(0, 300)}`));
      });
    }
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  COMMAND_NAME,
  PASSWORD_MODAL_PREFIX,
  isOwner,
  isStaff,
  serverChoices,
  rconCommand,
  statusText,
  resultText,
  passwordModal,
  handleCommand,
  handlePasswordModal,
  installArkRconConfigExtension
};
