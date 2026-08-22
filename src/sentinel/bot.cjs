'use strict';

const crypto = require('node:crypto');
const { Client, GatewayIntentBits, PermissionFlagsBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { loadConfig, envSecret } = require('../shared/config.cjs');
const { getModule, MODULES } = require('../backend/modules/catalog.cjs');
const { BackendClient } = require('./backend-client.cjs');
const { StateStore } = require('./state-store.cjs');
const { ModuleProvisioner } = require('./module-provisioner.cjs');
const { parseActionId, renderModuleConsole, renderHelp } = require('./module-console.cjs');

const config = loadConfig();
const token = envSecret(config.discord?.tokenEnv);
if (!token) throw new Error(`Set ${config.discord?.tokenEnv || 'NEXUS_SENTINEL_TOKEN'} before starting Nexus Sentinal.`);
const guildId = String(config.discord?.guildId || '');
if (!guildId) throw new Error('Set discord.guildId in config.json before starting Nexus Sentinal.');

const backend = new BackendClient(config);
const state = new StateStore();
const pending = new Map();
const provisioner = new ModuleProvisioner({ state, maxLobbiesPerModule: config.discord?.maxTemporaryLobbiesPerModule || 20 });
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

function roleFor(interaction) {
  if ((config.discord?.ownerUserIds || []).includes(String(interaction.user.id))) return 'owner';
  const roles = interaction.member?.roles?.cache;
  if (roles && (config.discord?.operatorRoleIds || []).some((id) => roles.has(String(id)))) return 'operator';
  return 'viewer';
}

function canSetup(interaction) {
  if (roleFor(interaction) === 'owner') return true;
  return Boolean(interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild));
}

function confirmationRow(nonce) {
  return [{ type: 1, components: [
    { type: 2, style: 4, label: 'Confirm', custom_id: `nexusconfirm:${nonce}` },
    { type: 2, style: 2, label: 'Cancel', custom_id: `nexuscancel:${nonce}` }
  ] }];
}

function setupStart() {
  return {
    content: '**Nexus Sentinal • Game Module Setup**\nChoose the game module you want to assign. Sentinal can create a new category or build inside an existing category.',
    components: [{
      type: 1,
      components: [{
        type: 3,
        custom_id: 'nexussetup:module',
        placeholder: 'Choose a game module',
        min_values: 1,
        max_values: 1,
        options: MODULES.map((module) => ({ label: module.name.slice(0, 100), value: module.id, description: `${module.console === false ? 'Veyra' : 'Sentinal'} surface • build Discord channels`.slice(0, 100) }))
      }]
    }]
  };
}

function setupCategoryPicker(moduleId) {
  const module = getModule(moduleId);
  return {
    content: `**${module.name}**\nChoose an existing category, or let Sentinal create the default category and channel layout automatically. Re-running this later repairs missing channels instead of duplicating them.`,
    components: [
      { type: 1, components: [{ type: 8, custom_id: `nexussetup:category:${moduleId}`, placeholder: 'Use an existing Discord category', min_values: 1, max_values: 1, channel_types: [4] }] },
      { type: 1, components: [{ type: 2, style: 3, label: 'Create Default Category', custom_id: `nexussetup:create:${moduleId}` }] }
    ]
  };
}

function createPending(interaction, moduleId, actionId, payload) {
  const nonce = crypto.randomBytes(12).toString('hex');
  pending.set(nonce, {
    moduleId,
    actionId,
    payload,
    userId: String(interaction.user.id),
    role: roleFor(interaction),
    expiresAt: Date.now() + 5 * 60 * 1000
  });
  return nonce;
}

async function manifestState(moduleId) {
  const result = await backend.modules();
  return result.modules?.find((module) => module.id === moduleId) || { id: moduleId, enabled: true, configured: false };
}

async function retireOldConsole(saved, newChannelId) {
  if (!saved?.messageId || !saved.channelId || saved.channelId === String(newChannelId)) return;
  try {
    const oldChannel = await client.channels.fetch(String(saved.channelId));
    if (!oldChannel?.isTextBased?.()) return;
    const oldMessage = await oldChannel.messages.fetch(String(saved.messageId));
    await oldMessage.delete();
  } catch {}
}

