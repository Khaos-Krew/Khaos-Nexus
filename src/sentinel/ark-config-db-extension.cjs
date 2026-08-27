'use strict';

const { Client, Events, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { isStaff, arkConfigStatus } = require('./ark-ops-extension.cjs');
const { setIniValue, setArkShopValue, syncArkShopMysqlFromEnv } = require('./ark-config-manager.cjs');
const { mysqlStatus, mysqlSchema, lookupPlayer } = require('./arkshop-mysql.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.config.db.extension');
const BOUND = Symbol.for('khaos.nexus.ark.config.db.bound');

function configCommand() {
  return new SlashCommandBuilder()
    .setName('arkconfig')
    .setDescription('Safely edit Khaos Nexus ARK and ArkShop configuration.')
    .addSubcommand((sub) => sub.setName('status').setDescription('Check SFTP access to ARK and ArkShop config files.'))
    .addSubcommand((sub) => sub.setName('set-ini').setDescription('Set one Game.ini or GameUserSettings.ini value with automatic backup.')
      .addStringOption((o) => o.setName('file').setDescription('Config file').setRequired(true).addChoices(
        { name: 'GameUserSettings.ini', value: 'gus' },
        { name: 'Game.ini', value: 'game' }
      ))
      .addStringOption((o) => o.setName('section').setDescription('INI section name').setRequired(true).setMaxLength(160))
      .addStringOption((o) => o.setName('key').setDescription('INI setting key').setRequired(true).setMaxLength(160))
      .addStringOption((o) => o.setName('value').setDescription('New value').setRequired(true).setMaxLength(1000))
      .addBooleanOption((o) => o.setName('dry_run').setDescription('Preview whether a change is needed without writing.')))
    .addSubcommand((sub) => sub.setName('set-shop').setDescription('Set one ArkShop config.json value with automatic backup and reload.')
      .addStringOption((o) => o.setName('path').setDescription('JSON path, e.g. General.ItemsPerPage').setRequired(true).setMaxLength(300))
      .addStringOption((o) => o.setName('value').setDescription('JSON value or plain text').setRequired(true).setMaxLength(1200))
      .addBooleanOption((o) => o.setName('dry_run').setDescription('Preview whether a change is needed without writing.')))
    .addSubcommand((sub) => sub.setName('sync-mysql').setDescription('Sync protected Railway MySQL variables into ArkShop and reload it.')
      .addBooleanOption((o) => o.setName('dry_run').setDescription('Verify readiness without writing the ArkShop config.')));
}

function dbCommand() {
  return new SlashCommandBuilder()
    .setName('arkdb')
    .setDescription('Inspect the ArkShop MySQL connection and player records.')
    .addSubcommand((sub) => sub.setName('status').setDescription('Test the ArkShop MySQL connection and player table.'))
    .addSubcommand((sub) => sub.setName('schema').setDescription('Show the detected ArkShop player table schema.'))
    .addSubcommand((sub) => sub.setName('player').setDescription('Look up an ArkShop player record by numeric player/Steam ID.')
      .addStringOption((o) => o.setName('id').setDescription('Numeric player/Steam ID').setRequired(true).setMaxLength(30)));
}

async function upsertGuildCommand(guild, builder) {
  const definition = builder.toJSON();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === definition.name);
  if (existing) await guild.commands.edit(existing, definition);
  else await guild.commands.create(definition);
}

