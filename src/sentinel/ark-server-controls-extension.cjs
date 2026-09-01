'use strict';

const { Client, Events, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { performRestart } = require('./ark-restart-scheduler-extension.cjs');
const { syncArkShopMysqlFromEnv } = require('./ark-config-manager.cjs');
const { auditArkShopClusterDatabase } = require('./arkshop-cluster-economy-guard.cjs');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.server.controls.extension');
const BOUND = Symbol.for('khaos.nexus.ark.server.controls.bound');
const COMMAND_NAME = 'arkserver';

function arkServerCommand() {
  return new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription('Live Khaos Nexus ARK server controls.')
    .addSubcommand((sub) => sub.setName('status').setDescription('Check live ARK RCON connectivity.'))
    .addSubcommand((sub) => sub.setName('save').setDescription('Save the ARK world immediately over RCON.'))
    .addSubcommand((sub) => sub.setName('restart').setDescription('Save, then restart the ARK service through GameCP.')
      .addBooleanOption((option) => option.setName('confirm').setDescription('Required confirmation for the live restart.').setRequired(true)))
    .addSubcommand((sub) => sub.setName('mysql-sync').setDescription('Owner-only: sync ArkShop to the protected shared MySQL backend.')
      .addBooleanOption((option) => option.setName('confirm').setDescription('Required confirmation for live ArkShop config changes.').setRequired(true)));
}

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

function configuredPrefixes(registry = new ArkClusterRegistry()) {
  const prefixes = registry.list({ includeDisabled: false })
    .filter((server) => server.shopEnabled !== false)
    .map((server) => String(server.envPrefix || '').trim())
    .filter(Boolean);
  return [...new Set(prefixes.length ? prefixes : ['ARK_GEN1'])];
}

function sensitiveValues() {
  const suffixes = [
    'ARKSHOP_DB_PASSWORD', 'ARKSHOP_DB_HOST', 'ARKSHOP_DB_USER',
    'ARK_GEN1_RCON_PASSWORD', 'ARK_GEN1_SFTP_PASSWORD', 'ARK_GEN1_SFTP_USERNAME', 'ARK_GEN1_SFTP_HOST'
  ];
  for (const prefix of configuredPrefixesSafe()) {
    suffixes.push(`${prefix}_RCON_PASSWORD`, `${prefix}_SFTP_PASSWORD`, `${prefix}_SFTP_USERNAME`, `${prefix}_SFTP_HOST`);
  }
  return suffixes.map((key) => String(process.env[key] || '')).filter((value) => value.length >= 3);
}

function configuredPrefixesSafe() {
  try { return configuredPrefixes(); } catch { return ['ARK_GEN1']; }
}

function safeError(error) {
  let text = String(error?.message || error || 'Unknown error').replace(/[\r\n]+/g, ' ').slice(0, 900);
  for (const secret of sensitiveValues()) text = text.split(secret).join('[redacted]');
  return text;
}

async function registerCommand(guild) {
  const definition = arkServerCommand().toJSON();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === definition.name);
  if (existing) await guild.commands.edit(existing, definition);
  else await guild.commands.create(definition);
  return definition;
}

async function reloadArkShop(prefix) {
  const server = arkServerFromEnv(prefix);
  if (!server.enabled || !server.host || !server.port || !server.password) {
    return { prefix, ok: false, reason: 'rcon-unavailable' };
  }
  try {
    const response = await new ArkRconClient(server).execute('ArkShop.Reload');
    return { prefix, ok: true, response: String(response || '').slice(0, 160) };
  } catch (error) {
    return { prefix, ok: false, reason: safeError(error) };
  }
}

async function syncClusterMysql({ registry = new ArkClusterRegistry(), dryRun = false } = {}) {
  const prefixes = configuredPrefixes(registry);
  const writes = [];
  for (const prefix of prefixes) {
    try {
      const result = await syncArkShopMysqlFromEnv({ prefix, dryRun });
      writes.push({ prefix, ok: true, changed: result.changed === true, backupCreated: Boolean(result.backup) });
    } catch (error) {
      writes.push({ prefix, ok: false, error: safeError(error) });
    }
  }

  const writeFailures = writes.filter((item) => !item.ok);
  if (writeFailures.length) {
    return { ok: false, stage: 'sync', prefixes, writes, audit: null, reloads: [] };
  }

  const audit = await auditArkShopClusterDatabase({ registry });
  const reloads = [];
  if (!dryRun && audit.ok) {
    for (const prefix of prefixes) reloads.push(await reloadArkShop(prefix));
  }
  return { ok: audit.ok === true, stage: audit.ok ? 'verified' : 'audit', prefixes, writes, audit, reloads };
}

