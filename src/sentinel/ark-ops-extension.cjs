'use strict';

const { Client, Events, MessageFlags, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const SftpClient = require('ssh2-sftp-client');
const { loadConfig } = require('../shared/config.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { ArkDinoCachePurchaseService } = require('./ark-dino-cache-purchase.cjs');
const { CACHE_POOLS } = require('./ark-dino-cache-engine.cjs');
const {
  sftpSettingsFromEnv,
  remotePath,
  GAME_USER_SETTINGS_PATH,
  GAME_INI_PATH
} = require('./ark-sftp-config.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.ops.extension');
const BOUND = Symbol.for('khaos.nexus.ark.ops.bound');

const CACHE_CHOICES = Object.freeze([
  { name: 'Coastal Cache — 800 NP', value: 'coastal' },
  { name: 'Forest Cache — 1,250 NP', value: 'forest' },
  { name: 'Swamp Cache — 1,400 NP', value: 'swamp' },
  { name: 'Mountain Cache — 1,800 NP', value: 'mountain' },
  { name: 'Ocean Cache — 2,200 NP', value: 'ocean' },
  { name: 'Deep Cave Cache — 2,200 NP', value: 'deepcave' },
  { name: 'Apex Cache — 8,000 NP • 7-day cooldown', value: 'apex' }
]);

function arkCommand() {
  const command = new SlashCommandBuilder()
    .setName('ark')
    .setDescription('Manage the Khaos Nexus ARK server and ArkShop.');

  command.addSubcommand((sub) => sub.setName('status').setDescription('Test ARK RCON and show the current player response.'));
  command.addSubcommand((sub) => sub.setName('config-status').setDescription('Test ARK SFTP and verify the server config files are reachable.'));
  command.addSubcommand((sub) => sub.setName('players').setDescription('List connected ARK players.'));
  command.addSubcommand((sub) => sub.setName('save').setDescription('Save the ARK world.'));
  command.addSubcommand((sub) => sub.setName('broadcast').setDescription('Broadcast a message in ARK.')
    .addStringOption((option) => option.setName('message').setDescription('Message to broadcast.').setRequired(true).setMaxLength(450)));
  command.addSubcommand((sub) => sub.setName('shop-cache').setDescription('Buy a Nexus Dino Cache and receive the rolled tame in a Dino Ball.')
    .addStringOption((option) => option.setName('cache').setDescription('Cache pool and price.').setRequired(true).addChoices(...CACHE_CHOICES))
    .addStringOption((option) => option.setName('eos_id').setDescription('Your ARK EOS player ID.').setRequired(true).setMaxLength(96)));
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
  if (!/^[A-Za-z0-9_-]{8,96}$/.test(eos)) throw new Error('EOS ID format is invalid.');
  return eos;
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const days = Math.floor(total / 86400);
  const hours = Math.ceil((total % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h`;
  return `${Math.ceil(total / 60)}m`;
}

function formatCacheResult(result) {
  if (!result?.ok) {
    if (result?.reason === 'insufficient-points') {
      return `❌ **Not enough Nexus Points**\nThis cache costs **${result.price} NP**. Current balance: **${result.balance} NP**.`;
    }
    if (result?.reason === 'cooldown') {
      return `⏳ **Apex Cache cooldown active**\nTry again in approximately **${formatDuration(result.remainingSeconds)}**.`;
    }
    return `❌ Dino Cache purchase was not completed${result?.reason ? `: ${result.reason}` : '.'}`;
  }
  const roll = result.roll || {};
  return [
    '✅ **Nexus Dino Cache delivered**',
    `Cache: **${String(roll.cacheId || '').toUpperCase()}** • **${roll.price} NP**`,
    `Roll: **${roll.species || 'Unknown'}** • Level **${roll.level || '?'}** • ${String(roll.rarity || 'unknown').toUpperCase()}`,
    'Delivery: **Dino Ball**',
    `Transaction: \`${String(result.transactionId || '').slice(0, 80)}\``
  ].join('\n');
}

async function registerArkCommand(guild) {
  const definition = arkCommand().toJSON();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === definition.name);
  if (existing) await guild.commands.edit(existing, definition); else await guild.commands.create(definition);
}

async function arkConfigStatus(prefix = 'ARK_GEN1') {
  const settings = sftpSettingsFromEnv(prefix);
  const missing = [];
  if (!settings.host) missing.push(`${prefix}_SFTP_HOST`);
  if (!settings.username) missing.push(`${prefix}_SFTP_USERNAME`);
  if (!settings.password) missing.push(`${prefix}_SFTP_PASSWORD`);
  if (missing.length) throw new Error(`ARK SFTP variables are incomplete. Missing at runtime: ${missing.join(', ')}`);

  const gusPath = remotePath(settings.root, process.env[`${prefix}_GUS_PATH`] || GAME_USER_SETTINGS_PATH);
  const gamePath = remotePath(settings.root, process.env[`${prefix}_GAMEINI_PATH`] || GAME_INI_PATH);
  const shopPath = remotePath(settings.root, process.env[`${prefix}_ARKSHOP_CONFIG_PATH`] || 'ShooterGame/Binaries/Win64/ArkApi/Plugins/ArkShop/Configs/config.json');
  const client = new SftpClient('khaos-nexus-ark-status');

  try {
    await client.connect({
      host: settings.host,
      port: settings.port,
      username: settings.username,
      password: settings.password,
      readyTimeout: settings.readyTimeout
    });
    const cwd = await client.cwd().catch(() => 'unknown');
    const rootEntries = await client.list('.').then((items) => items.map((item) => item.name).slice(0, 20)).catch(() => []);
    const [gus, game, shop] = await Promise.all([
      client.exists(gusPath),
      client.exists(gamePath),
      client.exists(shopPath)
    ]);
    return {
      connected: true,
      gus: Boolean(gus),
      game: Boolean(game),
      shop: Boolean(shop),
      gusPath,
      gamePath,
      shopPath,
      cwd,
      rootEntries
    };
  } finally {
    await client.end().catch(() => {});
  }
}

async function handleArkInteraction(interaction, context) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'ark') return false;
  const sub = interaction.options.getSubcommand();
  const publicShopAction = sub === 'shop-cache';
  if (!publicShopAction && !isStaff(interaction, context.config)) throw new Error('ARK server controls require Nexus staff authorization.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (sub === 'shop-cache') {
    const cacheId = String(interaction.options.getString('cache', true)).toLowerCase();
    if (!CACHE_POOLS[cacheId]) throw new Error('Unknown Nexus Dino Cache.');
    const eosId = safeEos(interaction.options.getString('eos_id', true));
    const service = new ArkDinoCachePurchaseService({ prefix: 'ARK_GEN1', rcon: context.rcon });
    const result = await service.purchase({ eosId, cacheId });
    await interaction.editReply({ content: formatCacheResult(result).slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'config-status') {
    const status = await arkConfigStatus('ARK_GEN1');
    const request = String(process.env.ARK_GEN1_CONFIG_APPLY_ONCE || '').trim();
    const entries = status.rootEntries.length ? status.rootEntries.join(', ') : '(none visible)';
    const content = [
      `🗂️ **${context.server.name} Config Status**`,
      '',
      `SFTP: ${status.connected ? '🟢 Connected' : '🔴 Offline'}`,
      `GameUserSettings.ini: ${status.gus ? '✅ Found' : '❌ Missing'}`,
      `Game.ini: ${status.game ? '✅ Found' : '❌ Missing'}`,
      `ArkShop config.json: ${status.shop ? '✅ Found' : '⚠️ Not found'}`,
      `Baseline request: ${request ? `\`${request}\`` : 'Not requested'}`,
      '',
      `Configured root: \`${String(process.env.ARK_GEN1_SFTP_ROOT || '/').slice(0, 300)}\``,
      `SFTP cwd: \`${String(status.cwd).slice(0, 300)}\``,
      `Visible root entries: \`${entries.slice(0, 700)}\``
    ].join('\n');
    await interaction.editReply({ content: content.slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }

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

module.exports = {
  CACHE_CHOICES,
  arkCommand,
  isStaff,
  safeEos,
  formatDuration,
  formatCacheResult,
  arkConfigStatus,
  handleArkInteraction,
  installArkOpsExtension
};
