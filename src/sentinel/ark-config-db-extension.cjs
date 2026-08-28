'use strict';

const { Client, Events, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { isStaff } = require('./ark-ops-extension.cjs');
const { setIniValue, setArkShopValue, syncArkShopMysqlFromEnv, discoverPaths } = require('./ark-config-manager.cjs');
const { databaseStatus, databaseSchema, lookupPlayer } = require('./arkshop-database.cjs');
const { getPlayerPoints, addPlayerPoints, setPlayerPoints } = require('./arkshop-rcon-points.cjs');

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
    .setDescription('Inspect the active ArkShop database and player records.')
    .addSubcommand((sub) => sub.setName('status').setDescription('Test the ArkShop database connection and player table.'))
    .addSubcommand((sub) => sub.setName('schema').setDescription('Show the detected ArkShop player table schema.'))
    .addSubcommand((sub) => sub.setName('player').setDescription('Look up an ArkShop player record by Steam or EOS ID.')
      .addStringOption((o) => o.setName('id').setDescription('Player Steam/EOS ID').setRequired(true).setMaxLength(128)))
    .addSubcommand((sub) => sub.setName('points').setDescription('Read a player point balance through ArkShop RCON.')
      .addStringOption((o) => o.setName('id').setDescription('Player Steam/EOS ID').setRequired(true).setMaxLength(128)))
    .addSubcommand((sub) => sub.setName('add-points').setDescription('Add points through ArkShop RCON and verify the new balance.')
      .addStringOption((o) => o.setName('id').setDescription('Player Steam/EOS ID').setRequired(true).setMaxLength(128))
      .addIntegerOption((o) => o.setName('amount').setDescription('Points to add').setRequired(true).setMinValue(1).setMaxValue(2_000_000_000))
      .addBooleanOption((o) => o.setName('confirm').setDescription('Confirm this live point change').setRequired(true)))
    .addSubcommand((sub) => sub.setName('set-points').setDescription('Set points through ArkShop RCON and verify the new balance.')
      .addStringOption((o) => o.setName('id').setDescription('Player Steam/EOS ID').setRequired(true).setMaxLength(128))
      .addIntegerOption((o) => o.setName('amount').setDescription('New point balance').setRequired(true).setMinValue(0).setMaxValue(2_000_000_000))
      .addBooleanOption((o) => o.setName('confirm').setDescription('Confirm this live point change').setRequired(true)));
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
    const paths = await discoverPaths('ARK_GEN1');
    await interaction.editReply({ content: [
      `🗂️ **${context.server.name} configuration**`,
      'SFTP: 🟢 Connected',
      `GameUserSettings.ini: ${paths.gus.found ? '✅ Found' : '❌ Missing'}`,
      paths.gus.found ? `↳ \`${clean(paths.gus.path, 650)}\`` : `↳ ${clean(paths.gus.error, 650)}`,
      `Game.ini: ${paths.game.found ? '✅ Found' : '❌ Missing'}`,
      paths.game.found ? `↳ \`${clean(paths.game.path, 650)}\`` : `↳ ${clean(paths.game.error, 650)}`,
      `ArkShop config.json: ${paths.arkshop.found ? '✅ Found' : '⚠️ Not found'}`,
      paths.arkshop.found ? `↳ \`${clean(paths.arkshop.path, 650)}\`` : `↳ ${clean(paths.arkshop.error, 650)}`
    ].join('\n').slice(0, 1900), allowedMentions: { parse: [] } });
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
      `File: \`${clean(result.remoteFile, 650)}\``,
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
      `File: \`${clean(result.remoteFile, 650)}\``,
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
    const status = await databaseStatus();
    await interaction.editReply({ content: [
      `🗄️ **ArkShop ${status.backend === 'sqlite' ? 'SQLite (read-only snapshot)' : 'MySQL'}**`,
      `Connection: ${status.connected ? '🟢 Connected' : '🔴 Offline'}`,
      `Database: \`${clean(status.database, 120)}\``,
      `Player table: \`${clean(status.table, 120)}\` ${status.tableExists ? '✅' : '❌'}`
    ].join('\n'), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'schema') {
    const schema = await databaseSchema();
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
    await interaction.editReply({ content: ['👤 **ArkShop player record**', ...rows].join('\n').slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'points') {
    const result = await getPlayerPoints(context.rcon, interaction.options.getString('id', true));
    await interaction.editReply({ content: `💰 Player \`${clean(result.playerId, 140)}\` has **${result.points} points**.`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'add-points' || sub === 'set-points') {
    if (interaction.options.getBoolean('confirm', true) !== true) throw new Error('ArkShop point change cancelled because confirm was false.');
    const id = interaction.options.getString('id', true);
    const amount = interaction.options.getInteger('amount', true);
    const result = sub === 'add-points'
      ? await addPlayerPoints(context.rcon, id, amount)
      : await setPlayerPoints(context.rcon, id, amount);
    await interaction.editReply({ content: [
      `✅ ArkShop points ${sub === 'add-points' ? 'added' : 'set'} through RCON.`,
      `Player: \`${clean(result.playerId, 140)}\``,
      `Requested amount: **${result.amount}**`,
      `Verified balance: **${result.points}**`,
      'The SQLite database was not written by Sentinal and the ARK server was not restarted.'
    ].join('\n'), allowedMentions: { parse: [] } });
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