function formatMysqlResult(result = {}) {
  const changed = (result.writes || []).filter((item) => item.changed).length;
  const backups = (result.writes || []).filter((item) => item.backupCreated).length;
  const reloadOk = (result.reloads || []).filter((item) => item.ok).length;
  const reloadFailed = (result.reloads || []).filter((item) => !item.ok).length;
  if (!result.ok) {
    const failed = (result.writes || []).filter((item) => !item.ok).map((item) => item.prefix).join(', ');
    const mode = result.audit?.mode || result.stage || 'unknown';
    const affected = (result.audit?.problemServerIds || []).join(', ');
    return [
      '⚠️ **ArkShop MySQL sync did not pass verification**',
      `Stage: **${mode}**`,
      failed ? `Config write failed: **${failed}**` : '',
      affected ? `Economy guard affected servers: **${affected}**` : '',
      'The cluster economy guard remains locked; no database credentials were exposed.'
    ].filter(Boolean).join('\n');
  }
  return [
    '✅ **ArkShop shared MySQL verified**',
    `Maps checked: **${result.prefixes.length}** • configs changed: **${changed}** • backups created: **${backups}**`,
    `Economy guard: **${result.audit?.mode || 'verified'}**`,
    `ArkShop reload: **${reloadOk} succeeded**${reloadFailed ? ` • **${reloadFailed} failed**` : ''}`,
    'No ARK server restart was performed.'
  ].join('\n');
}

async function handleInteraction(interaction, context) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== COMMAND_NAME) return false;
  const sub = interaction.options.getSubcommand();
  if (!isStaff(interaction, context.config)) throw new Error('ARK server controls require Nexus staff authorization.');
  if ((sub === 'restart' || sub === 'mysql-sync') && !isOwner(interaction, context.config)) {
    throw new Error('This live operation is restricted to the Nexus owner.');
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (sub === 'mysql-sync') {
    if (interaction.options.getBoolean('confirm', true) !== true) throw new Error('Live MySQL synchronization was not confirmed.');
    const result = await syncClusterMysql();
    await interaction.editReply({ content: formatMysqlResult(result).slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }

  const server = arkServerFromEnv(context.prefix);
  if (!server.enabled) throw new Error(`${context.prefix} is not enabled.`);
  if (!server.host || !server.port || !server.password) throw new Error(`${context.prefix} RCON variables are incomplete.`);

  if (sub === 'status') {
    const response = await new ArkRconClient(server).execute('ListPlayers');
    await interaction.editReply({ content: `🟢 **${server.name}** RCON is responding.\n\n${String(response || 'No players are currently connected.').slice(0, 1500)}`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'save') {
    const response = await new ArkRconClient(server).execute('SaveWorld');
    await interaction.editReply({ content: `💾 **${server.name} world save accepted**\n${String(response || 'SaveWorld accepted by the server.').slice(0, 1200)}`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'restart') {
    if (interaction.options.getBoolean('confirm', true) !== true) throw new Error('Live restart was not confirmed.');
    await interaction.editReply({ content: `🔄 **${server.name} restart started**\nSaving the world first, then requesting the host-level restart. Sentinel will monitor RCON recovery.` });
    const accepted = await performRestart(server, { prefix: context.prefix });
    await interaction.editReply({ content: [
      `✅ **${server.name} restart accepted by GameCP**`,
      'World save: **completed before restart**',
      `Previous host state: **${String(accepted?.previousState || 'unknown').slice(0, 80)}**`,
      'Sentinel is monitoring for RCON recovery in the background.'
    ].join('\n'), allowedMentions: { parse: [] } });
    return true;
  }

  throw new Error('Unsupported ARK server control.');
}

function installArkServerControlsExtension({ prefix = 'ARK_GEN1' } = {}) {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;
  const config = loadConfig();

  Client.prototype.login = function nexusArkServerControlsLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      client.on(Events.InteractionCreate, (interaction) => {
        if (String(interaction.guildId || '') !== String(config.discord?.guildId || '')) return;
        void handleInteraction(interaction, { config, prefix }).catch(async (error) => {
          const payload = { content: `⚠️ ${safeError(error).slice(0, 1700)}`, allowedMentions: { parse: [] } };
          if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
          else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
        });
      });
      client.once(Events.ClientReady, () => {
        void (async () => {
          const guild = await client.guilds.fetch(String(config.discord?.guildId || ''));
          await registerCommand(guild);
          console.log(`[Nexus Sentinal] /${COMMAND_NAME} registered: save=RCON restart=GameCP mysqlSync=protected`);
        })().catch((error) => console.warn(`[Nexus Sentinal] ARK server controls unavailable: ${safeError(error).slice(0, 240)}`));
      });
    }
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  COMMAND_NAME,
  arkServerCommand,
  isOwner,
  isStaff,
  configuredPrefixes,
  safeError,
  syncClusterMysql,
  formatMysqlResult,
  handleInteraction,
  installArkServerControlsExtension
};
