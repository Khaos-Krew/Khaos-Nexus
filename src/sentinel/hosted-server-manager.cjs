'use strict';

const { MessageFlags, SlashCommandBuilder } = require('discord.js');

const SERVER_COMMAND = 'server';
const ADAPTER_CHOICES = [
  { name: 'No telemetry / registration only', value: 'none' },
  { name: 'Palworld REST API', value: 'palworld-rest' },
  { name: 'Palworld RCON', value: 'palworld-rcon' },
  { name: 'Nitrado API', value: 'nitrado-api' },
  { name: 'Manual management', value: 'manual' },
  { name: 'Custom adapter', value: 'custom' }
];
// Legacy name retained for older imports/tests while terminology is migrated.
const PROVIDER_CHOICES = ADAPTER_CHOICES;

function hostedServerCommand() {
  return new SlashCommandBuilder().setName(SERVER_COMMAND).setDescription('Manage Khaos Nexus game servers')
    .addSubcommand((sub) => sub.setName('add').setDescription('Register a game server independently of hosting provider')
      .addStringOption((opt) => opt.setName('game').setDescription('Game').setRequired(true).addChoices({ name: 'Palworld', value: 'palworld' }, { name: 'Once Human', value: 'oncehuman' }))
      .addStringOption((opt) => opt.setName('name').setDescription('Server display name').setRequired(true).setMaxLength(80))
      .addStringOption((opt) => opt.setName('host').setDescription('Optional server hostname/IP; can be added later').setRequired(false).setMaxLength(253))
      .addIntegerOption((opt) => opt.setName('port').setDescription('Optional game/server port; can be added later').setRequired(false).setMinValue(1).setMaxValue(65535))
      .addStringOption((opt) => opt.setName('join_info').setDescription('Optional public join text or invite instructions').setRequired(false).setMaxLength(200))
      .addStringOption((opt) => opt.setName('description').setDescription('Optional public description').setRequired(false).setMaxLength(300))
      .addBooleanOption((opt) => opt.setName('public').setDescription('Show this server in #game-servers (default true)').setRequired(false)))
    .addSubcommand((sub) => sub.setName('edit').setDescription('Edit server identity or connection details')
      .addStringOption((opt) => opt.setName('id').setDescription('Server ID from /server list').setRequired(true))
      .addStringOption((opt) => opt.setName('name').setDescription('New display name').setRequired(false).setMaxLength(80))
      .addStringOption((opt) => opt.setName('host').setDescription('Server hostname/IP').setRequired(false).setMaxLength(253))
      .addIntegerOption((opt) => opt.setName('port').setDescription('Game/server port').setRequired(false).setMinValue(1).setMaxValue(65535))
      .addIntegerOption((opt) => opt.setName('query_port').setDescription('Optional query/status port').setRequired(false).setMinValue(1).setMaxValue(65535))
      .addIntegerOption((opt) => opt.setName('admin_port').setDescription('Optional REST/RCON/admin port').setRequired(false).setMinValue(1).setMaxValue(65535))
      .addStringOption((opt) => opt.setName('join_info').setDescription('Public join text or invite instructions').setRequired(false).setMaxLength(200))
      .addStringOption((opt) => opt.setName('description').setDescription('Public description').setRequired(false).setMaxLength(300))
      .addBooleanOption((opt) => opt.setName('public').setDescription('Show this server in #game-servers').setRequired(false)))
    .addSubcommand((sub) => sub.setName('configure').setDescription('Attach an optional telemetry/management adapter after registration')
      .addStringOption((opt) => opt.setName('id').setDescription('Server ID from /server list').setRequired(true))
      .addStringOption((opt) => opt.setName('adapter').setDescription('Connection/telemetry adapter').setRequired(true).addChoices(...ADAPTER_CHOICES))
      .addStringOption((opt) => opt.setName('hosting_provider').setDescription('Optional hosting-company label, e.g. Nitrado, NetEase, self-hosted').setRequired(false).setMaxLength(80))
      .addStringOption((opt) => opt.setName('adapter_ref').setDescription('Optional private adapter reference, e.g. Nitrado service ID').setRequired(false).setMaxLength(80))
      .addStringOption((opt) => opt.setName('credential_env').setDescription('Environment-variable name containing the credential; never the secret itself').setRequired(false).setMaxLength(80)))
    .addSubcommand((sub) => sub.setName('setup').setDescription('Show game/adapter setup guidance for a server')
      .addStringOption((opt) => opt.setName('id').setDescription('Server ID from /server list').setRequired(true)))
    .addSubcommand((sub) => sub.setName('status').setDescription('Check live adapter status for one server')
      .addStringOption((opt) => opt.setName('id').setDescription('Server ID from /server list').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a registered server')
      .addStringOption((opt) => opt.setName('id').setDescription('Server ID from /server list').setRequired(true))
      .addBooleanOption((opt) => opt.setName('confirm').setDescription('Confirm permanent removal').setRequired(true)))
    .addSubcommand((sub) => sub.setName('list').setDescription('List privately registered servers'))
    .addSubcommand((sub) => sub.setName('refresh').setDescription('Refresh adapter status and #game-servers'));
}

function optionValue(interaction, name) { return interaction.options?.get?.(name)?.value; }
function addInput(interaction) {
  return {
    moduleId: String(optionValue(interaction, 'game') || ''),
    name: String(optionValue(interaction, 'name') || ''),
    host: String(optionValue(interaction, 'host') || ''),
    port: optionValue(interaction, 'port'),
    description: String(optionValue(interaction, 'description') || ''),
    joinInfo: String(optionValue(interaction, 'join_info') || ''),
    adapterType: 'none',
    public: optionValue(interaction, 'public') !== false
  };
}
function editInput(interaction) {
  const mapping = { name:'name', host:'host', port:'port', query_port:'queryPort', admin_port:'adminPort', description:'description', join_info:'joinInfo', public:'public' };
  const input = {};
  for (const [optionName, target] of Object.entries(mapping)) {
    const value = optionValue(interaction, optionName);
    if (value !== undefined && value !== null) input[target] = value;
  }
  return input;
}
function configureInput(interaction) {
  return {
    adapterType: String(optionValue(interaction, 'adapter') || 'none'),
    hostingProvider: String(optionValue(interaction, 'hosting_provider') || ''),
    adapterRef: String(optionValue(interaction, 'adapter_ref') || ''),
    credentialEnv: String(optionValue(interaction, 'credential_env') || '')
  };
}
function privateServerList(servers = []) {
  if (!servers.length) return 'No game servers are registered yet.';
  return servers.map((server) => {
    const endpoint = server.host ? `${server.host}${server.port ? `:${server.port}` : ''}` : 'endpoint not configured';
    const adapter = server.adapterType || server.providerType || 'none';
    const hoster = server.hostingProvider ? `hosting ${server.hostingProvider}` : '';
    const ref = (server.adapterRef || server.providerRef) ? `adapter ref ${server.adapterRef || server.providerRef}` : '';
    const extra = [`adapter ${adapter}`, hoster, ref, server.queryPort ? `query ${server.queryPort}` : '', server.adminPort ? `admin ${server.adminPort}` : '', server.credentialEnv ? `credential env ${server.credentialEnv}` : ''].filter(Boolean).join(' • ');
    return `**${server.id} — ${server.name}**\n${server.game} • ${endpoint} • ${server.public === false ? 'private listing' : 'public listing'}\n${extra}`;
  }).join('\n\n').slice(0, 3800);
}
function statusText(server = {}, status = {}) {
  const state = String(status.trackingState || 'unknown').toUpperCase();
  const players = Number.isFinite(Number(status.playerCount)) ? `${status.playerCount}${Number.isFinite(Number(status.playerMax)) ? ` / ${status.playerMax}` : ''}` : 'Not exposed';
  const adapter = server.adapterType || server.providerType || 'none';
  return `📡 **${server.name} — Server Status**\n\n**Adapter**\n${adapter}\n\n**State**\n${state}\n\n**Players**\n${players}\n\n**Adapter note**\n${status.statusMessage || 'No additional status detail.'}\n\nCredentials, adapter references, and private endpoints are not displayed.`;
}
function setupText(server = {}, guide = {}) {
  if (guide.managementMode === 'palworld-adapters') {
    const options = (guide.options || []).map((item) => `**${item.name}**\n${item.description}`).join('\n\n');
    const selected = server.adapterType || server.providerType || 'none';
    return `🔧 **${server.name} — Palworld Connection Setup**\n\nRegistration is host-independent. Configure whichever connection path your server exposes.\n\n**Current adapter**\n${selected}\n\n${options}\n\nUse **/server configure** to attach or change the adapter without recreating the server.`.slice(0, 3900);
  }
  const sections = (guide.sections || []).map((section) => `**${section.title}**\n${(section.settings || []).map((item) => `• ${item}`).join('\n')}`).join('\n\n');
  const warnings = (guide.warnings || []).map((item) => `⚠️ ${item}`).join('\n\n');
  return `🛠️ **${server.name} — Once Human Custom Server Setup**\n\nRegistration in Nexus does **not** depend on NetEase or any other hosting company.\n\nCurrent supported management path for Once Human: **official server-management interface / manual configuration**.\n\n${sections}\n\n**Lifecycle / Safety**\n${warnings}`.slice(0, 3900);
}
async function replyEphemeral(interaction, content) {
  const payload = { content: String(content).slice(0,3900), flags: MessageFlags.Ephemeral, allowedMentions:{parse:[]} };
  if (interaction.deferred || interaction.replied) return interaction.editReply({ content:payload.content, allowedMentions:payload.allowedMentions });
  return interaction.reply(payload);
}

async function handleHostedServerCommand(interaction, context = {}) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== SERVER_COMMAND) return false;
  if (!(await context.isManager(interaction))) { await replyEphemeral(interaction, '⛔ Server management is restricted to Nexus owners and administrators.'); return true; }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'list') {
    const response = await context.backend.hostedServers(); if (!response.ok) throw new Error(response.message || 'Server registry is unavailable.');
    await replyEphemeral(interaction, `🗄️ **Server Registry**\n\n${privateServerList(response.servers || [])}`); return true;
  }
  if (subcommand === 'add') {
    const response = await context.backend.addHostedServer(addInput(interaction)); if (!response.ok) throw new Error(response.message || 'Unable to register server.');
    await context.refresh?.();
    await replyEphemeral(interaction, `✅ **${response.server.name}** registered as **${response.server.id}**.\n\nThe server exists in Nexus independently of its hosting provider or telemetry method. ${response.server.public === false ? 'It is hidden from #game-servers.' : 'The public registry has been refreshed.'}\n\nWhen you are ready, use **/server configure id:${response.server.id}** to attach REST, RCON, Nitrado API, manual management, or another adapter.`); return true;
  }
  if (subcommand === 'edit') {
    const id = String(optionValue(interaction,'id') || '').trim().toUpperCase(); const response = await context.backend.updateHostedServer(id, editInput(interaction));
    if (!response.ok) throw new Error(response.message || response.code || 'Unable to edit server.'); await context.refresh?.();
    await replyEphemeral(interaction, `✅ **${response.server.name}** (${response.server.id}) updated and the registry refreshed.`); return true;
  }
  if (subcommand === 'configure') {
    const id = String(optionValue(interaction,'id') || '').trim().toUpperCase();
    const response = await context.backend.updateHostedServer(id, configureInput(interaction));
    if (!response.ok) throw new Error(response.message || response.code || 'Unable to configure server adapter.');
    await context.refreshProviders?.(); await context.refresh?.();
    await replyEphemeral(interaction, `🔧 **${response.server.name}** (${response.server.id}) adapter set to **${response.server.adapterType || response.server.providerType || 'none'}**.\n\nThe server registration itself was unchanged. Hosting-company metadata is optional and does not control whether the server can exist in Nexus.`); return true;
  }
  if (subcommand === 'setup' || subcommand === 'status') {
    const id = String(optionValue(interaction,'id') || '').trim().toUpperCase();
    const response = await context.backend.hostedServers(); if (!response.ok) throw new Error(response.message || 'Server registry is unavailable.');
    const server = (response.servers || []).find((item) => String(item.id).toUpperCase() === id); if (!server) throw new Error('Server ID was not found.');
    if (subcommand === 'setup') {
      const guide = context.setup?.(server); if (!guide?.ok) throw new Error('No setup guide is available for that server.');
      await replyEphemeral(interaction, setupText(server, guide)); return true;
    }
    const status = await context.probe?.(server); if (!status) throw new Error('No supported live adapter is configured for that server yet.');
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
    await replyEphemeral(interaction, `🔄 Adapter checks completed${status?.length ? ` for ${status.length} registered server${status.length===1?'':'s'}`:''}. #game-servers refreshed${result?.tracked !== undefined ? ` • ${result.tracked} tracked` : ''}.`); return true;
  }
  return false;
}

module.exports = {
  SERVER_COMMAND, ADAPTER_CHOICES, PROVIDER_CHOICES, hostedServerCommand, addInput, editInput, configureInput,
  privateServerList, statusText, setupText, handleHostedServerCommand
};