async function ensureConsole(moduleId) {
  const moduleConfig = config.modules?.[moduleId] || {};
  const module = getModule(moduleId);
  const setup = state.getModuleSetup(moduleId);
  const channelId = setup?.consoleChannelId || moduleConfig.channelId || '';
  if (!module || module.console === false || moduleConfig.enabled === false || !channelId) return null;
  const channel = await client.channels.fetch(String(channelId));
  if (!channel?.isTextBased?.()) throw new Error(`${module.name}: configured channel is not text-capable.`);
  const payload = renderModuleConsole(moduleId, await manifestState(moduleId));
  const saved = state.getConsole(moduleId);
  await retireOldConsole(saved, channel.id);
  let message = null;
  if (saved?.messageId && saved.channelId === String(channel.id)) {
    try { message = await channel.messages.fetch(saved.messageId); await message.edit(payload); } catch { message = null; }
  }
  if (!message) message = await channel.send(payload);
  state.setConsole(moduleId, { guildId, channelId: String(channel.id), messageId: String(message.id), updatedAt: new Date().toISOString() });
  return message;
}

async function ensureAllConsoles() {
  const moduleIds = new Set([...Object.keys(config.modules || {}), ...Object.keys(state.listModuleSetups())]);
  for (const moduleId of moduleIds) {
    try { await ensureConsole(moduleId); } catch (error) { console.error(`[Sentinal] ${moduleId} console:`, error.message); }
  }
}

async function provisionModule(interaction, moduleId, categoryId = '') {
  if (!canSetup(interaction)) throw new Error('Module setup requires Nexus owner access or Discord Manage Server permission.');
  const setup = await provisioner.provision(interaction.guild, moduleId, categoryId);
  const consoleMessage = await ensureConsole(moduleId);
  const module = getModule(moduleId);
  const channels = setup.textChannels.map((channel) => `<#${channel.id}>`).join(' • ');
  return {
    content: `✅ **${module.name} Discord setup complete**\nCategory: <#${setup.categoryId}>\nChannels: ${channels}\nJoin-to-build: <#${setup.lobbyBuilderChannelId}>\n${consoleMessage ? 'Sentinal console published/reconciled.' : module.surface === 'veyra' ? 'Channel layout is ready; Veyra remains the interactive D&D surface.' : 'Console will publish when the module surface is enabled.'}`,
    components: []
  };
}

async function registerCommands() {
  const command = new SlashCommandBuilder()
    .setName('nexus')
    .setDescription('Nexus Sentinal module tools')
    .addSubcommand((sub) => sub.setName('setup').setDescription('Build or repair a game module Discord category and channels'))
    .addSubcommand((sub) => sub.setName('modules').setDescription('Show backend module health'))
    .addSubcommand((sub) => sub.setName('refresh').setDescription('Refresh a module console').addStringOption((opt) => opt.setName('module').setDescription('Module id').setRequired(true)))
    .addSubcommand((sub) => sub.setName('run').setDescription('Run an advanced module action').addStringOption((opt) => opt.setName('module').setDescription('Module id').setRequired(true)).addStringOption((opt) => opt.setName('action').setDescription('Action id').setRequired(true)).addStringOption((opt) => opt.setName('input').setDescription('Optional text input')));
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: [command.toJSON()] });
}

async function runAction(interaction, moduleId, actionId, payload = {}) {
  const result = await backend.invoke(moduleId, actionId, payload, { role: roleFor(interaction), actorId: String(interaction.user.id), confirmed: false });
  if (result.code === 'CONFIRMATION_REQUIRED') {
    const nonce = createPending(interaction, moduleId, actionId, payload);
    return { content: `⚠️ **Confirmation required**\n${result.message}`, components: confirmationRow(nonce) };
  }
  if (!result.ok) return { content: `⚠️ ${result.message || result.code}`, components: [] };
  return { content: `✅ ${getModule(moduleId)?.name || moduleId}: ${actionId} completed.\n\`\`\`${JSON.stringify(result.data, null, 2).slice(0, 1600)}\`\`\``, components: [] };
}

client.once('ready', async () => {
  console.log(`[Nexus Sentinal] logged in as ${client.user.tag}`);
  await registerCommands();
  await provisioner.cleanupOrphanedLobbies(client);
  await ensureAllConsoles();
});