function clean(value, max = 900) {
  return String(value ?? '').replace(/`/g, '\\`').slice(0, max);
}

async function handleConfig(interaction, context) {
  if (interaction.commandName !== 'arkconfig') return false;
  if (!isStaff(interaction, context.config)) throw new Error('ARK configuration controls require Nexus staff authorization.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand();

  if (sub === 'status') {
    const status = await arkConfigStatus('ARK_GEN1');
    await interaction.editReply({ content: [
      `🗂️ **${context.server.name} configuration**`,
      `SFTP: ${status.connected ? '🟢 Connected' : '🔴 Offline'}`,
      `GameUserSettings.ini: ${status.gus ? '✅ Found' : '❌ Missing'}`,
      `Game.ini: ${status.game ? '✅ Found' : '❌ Missing'}`,
      `ArkShop config.json: ${status.shop ? '✅ Found' : '⚠️ Not found'}`,
      `ArkShop path: \`${clean(status.shopPath, 700)}\``
    ].join('\n'), allowedMentions: { parse: [] } });
    return true;
  }

  const dryRun = interaction.options.getBoolean('dry_run') === true;
  if (sub === 'set-ini') {
    const result = await setIniValue({
      prefix: 'ARK_GEN1',
      fileKey: interaction.options.getString('file', true),
      section: interaction.options.getString('section', true),
      key: interaction.options.getString('key', true),
      value: interaction.options.getString('value', true),
      dryRun
    });
    const action = dryRun ? 'Preview complete' : (result.changed ? 'Config updated and verified' : 'No change needed');
    await interaction.editReply({ content: [
      `✅ **${action}.**`,
      `File: \`${clean(result.remoteFile)}\``,
      `Changed: ${result.changed ? 'Yes' : 'No'}`,
      `Restart required: ${result.restartRequired ? '🟡 Yes' : 'No'}`,
      result.backup ? `Backup: \`${clean(result.backup)}\`` : null,
      result.restartRequired ? 'Sentinal did **not** restart the ARK server automatically.' : null
    ].filter(Boolean).join('\n'), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'set-shop') {
    const jsonPath = interaction.options.getString('path', true);
    if (/(pass(word)?|secret|token|webhook|url)/i.test(jsonPath)) {
      throw new Error('Secret or webhook fields cannot be edited through Discord. Use protected Railway/Citadel variables instead.');
    }
    const result = await setArkShopValue({
      prefix: 'ARK_GEN1',
      jsonPath,
      value: interaction.options.getString('value', true),
      dryRun
    });
    let reload = 'Not requested';
    if (!dryRun && result.changed) reload = await context.rcon.execute('ArkShop.Reload').then((text) => text || 'Command accepted');
    await interaction.editReply({ content: [
      `✅ **ArkShop ${dryRun ? 'preview complete' : (result.changed ? 'config updated and verified' : 'already matched')}.**`,
      `Path: \`${clean(jsonPath, 300)}\``,
      `Changed: ${result.changed ? 'Yes' : 'No'}`,
      result.backup ? `Backup: \`${clean(result.backup)}\`` : null,
      !dryRun && result.changed ? `ArkShop.Reload: \`${clean(reload, 500)}\`` : null,
      'ARK server restart required: No'
    ].filter(Boolean).join('\n'), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'sync-mysql') {
    const result = await syncArkShopMysqlFromEnv({ prefix: 'ARK_GEN1', dryRun });
    let reload = 'Not requested';
    if (!dryRun && result.changed) reload = await context.rcon.execute('ArkShop.Reload').then((text) => text || 'Command accepted');
    await interaction.editReply({ content: [
      `✅ **ArkShop MySQL ${dryRun ? 'sync readiness verified' : (result.changed ? 'configuration synchronized' : 'configuration already matched')}.**`,
      `Changed: ${result.changed ? 'Yes' : 'No'}`,
      result.backup ? `Backup: \`${clean(result.backup)}\`` : null,
      !dryRun && result.changed ? `ArkShop.Reload: \`${clean(reload, 500)}\`` : null,
      'The database password was read only from protected Railway variables and was not displayed in Discord.'
    ].filter(Boolean).join('\n'), allowedMentions: { parse: [] } });
    return true;
  }
  return false;
}

async function handleDb(interaction, context) {
  if (interaction.commandName !== 'arkdb') return false;
  if (!isStaff(interaction, context.config)) throw new Error('ArkShop database controls require Nexus staff authorization.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand();

  if (sub === 'status') {
    const status = await mysqlStatus();
    await interaction.editReply({ content: [
      `🗄️ **ArkShop MySQL**`,
      `Connection: ${status.connected ? '🟢 Connected' : '🔴 Offline'}`,
      `Database: \`${clean(status.database, 120)}\``,
      `Player table: \`${clean(status.table, 120)}\` ${status.tableExists ? '✅' : '❌'}`
    ].join('\n'), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'schema') {
    const schema = await mysqlSchema();
    const lines = schema.columns.slice(0, 35).map((column) => `• ${column.COLUMN_NAME} — ${column.DATA_TYPE}${column.COLUMN_KEY ? ` (${column.COLUMN_KEY})` : ''}`);
    await interaction.editReply({ content: [`🧬 **${schema.table} schema**`, ...lines].join('\n').slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'player') {
    const result = await lookupPlayer(interaction.options.getString('id', true));
    if (!result.player) {
      await interaction.editReply({ content: 'No ArkShop player record matched that ID.', allowedMentions: { parse: [] } });
      return true;
    }
    const rows = Object.entries(result.player).map(([key, value]) => `• ${key}: \`${clean(typeof value === 'string' ? value : JSON.stringify(value), 500)}\``);
    await interaction.editReply({ content: [`👤 **ArkShop player record**`, ...rows].join('\n').slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }
  return false;
}

function installArkConfigDbExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const server = arkServerFromEnv('ARK_GEN1');
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkConfigDbLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      client.on(Events.InteractionCreate, (interaction) => {
        if (!interaction.isChatInputCommand?.()) return;
        if (!['arkconfig', 'arkdb'].includes(interaction.commandName)) return;
        if (String(interaction.guildId || '') !== String(config.discord?.guildId || '')) return;
        const rcon = new ArkRconClient(server);
        const context = { config, server, rcon };
        const runner = interaction.commandName === 'arkconfig' ? handleConfig : handleDb;
        void runner(interaction, context).catch(async (error) => {
          const payload = { content: `⚠️ ${String(error?.message || error).slice(0, 1700)}`, allowedMentions: { parse: [] } };
          if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
          else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
        });
      });
    }

    client.once(Events.ClientReady, () => {
      void (async () => {
        if (!server.enabled) return;
        const guild = await client.guilds.fetch(String(config.discord?.guildId || ''));
        await upsertGuildCommand(guild, configCommand());
        await upsertGuildCommand(guild, dbCommand());
        console.log('[Nexus Sentinal] ARK config + ArkShop MySQL controls registered.');
      })().catch((error) => console.warn(`[Nexus Sentinal] ARK config/DB controls unavailable: ${String(error?.message || error).slice(0, 240)}`));
    });

    return originalLogin.apply(this, args);
  };
}

module.exports = { configCommand, dbCommand, handleConfig, handleDb, installArkConfigDbExtension };
