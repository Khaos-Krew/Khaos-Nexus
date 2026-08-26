'use strict';

const { MessageFlags, SlashCommandBuilder } = require('discord.js');

const SERVER_COMMAND = 'server';
const PROVIDER_CHOICES = [
  { name: 'Automatic / existing server API', value: 'palworld-rest' },
  { name: 'Nitrado (Palworld)', value: 'nitrado-palworld' },
  { name: 'NetEase / manual (Once Human)', value: 'oncehuman-basic' },
  { name: 'No telemetry', value: 'none' }
];

function hostedServerCommand() {
  return new SlashCommandBuilder().setName(SERVER_COMMAND).setDescription('Manage Khaos Nexus hosted game servers')
    .addSubcommand((sub) => sub.setName('add').setDescription('Register a hosted game server')
      .addStringOption((opt) => opt.setName('game').setDescription('Game').setRequired(true).addChoices({ name: 'Palworld', value: 'palworld' }, { name: 'Once Human', value: 'oncehuman' }))
      .addStringOption((opt) => opt.setName('name').setDescription('Server display name').setRequired(true).setMaxLength(80))
      .addStringOption((opt) => opt.setName('host').setDescription('Server host or domain (kept private)').setRequired(true).setMaxLength(253))
      .addIntegerOption((opt) => opt.setName('port').setDescription('Game/server port').setRequired(true).setMinValue(1).setMaxValue(65535))
      .addStringOption((opt) => opt.setName('provider').setDescription('Hosting/status provider').setRequired(false).addChoices(...PROVIDER_CHOICES))
      .addStringOption((opt) => opt.setName('provider_ref').setDescription('Provider reference, e.g. Nitrado service ID (kept private)').setRequired(false).setMaxLength(80))
      .addStringOption((opt) => opt.setName('credential_env').setDescription('Environment variable name containing provider token; never the token itself').setRequired(false).setMaxLength(80))
      .addStringOption((opt) => opt.setName('join_info').setDescription('Optional public join text').setRequired(false).setMaxLength(200))
      .addStringOption((opt) => opt.setName('description').setDescription('Optional public description').setRequired(false).setMaxLength(300))
      .addIntegerOption((opt) => opt.setName('query_port').setDescription('Optional query/status port').setRequired(false).setMinValue(1).setMaxValue(65535))
      .addIntegerOption((opt) => opt.setName('admin_port').setDescription('Optional REST/RCON/admin port').setRequired(false).setMinValue(1).setMaxValue(65535))
      .addBooleanOption((opt) => opt.setName('public').setDescription('Show this server in #game-servers (default true)').setRequired(false)))
    .addSubcommand((sub) => sub.setName('edit').setDescription('Edit a registered hosted server')
      .addStringOption((opt) => opt.setName('id').setDescription('Server ID from /server list').setRequired(true))
      .addStringOption((opt) => opt.setName('name').setDescription('New display name').setRequired(false).setMaxLength(80))
      .addStringOption((opt) => opt.setName('host').setDescription('New host or domain (kept private)').setRequired(false).setMaxLength(253))
      .addIntegerOption((opt) => opt.setName('port').setDescription('New game/server port').setRequired(false).setMinValue(1).setMaxValue(65535))
      .addStringOption((opt) => opt.setName('provider').setDescription('Hosting/status provider').setRequired(false).addChoices(...PROVIDER_CHOICES))
      .addStringOption((opt) => opt.setName('provider_ref').setDescription('Provider reference, e.g. Nitrado service ID').setRequired(false).setMaxLength(80))
      .addStringOption((opt) => opt.setName('credential_env').setDescription('Environment variable name containing provider token').setRequired(false).setMaxLength(80))
      .addStringOption((opt) => opt.setName('join_info').setDescription('New public join text').setRequired(false).setMaxLength(200))
      .addStringOption((opt) => opt.setName('description').setDescription('New public description').setRequired(false).setMaxLength(300))
      .addIntegerOption((opt) => opt.setName('query_port').setDescription('New query/status port').setRequired(false).setMinValue(1).setMaxValue(65535))
      .addIntegerOption((opt) => opt.setName('admin_port').setDescription('New REST/RCON/admin port').setRequired(false).setMinValue(1).setMaxValue(65535))
      .addBooleanOption((opt) => opt.setName('public').setDescription('Show this server in #game-servers').setRequired(false)))
    .addSubcommand((sub) => sub.setName('status').setDescription('Check live provider status for one hosted server')
      .addStringOption((opt) => opt.setName('id').setDescription('Server ID from /server list').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a registered hosted server')
      .addStringOption((opt) => opt.setName('id').setDescription('Server ID from /server list').setRequired(true))
      .addBooleanOption((opt) => opt.setName('confirm').setDescription('Confirm permanent removal').setRequired(true)))
    .addSubcommand((sub) => sub.setName('list').setDescription('List privately registered hosted servers'))
    .addSubcommand((sub) => sub.setName('refresh').setDescription('Refresh provider status and #game-servers'));
}

function optionValue(interaction, name) { return interaction.options?.get?.(name)?.value; }
function addInput(interaction) {
  const game = String(optionValue(interaction, 'game') || '');
  return {
    moduleId: game, name: String(optionValue(interaction, 'name') || ''), host: String(optionValue(interaction, 'host') || ''), port: optionValue(interaction, 'port'),
    queryPort: optionValue(interaction, 'query_port'), adminPort: optionValue(interaction, 'admin_port'), description: String(optionValue(interaction, 'description') || ''),
    joinInfo: String(optionValue(interaction, 'join_info') || ''), credentialEnv: String(optionValue(interaction, 'credential_env') || ''), providerRef: String(optionValue(interaction, 'provider_ref') || ''),
    providerType: String(optionValue(interaction, 'provider') || (game === 'palworld' ? 'palworld-rest' : 'oncehuman-basic')), public: optionValue(interaction, 'public') !== false
  };
}
function editInput(interaction) {
  const mapping = { name:'name', host:'host', port:'port', query_port:'queryPort', admin_port:'adminPort', description:'description', join_info:'joinInfo', credential_env:'credentialEnv', provider_ref:'providerRef', provider:'providerType', public:'public' };
  const input = {};
  for (const [optionName, target] of Object.entries(mapping)) { const value = optionValue(interaction, optionName); if (value !== undefined && value !== null) input[target] = value; }
  return input;
}
function privateServerList(servers = []) {
  if (!servers.length) return 'No hosted servers are registered yet.';
  return servers.map((server) => {
    const endpoint = `${server.host || 'unknown'}${server.port ? `:${server.port}` : ''}`;
    const provider = server.providerType ? `provider ${server.providerType}` : '';
    const ref = server.providerRef ? `ref ${server.providerRef}` : '';
    const extra = [provider, ref, server.queryPort ? `query ${server.queryPort}` : '', server.adminPort ? `admin ${server.adminPort}` : '', server.credentialEnv ? `credential env ${server.credentialEnv}` : ''].filter(Boolean).join(' • ');
    return `**${server.id} — ${server.name}**\n${server.game} • ${endpoint} • ${server.public === false ? 'private listing' : 'public listing'}${extra ? `\n${extra}` : ''}`;
  }).join('\n\n').slice(0, 3800);
}
function statusText(server = {}, status = {}) {
  const state = String(status.trackingState || 'unknown').toUpperCase();
  const players = Number.isFinite(Number(status.playerCount)) ? `${status.playerCount}${Number.isFinite(Number(status.playerMax)) ? ` / ${status.playerMax}` : ''}` : 'Not exposed';
  return `📡 **${server.name} — Provider Status**\n\n**Provider**\n${server.providerType || 'none'}\n\n**State**\n${state}\n\n**Players**\n${players}\n\n**Provider note**\n${status.statusMessage || 'No additional status detail.'}\n\nProvider credentials and private endpoints are not displayed.`;
}
async function replyEphemeral(interaction, content) {
  const payload = { content: String(content).slice(0,3900), flags: MessageFlags.Ephemeral, allowedMentions:{parse:[]} };
  if (interaction.deferred || interaction.replied) return interaction.editReply({ content:payload.content, allowedMentions:payload.allowedMentions });
  return interaction.reply(payload);
}

async function handleHostedServerCommand(interaction, context = {}) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== SERVER_COMMAND) return false;
  if (!(await context.isManager(interaction))) { await replyEphemeral(interaction, '⛔ Hosted server management is restricted to Nexus owners and administrators.'); return true; }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'list') {
    const response = await context.backend.hostedServers(); if (!response.ok) throw new Error(response.message || 'Hosted-server registry is unavailable.');
    await replyEphemeral(interaction, `🗄️ **Hosted Server Registry**\n\n${privateServerList(response.servers || [])}`); return true;
  }
  if (subcommand === 'add') {
    const response = await context.backend.addHostedServer(addInput(interaction)); if (!response.ok) throw new Error(response.message || 'Unable to register hosted server.');
    await context.refresh?.(); await replyEphemeral(interaction, `✅ **${response.server.name}** registered as **${response.server.id}**.\n\nPrivate endpoint/provider details stay private. ${response.server.public === false ? 'This server is hidden from #game-servers.' : 'The public registry has been refreshed.'}`); return true;
  }
  if (subcommand === 'edit') {
    const id = String(optionValue(interaction,'id') || '').trim().toUpperCase(); const response = await context.backend.updateHostedServer(id, editInput(interaction));
    if (!response.ok) throw new Error(response.message || response.code || 'Unable to edit hosted server.'); await context.refresh?.();
    await replyEphemeral(interaction, `✅ **${response.server.name}** (${response.server.id}) updated and the registry refreshed.`); return true;
  }
  if (subcommand === 'status') {
    const id = String(optionValue(interaction,'id') || '').trim().toUpperCase();
    const response = await context.backend.hostedServers(); if (!response.ok) throw new Error(response.message || 'Hosted-server registry is unavailable.');
    const server = (response.servers || []).find((item) => String(item.id).toUpperCase() === id); if (!server) throw new Error('Server ID was not found.');
    const status = await context.probe?.(server); if (!status) throw new Error('That server provider does not expose supported live telemetry yet.');
    await replyEphemeral(interaction, statusText(server, status)); return true;
  }
  if (subcommand === 'remove') {
    const id = String(optionValue(interaction,'id') || '').trim().toUpperCase(); if (optionValue(interaction,'confirm') !== true) { await replyEphemeral(interaction,'Removal cancelled. Run again with **confirm: true**.'); return true; }
    const response = await context.backend.removeHostedServer(id); if (!response.ok) throw new Error(response.message || response.code || 'Unable to remove hosted server.'); await context.refresh?.();
    await replyEphemeral(interaction, `🗑️ **${id}** removed from the hosted-server registry.`); return true;
  }
  if (subcommand === 'refresh') {
    const status = await context.refreshProviders?.(); const result = await context.refresh?.();
    await replyEphemeral(interaction, `🔄 Provider checks completed${status?.length ? ` for ${status.length} registered server${status.length===1?'':'s'}`:''}. #game-servers refreshed${result?.tracked !== undefined ? ` • ${result.tracked} tracked` : ''}.`); return true;
  }
  return false;
}

module.exports = { SERVER_COMMAND, PROVIDER_CHOICES, hostedServerCommand, addInput, editInput, privateServerList, statusText, handleHostedServerCommand };