client.on('voiceStateUpdate', (oldState, newState) => {
  provisioner.handleVoiceState(oldState, newState).catch((error) => console.error('[Sentinal] voice lobby event:', error.message));
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isStringSelectMenu() && interaction.customId === 'nexussetup:module') {
      if (!canSetup(interaction)) return interaction.reply({ content: 'Module setup requires Nexus owner access or Discord Manage Server permission.', ephemeral: true });
      return interaction.update(setupCategoryPicker(interaction.values[0]));
    }

    if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('nexussetup:category:')) {
      const moduleId = interaction.customId.split(':')[2];
      await interaction.deferUpdate();
      return interaction.editReply(await provisionModule(interaction, moduleId, interaction.values[0]));
    }

    if (interaction.isButton()) {
      const setupCreate = /^nexussetup:create:([a-z0-9-]+)$/.exec(interaction.customId);
      if (setupCreate) {
        await interaction.deferUpdate();
        return interaction.editReply(await provisionModule(interaction, setupCreate[1], ''));
      }

      const confirm = /^(nexusconfirm|nexuscancel):([a-f0-9]{24})$/.exec(interaction.customId);
      if (confirm) {
        const item = pending.get(confirm[2]);
        if (!item || item.expiresAt < Date.now()) {
          pending.delete(confirm[2]);
          return interaction.reply({ content: 'That confirmation expired. Run the action again.', ephemeral: true });
        }
        if (item.userId !== String(interaction.user.id)) return interaction.reply({ content: 'Only the user who requested this action can confirm it.', ephemeral: true });
        pending.delete(confirm[2]);
        if (confirm[1] === 'nexuscancel') return interaction.update({ content: 'Action cancelled.', components: [] });
        await interaction.deferUpdate();
        const result = await backend.invoke(item.moduleId, item.actionId, item.payload, { role: item.role, actorId: item.userId, confirmed: true });
        return interaction.editReply({ content: result.ok ? `✅ ${getModule(item.moduleId)?.name || item.moduleId}: ${item.actionId} completed.\n\`\`\`${JSON.stringify(result.data, null, 2).slice(0, 1600)}\`\`\`` : `⚠️ ${result.message || result.code}`, components: [] });
      }

      const parsed = parseActionId(interaction.customId);
      if (!parsed) return;
      if (parsed.actionId === 'help') return interaction.reply(renderHelp(parsed.moduleId));
      if (parsed.actionId === 'refresh') { await ensureConsole(parsed.moduleId); return interaction.reply({ content: 'Module console refreshed.', ephemeral: true }); }
      await interaction.deferReply({ ephemeral: true });
      return interaction.editReply(await runAction(interaction, parsed.moduleId, parsed.actionId, {}));
    }

    if (!interaction.isChatInputCommand() || interaction.commandName !== 'nexus') return;
    const sub = interaction.options.getSubcommand();
    if (sub === 'setup') {
      if (!canSetup(interaction)) return interaction.reply({ content: 'Module setup requires Nexus owner access or Discord Manage Server permission.', ephemeral: true });
      return interaction.reply({ ...setupStart(), ephemeral: true });
    }
    if (sub === 'modules') {
      const result = await backend.modules();
      const setups = state.listModuleSetups();
      const lines = (result.modules || []).map((m) => `${m.enabled ? '🟢' : '⚫'} **${m.name}** — ${m.configured ? 'provider ready' : 'provider setup needed'} • ${setups[m.id] ? 'Discord ready' : 'run /nexus setup'}`);
      return interaction.reply({ content: lines.join('\n') || 'No modules registered.', ephemeral: true });
    }
    if (sub === 'refresh') {
      const moduleId = interaction.options.getString('module', true).toLowerCase();
      await ensureConsole(moduleId);
      return interaction.reply({ content: `Refreshed ${moduleId}.`, ephemeral: true });
    }
    if (sub === 'run') {
      const moduleId = interaction.options.getString('module', true).toLowerCase();
      const actionId = interaction.options.getString('action', true).toLowerCase();
      const input = interaction.options.getString('input') || '';
      return interaction.reply({ ...(await runAction(interaction, moduleId, actionId, { input })), ephemeral: true });
    }
  } catch (error) {
    const payload = { content: `⚠️ ${String(error?.message || error)}`.slice(0, 1900), ephemeral: true };
    if (interaction.deferred || interaction.replied) return interaction.editReply({ content: payload.content, components: [] });
    return interaction.reply(payload);
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [nonce, item] of pending) if (item.expiresAt < now) pending.delete(nonce);
}, 60_000).unref();

client.login(token);
