'use strict';

const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { purchasableRanks, rankById } = require('../shared/ranks.cjs');

const SERVER_COMMAND = 'server';
const HOSTING_CHOICES = [
  { name: 'Self-Hosted', value: 'self-hosted' },
  { name: 'Hosted Site', value: 'hosted-site' }
];
const CONNECTION_CHOICES = [
  { name: 'REST API', value: 'rest' },
  { name: 'RCON', value: 'rcon' },
  { name: 'Manual / Host Dashboard', value: 'manual' },
  { name: 'No Live Connection', value: 'none' }
];
const PAID_RANK_CHOICES = purchasableRanks().map((rank) => ({ name: rank.name, value: rank.id }));
// Compatibility exports retained for older imports/tests.
const ADAPTER_CHOICES = CONNECTION_CHOICES;
const PROVIDER_CHOICES = CONNECTION_CHOICES;

function hostedServerCommand() {
  return new SlashCommandBuilder().setName(SERVER_COMMAND).setDescription('Manage Khaos Nexus game servers')
    .addSubcommand((sub) => sub.setName('add').setDescription('Register a game server')
      .addStringOption((opt) => opt.setName('game').setDescription('Game').setRequired(true).addChoices({ name: 'Palworld', value: 'palworld' }, { name: 'Once Human', value: 'oncehuman' }))
      .addStringOption((opt) => opt.setName('name').setDescription('Server display name').setRequired(true).setMaxLength(80))
      .addStringOption((opt) => opt.setName('hosting').setDescription('Where the server runs').setRequired(true).addChoices(...HOSTING_CHOICES))
      .addStringOption((opt) => opt.setName('connection').setDescription('How Sentinel connects for status/admin data').setRequired(true).addChoices(...CONNECTION_CHOICES))
      .addBooleanOption((opt) => opt.setName('public').setDescription('Public server? Private servers are rank-gated').setRequired(true))
      .addStringOption((opt) => opt.setName('paid_rank').setDescription('Minimum paid rank for a private server; defaults to Cipher Runner').setRequired(false).addChoices(...PAID_RANK_CHOICES))
      .addStringOption((opt) => opt.setName('host').setDescription('Optional REST/RCON hostname or IP; kept private').setRequired(false).setMaxLength(253))
      .addIntegerOption((opt) => opt.setName('port').setDescription('Optional game/server port').setRequired(false).setMinValue(1).setMaxValue(65535))
      .addIntegerOption((opt) => opt.setName('admin_port').setDescription('Optional REST/RCON port').setRequired(false).setMinValue(1).setMaxValue(65535))
      .addStringOption((opt) => opt.setName('credential_env').setDescription('Environment-variable name containing the REST/RCON credential').setRequired(false).setMaxLength(80))
      .addStringOption((opt) => opt.setName('join_info').setDescription('Join text or invite instructions').setRequired(false).setMaxLength(200))
      .addStringOption((opt) => opt.setName('description').setDescription('Optional server description').setRequired(false).setMaxLength(300)))
    .addSubcommand((sub) => sub.setName('edit').setDescription('Edit server identity, access, or connection details')
      .addStringOption((opt) => opt.setName('id').setDescription('Server ID from /server list').setRequired(true))
      .addStringOption((opt) => opt.setName('name').setDescription('New display name').setRequired(false).setMaxLength(80))
      .addStringOption((opt) => opt.setName('hosting').setDescription('Self-Hosted or Hosted Site').setRequired(false).addChoices(...HOSTING_CHOICES))
      .addStringOption((opt) => opt.setName('connection').setDescription('REST, RCON, Manual, or None').setRequired(false).addChoices(...CONNECTION_CHOICES))
      .addBooleanOption((opt) => opt.setName('public').setDescription('Public or paid-rank private').setRequired(false))
      .addStringOption((opt) => opt.setName('paid_rank').setDescription('Minimum paid rank if private').setRequired(false).addChoices(...PAID_RANK_CHOICES))
      .addStringOption((opt) => opt.setName('host').setDescription('REST/RCON hostname or IP; kept private').setRequired(false).setMaxLength(253))
      .addIntegerOption((opt) => opt.setName('port').setDescription('Game/server port').setRequired(false).setMinValue(1).setMaxValue(65535))
      .addIntegerOption((opt) => opt.setName('query_port').setDescription('Optional query/status port').setRequired(false).setMinValue(1).setMaxValue(65535))
      .addIntegerOption((opt) => opt.setName('admin_port').setDescription('REST/RCON/admin port').setRequired(false).setMinValue(1).setMaxValue(65535))
      .addStringOption((opt) => opt.setName('credential_env').setDescription('Environment-variable name containing the REST/RCON credential').setRequired(false).setMaxLength(80))
      .addStringOption((opt) => opt.setName('join_info').setDescription('Join text or invite instructions').setRequired(false).setMaxLength(200))
      .addStringOption((opt) => opt.setName('description').setDescription('Server description').setRequired(false).setMaxLength(300)))
    .addSubcommand((sub) => sub.setName('configure').setDescription('Update only the REST/RCON/manual connection')
      .addStringOption((opt) => opt.setName('id').setDescription('Server ID from /server list').setRequired(true))
      .addStringOption((opt) => opt.setName('connection').setDescription('Connection method').setRequired(true).addChoices(...CONNECTION_CHOICES))
      .addStringOption((opt) => opt.setName('host').setDescription('REST/RCON hostname or IP; kept private').setRequired(false).setMaxLength(253))
      .addIntegerOption((opt) => opt.setName('admin_port').setDescription('REST/RCON/admin port').setRequired(false).setMinValue(1).setMaxValue(65535))
      .addStringOption((opt) => opt.setName('credential_env').setDescription('Environment-variable name containing the REST/RCON credential').setRequired(false).setMaxLength(80)))
    .addSubcommand((sub) => sub.setName('setup').setDescription('Show game setup guidance for a server')
      .addStringOption((opt) => opt.setName('id').setDescription('Server ID from /server list').setRequired(true)))
    .addSubcommand((sub) => sub.setName('status').setDescription('Check live connection status for one server')
      .addStringOption((opt) => opt.setName('id').setDescription('Server ID from /server list').setRequired(true)))
    .addSubcommand((sub) => sub.setName('access').setDescription('Show private servers available to your paid rank'))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a registered server')
      .addStringOption((opt) => opt.setName('id').setDescription('Server ID from /server list').setRequired(true))
      .addBooleanOption((opt) => opt.setName('confirm').setDescription('Confirm permanent removal').setRequired(true)))
    .addSubcommand((sub) => sub.setName('list').setDescription('List privately registered servers'))
    .addSubcommand((sub) => sub.setName('refresh').setDescription('Refresh server status and #game-servers'));
}

