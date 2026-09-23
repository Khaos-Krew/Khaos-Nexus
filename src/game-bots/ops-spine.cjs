'use strict';

const { Events, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { probeHealth } = require('../sentinel/nexus-status.cjs');
const { isArkShopMysqlRetired } = require('../sentinel/arkshop-database.cjs');
const { ASCENDED_COMMANDS, CEPHALON_COMMANDS } = require('../sentinel/game-command-ownership.cjs');
const { STAGE_HELP, stageCommandNames } = require('./stage-catalog.cjs');
const { healthSummaryLines } = require('./ascended-rcon-health.cjs');
const { BOT_LABELS, errorClass, reportCommandFailure, setGameBotMeta } = require('./command-failure.cjs');
const { normalizeBot, resolveCategoryConfig } = require('./category-gate.cjs');
const { sanctuaryHelpText, categoryGateLabel, resolveButtonChannel, buttonChannelLabel } = require('../sentinel/sanctuary-suite.cjs');

const INSTALLED = Symbol.for('khaos.nexus.gamebot.opsSpine');
const SENTINAL_POINTER = 'Wallet, verify, and ranks stay on Nexus Sentinal (`/bal`, `/o9verify`, ranks).';

const COMMAND_HELP = Object.freeze({
  ark: 'ARK server, shop, link, and event tools',
  'ark-health': 'ASA server, mods, and update safety',
  arkcluster: 'Cluster map management',
  arkconfig: 'ARK configuration controls',
  arkdb: 'ArkShop database controls',
  arkevent: 'Dynamic ARK events',
  arkprofile: 'Reusable ARK config profiles',
  arkshopadmin: 'ArkShop profile management',
  arkserver: 'Save, restart, and shop reload',
  arkrcon: 'RCON diagnostics and the Discord override store',
  arn: 'ARN tokens and caches',
  cacheadmin: 'Staff cache delivery verification',
  cachetoken: 'Staff cache token issue',
  market: 'Look up an item on Warframe Market',
  warframe: 'Warframe news, fissures, cycles, and world-state tools',
  nexushelp: 'This command list',
  status: 'Staff service status',
  sanctuary: 'Sanctuary Nexus roles, groups, builds, and season notes',
  ...STAGE_HELP
});

function ownedCommandNames(key) {
  if (key === 'ascended') return ASCENDED_COMMANDS;
  if (key === 'sanctuary') return ['sanctuary'];
  return CEPHALON_COMMANDS;
}

function liveCommandNames(bot) {
  const key = normalizeBot(bot);
  return [...ownedCommandNames(key), ...stageCommandNames(key), 'nexushelp', 'status'];
}

function helpText(bot) {
  const key = normalizeBot(bot);
  if (key === 'sanctuary') return sanctuaryHelpText().slice(0, 1900);
  const title = key === 'ascended' ? '**Nexus Ascended help**' : '**Cephalon Nexus help**';
  const lines = [title, 'Live commands:'];
  for (const name of liveCommandNames(key)) {
    lines.push(`• \`/${name}\` — ${COMMAND_HELP[name] || 'Bot command'}`);
  }
  lines.push('', SENTINAL_POINTER);
  return lines.join('\n').slice(0, 1900);
}

function opsCommandBuilders() {
  return [
    new SlashCommandBuilder()
      .setName('nexushelp')
      .setDescription('List this bot\'s commands. Wallet, verify, and ranks stay on Nexus Sentinal.'),
    new SlashCommandBuilder()
      .setName('status')
      .setDescription('Staff-only Discord and service status for this bot.')
  ];
}

function isStaff(interaction, config = {}) {
  const userId = String(interaction?.user?.id || '');
  const owners = new Set((config.discord?.ownerUserIds || []).map(String));
  if (owners.has(userId)) return true;
  if (interaction?.memberPermissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const operatorRoles = new Set((config.discord?.operatorRoleIds || []).map(String));
  return Boolean(interaction?.member?.roles?.cache?.some?.((role) => operatorRoles.has(String(role.id))));
}

function deployTip(env = process.env) {
  const sha = String(env.RAILWAY_GIT_COMMIT_SHA || env.RAILWAY_GIT_COMMIT || '').trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return 'Deploy SHA is not exposed in this environment.';
  return `Deploy \`${sha.slice(0, 7)}\`.`;
}

function safeProbeLabel(result) {
  const label = String(result?.label || result?.state || '').trim();
  if (/^[A-Za-z ]{1,32}$/.test(label)) return label;
  return 'unavailable';
}

function arkShopStatusLine(env = process.env) {
  if (!isArkShopMysqlRetired(env)) return 'ArkShop MySQL: bridge enabled.';
  const mode = String(env.ARKSHOP_DB_MODE || '').trim().toLowerCase();
  const shown = /^(disabled|off|retired|none|false|0)$/.test(mode) ? mode : 'disabled';
  return `ArkShop MySQL retired (\`ARKSHOP_DB_MODE=${shown}\`).`;
}

function rconStaffLines(env = process.env) {
  let store;
  try {
    const { ArkRconConfigStore } = require('../sentinel/ark-rcon-config-store.cjs');
    store = env.NEXUS_DATA_DIR ? new ArkRconConfigStore(env.NEXUS_DATA_DIR) : new ArkRconConfigStore();
  } catch {
    return ['RCON: Discord override store unavailable.', ...healthSummaryLines()];
  }
  const lines = ['RCON: Discord override store only. Railway env is not a connection source.'];
  for (const prefix of ['ARK_GEN1', 'ARK_MAP2']) {
    try {
      const state = store.status(prefix, env);
      const host = state.hostSource === 'missing' ? 'missing' : 'present';
      const port = state.portSource === 'missing' ? 'missing' : 'present';
      const password = state.passwordConfigured ? 'configured' : 'missing';
      lines.push(`${prefix}: host ${host}, port ${port}, password ${password}.`);
    } catch {
      lines.push(`${prefix}: unavailable.`);
    }
  }
  lines.push(...healthSummaryLines());
  return lines;
}

async function buildStatusText({ bot, client, env = process.env, probe } = {}) {
  const key = normalizeBot(bot);
  const ready = Boolean(client?.isReady?.());
  const lines = [
    key === 'ascended' ? '**Nexus Ascended status**' : key === 'sanctuary' ? '**Sanctuary Nexus status**' : '**Cephalon Nexus status**',
    `Discord: ${ready ? 'ready' : 'not ready'}.`,
    deployTip(env)
  ];
  if (key === 'ascended') {
    lines.push(arkShopStatusLine(env));
    lines.push(...rconStaffLines(env));
  } else if (key === 'sanctuary') {
    lines.push(`Category id: ${categoryGateLabel(resolveCategoryConfig('sanctuary', env))}.`);
    lines.push(`Button channel: ${buttonChannelLabel(resolveButtonChannel(env))}.`);
    lines.push('Timers: community cadence, no live feed.');
    lines.push('No game backend is started in this service.');
  } else {
    const runProbe = probe || ((url) => probeHealth(url, { timeoutMs: 2500 }));
    let label = 'unavailable';
    try {
      label = safeProbeLabel(await runProbe(env.NEXUS_BACKEND_URL || ''));
    } catch {
      label = 'unavailable';
    }
    lines.push(`Warframe backend: ${label}.`);
  }
  lines.push(SENTINAL_POINTER);
  return lines.join('\n').slice(0, 1900);
}

async function handleOpsCommand(interaction, context = {}) {
  if (typeof interaction?.isChatInputCommand === 'function' && !interaction.isChatInputCommand()) return false;
  const name = String(interaction?.commandName || '');
  if (name !== 'nexushelp' && name !== 'status') return false;
  const bot = normalizeBot(context.bot);
  const env = context.env || process.env;
  const config = context.config || loadConfig();
  if (name === 'nexushelp') {
    await interaction.reply({ content: helpText(bot), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return true;
  }
  if (!isStaff(interaction, config)) {
    await interaction.reply({ content: 'Status is restricted to Nexus staff.', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return true;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const content = await buildStatusText({ bot, client: context.client || interaction.client, env, probe: context.probe });
  await interaction.editReply({ content, allowedMentions: { parse: [] } });
  return true;
}

async function registerOpsCommands(client, bot, env = process.env, options = {}) {
  const config = options.config || loadConfig();
  const guildId = String(config?.discord?.guildId || env.NEXUS_DISCORD_GUILD_ID || env.DISCORD_GUILD_ID || '').trim();
  if (!guildId) {
    console.warn(`[${BOT_LABELS[normalizeBot(bot)] || 'Game bot'}] ops command registration skipped: guild id missing`);
    return { registered: false, reason: 'guild-missing' };
  }
  const guild = await client.guilds.fetch(guildId);
  const commands = await guild.commands.fetch();
  for (const builder of opsCommandBuilders()) {
    const definition = builder.toJSON();
    const existing = commands.find((item) => item.name === definition.name);
    if (existing) await guild.commands.edit(existing, definition);
    else await guild.commands.create(definition);
  }
  console.log(`[${BOT_LABELS[normalizeBot(bot)]}] registered /nexushelp and /status`);
  return { registered: true };
}

function installOpsSpine(client, { bot, env = process.env, config, probe } = {}) {
  const key = normalizeBot(bot);
  if (!client || client[INSTALLED] || !key) return client;
  client[INSTALLED] = true;
  setGameBotMeta(client, { bot: key, botName: BOT_LABELS[key] });
  const context = { bot: key, env, config, probe, client };
  client.on(Events.InteractionCreate, (interaction) => {
    void handleOpsCommand(interaction, context).catch((error) => reportCommandFailure(interaction, error, { bot: key, botName: BOT_LABELS[key], env }));
  });
  client.once(Events.ClientReady, () => {
    void registerOpsCommands(client, key, env, { config }).catch((error) => {
      console.warn(`[${BOT_LABELS[key]}] ops command registration failed: class=${errorClass(error)}`);
    });
  });
  return client;
}

module.exports = {
  SENTINAL_POINTER,
  COMMAND_HELP,
  liveCommandNames,
  helpText,
  opsCommandBuilders,
  isStaff,
  deployTip,
  arkShopStatusLine,
  rconStaffLines,
  buildStatusText,
  handleOpsCommand,
  registerOpsCommands,
  installOpsSpine
};