function optionValue(interaction, name) { return interaction.options?.get?.(name)?.value; }
function addInput(interaction) {
  return {
    moduleId: String(optionValue(interaction, 'game') || ''),
    name: String(optionValue(interaction, 'name') || ''),
    hostingType: String(optionValue(interaction, 'hosting') || ''),
    connectionType: String(optionValue(interaction, 'connection') || 'none'),
    public: optionValue(interaction, 'public') === true,
    accessRank: String(optionValue(interaction, 'paid_rank') || ''),
    host: String(optionValue(interaction, 'host') || ''),
    port: optionValue(interaction, 'port'),
    adminPort: optionValue(interaction, 'admin_port'),
    credentialEnv: String(optionValue(interaction, 'credential_env') || ''),
    description: String(optionValue(interaction, 'description') || ''),
    joinInfo: String(optionValue(interaction, 'join_info') || '')
  };
}
function editInput(interaction) {
  const mapping = {
    name:'name', hosting:'hostingType', connection:'connectionType', public:'public', paid_rank:'accessRank',
    host:'host', port:'port', query_port:'queryPort', admin_port:'adminPort', credential_env:'credentialEnv',
    description:'description', join_info:'joinInfo'
  };
  const input = {};
  for (const [optionName, target] of Object.entries(mapping)) {
    const value = optionValue(interaction, optionName);
    if (value !== undefined && value !== null) input[target] = value;
  }
  return input;
}
function configureInput(interaction) {
  const input = { connectionType: String(optionValue(interaction, 'connection') || 'none') };
  for (const [optionName, target] of [['host','host'],['admin_port','adminPort'],['credential_env','credentialEnv']]) {
    const value = optionValue(interaction, optionName);
    if (value !== undefined && value !== null) input[target] = value;
  }
  return input;
}
function privateServerList(servers = []) {
  if (!servers.length) return 'No game servers are registered yet.';
  return servers.map((server) => {
    const endpoint = server.host ? `${server.host}${server.port ? `:${server.port}` : ''}` : 'endpoint not configured';
    const connection = server.connectionType || 'none';
    const hosting = server.hostingType === 'self-hosted' ? 'self-hosted' : 'hosted site';
    const access = server.public === false ? `private • ${rankById(server.accessRank || 'cipher-runner')?.name || 'Cipher Runner'}+` : 'public';
    const extra = [`${hosting}`, `connection ${connection}`, server.queryPort ? `query ${server.queryPort}` : '', server.adminPort ? `admin ${server.adminPort}` : '', server.credentialEnv ? `credential env ${server.credentialEnv}` : ''].filter(Boolean).join(' • ');
    return `**${server.id} — ${server.name}**\n${server.game} • ${endpoint} • ${access}\n${extra}`;
  }).join('\n\n').slice(0, 3800);
}
function eligiblePrivateServers(servers = [], memberRank = null) {
  const level = Number(memberRank?.level ?? -1);
  if (level < 1) return [];
  return (servers || []).filter((server) => {
    if (server.public !== false) return false;
    const required = rankById(server.accessRank || 'cipher-runner');
    return required && level >= required.level;
  });
}
function privateAccessText(servers = [], memberRank = null) {
  const eligible = eligiblePrivateServers(servers, memberRank);
  if (!eligible.length) return '🔒 No private game servers are currently available to your Nexus rank.';
  const rows = eligible.map((server) => {
    const required = rankById(server.accessRank || 'cipher-runner');
    const join = String(server.joinInfo || '').trim() || 'Ask Nexus staff for the current join instructions.';
    const state = String(server.trackingState || 'registered').toUpperCase();
    return `**${server.name}** — ${server.game}\n**Minimum Rank:** ${required?.name || 'Cipher Runner'}\n**Status:** ${state}\n**Join:** ${join}`;
  });
  return `🔐 **Private Server Access — ${memberRank?.name || 'Nexus Supporter'}**\n\n${rows.join('\n\n')}`.slice(0, 3900);
}
function statusText(server = {}, status = {}) {
  const state = String(status.trackingState || 'unknown').toUpperCase();
  const players = Number.isFinite(Number(status.playerCount)) ? `${status.playerCount}${Number.isFinite(Number(status.playerMax)) ? ` / ${status.playerMax}` : ''}` : 'Not exposed';
  const connection = server.connectionType || 'none';
  return `📡 **${server.name} — Server Status**\n\n**Connection**\n${connection.toUpperCase()}\n\n**State**\n${state}\n\n**Players**\n${players}\n\n**Connection note**\n${status.statusMessage || 'No additional status detail.'}\n\nCredentials and private endpoints are not displayed.`;
}
function setupText(server = {}, guide = {}) {
  if (guide.managementMode === 'palworld-adapters') {
    const options = (guide.options || []).map((item) => `**${item.name}**\n${item.description}`).join('\n\n');
    const selected = server.connectionType || 'none';
    return `🔧 **${server.name} — Palworld Connection Setup**\n\n**Hosting**\n${server.hostingType === 'self-hosted' ? 'Self-Hosted' : 'Hosted Site'}\n\n**Current connection**\n${selected.toUpperCase()}\n\n${options}\n\nUse **/server configure** to change REST/RCON/manual connection details without recreating the server.`.slice(0, 3900);
  }
  const sections = (guide.sections || []).map((section) => `**${section.title}**\n${(section.settings || []).map((item) => `• ${item}`).join('\n')}`).join('\n\n');
  const warnings = (guide.warnings || []).map((item) => `⚠️ ${item}`).join('\n\n');
  return `🛠️ **${server.name} — Once Human Custom Server Setup**\n\n**Hosting**\n${server.hostingType === 'self-hosted' ? 'Self-Hosted' : 'Hosted Site'}\n\nCurrent supported management path for Once Human: **official server-management interface / manual configuration**.\n\n${sections}\n\n**Lifecycle / Safety**\n${warnings}`.slice(0, 3900);
}
async function replyEphemeral(interaction, content) {
  const payload = { content: String(content).slice(0,3900), flags: MessageFlags.Ephemeral, allowedMentions:{parse:[]} };
  if (interaction.deferred || interaction.replied) return interaction.editReply({ content:payload.content, allowedMentions:payload.allowedMentions });
  return interaction.reply(payload);
}

async function handleHostedServerCommand(interaction, context = {}) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== SERVER_COMMAND) return false;
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'access') {
    const manager = await context.isManager(interaction);
    const memberRank = manager ? { id:'owner-admin', name:'Owner / Admin', level:999 } : await context.memberRank?.(interaction);
    if (!memberRank) { await replyEphemeral(interaction, '🔒 Private server access requires an eligible paid Nexus rank.'); return true; }
    const response = await context.backend.hostedServers();
    if (!response.ok) throw new Error(response.message || 'Server registry is unavailable.');
    await replyEphemeral(interaction, privateAccessText(response.servers || [], memberRank));
    return true;
  }

  if (!(await context.isManager(interaction))) { await replyEphemeral(interaction, '⛔ Server management is restricted to Nexus owners and administrators.'); return true; }

  if (subcommand === 'list') {
    const response = await context.backend.hostedServers(); if (!response.ok) throw new Error(response.message || 'Server registry is unavailable.');
    await replyEphemeral(interaction, `🗄️ **Server Registry**\n\n${privateServerList(response.servers || [])}`); return true;
  }
  if (subcommand === 'add') {
    const input = addInput(interaction);
    const response = await context.backend.addHostedServer(input); if (!response.ok) throw new Error(response.message || 'Unable to register server.');
    await context.refreshProviders?.(); await context.refresh?.();
    const access = response.server.public === false ? `${rankById(response.server.accessRank || 'cipher-runner')?.name || 'Cipher Runner'}+ private` : 'public';
    await replyEphemeral(interaction, `✅ **${response.server.name}** registered as **${response.server.id}**.\n\n**Hosting:** ${response.server.hostingType === 'self-hosted' ? 'Self-Hosted' : 'Hosted Site'}\n**Connection:** ${(response.server.connectionType || 'none').toUpperCase()}\n**Access:** ${access}\n\n#game-servers has been refreshed.`); return true;
  }
  if (subcommand === 'edit') {
    const id = String(optionValue(interaction,'id') || '').trim().toUpperCase(); const response = await context.backend.updateHostedServer(id, editInput(interaction));
    if (!response.ok) throw new Error(response.message || response.code || 'Unable to edit server.'); await context.refreshProviders?.(); await context.refresh?.();
    await replyEphemeral(interaction, `✅ **${response.server.name}** (${response.server.id}) updated and the registry refreshed.`); return true;
  }
  if (subcommand === 'configure') {
    const id = String(optionValue(interaction,'id') || '').trim().toUpperCase();
    const response = await context.backend.updateHostedServer(id, configureInput(interaction));
    if (!response.ok) throw new Error(response.message || response.code || 'Unable to configure server connection.');
    await context.refreshProviders?.(); await context.refresh?.();
    await replyEphemeral(interaction, `🔧 **${response.server.name}** (${response.server.id}) connection set to **${String(response.server.connectionType || 'none').toUpperCase()}**.`); return true;
  }
  if (subcommand === 'setup' || subcommand === 'status') {
    const id = String(optionValue(interaction,'id') || '').trim().toUpperCase();
    const response = await context.backend.hostedServers(); if (!response.ok) throw new Error(response.message || 'Server registry is unavailable.');
    const server = (response.servers || []).find((item) => String(item.id).toUpperCase() === id); if (!server) throw new Error('Server ID was not found.');
    if (subcommand === 'setup') {
      const guide = context.setup?.(server); if (!guide?.ok) throw new Error('No setup guide is available for that server.');
      await replyEphemeral(interaction, setupText(server, guide)); return true;
    }
    const status = await context.probe?.(server); if (!status) throw new Error('No supported live connection is configured for that server yet.');
    await context.persistStatus?.(server.id, status); await context.refresh?.();
    await replyEphemeral(interaction, statusText(server, status)); return true;
  }
  if (subcommand === 'remove') {
    const id = String(optionValue(interaction,'id') || '').trim().toUpperCase(); if (optionValue(interaction,'confirm') !== true) { await replyEphemeral(interaction,'Removal cancelled. Run again with **confirm: true**.'); return true; }
    const response = await context.backend.removeHostedServer(id); if (!response.ok) throw new Error(response.message || response.code || 'Unable to remove server.'); await context.refresh?.();
    await replyEphemeral(interaction, `🗑️ **${id}** removed from the server registry.`); return true;
  }
  if (subcommand === 'refresh') {
    const status = await context.refreshProviders?.(); const result = await context.refresh?.();
    await replyEphemeral(interaction, `🔄 Connection checks completed${status?.length ? ` for ${status.length} registered server${status.length===1?'':'s'}`:''}. #game-servers refreshed${result?.tracked !== undefined ? ` • ${result.tracked} public • ${result.privateTracked || 0} private` : ''}.`); return true;
  }
  return false;
}

module.exports = {
  SERVER_COMMAND, HOSTING_CHOICES, CONNECTION_CHOICES, PAID_RANK_CHOICES,
  ADAPTER_CHOICES, PROVIDER_CHOICES, hostedServerCommand, addInput, editInput, configureInput,
  privateServerList, eligiblePrivateServers, privateAccessText, statusText, setupText, handleHostedServerCommand
};
