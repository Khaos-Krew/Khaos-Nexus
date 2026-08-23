'use strict';

const crypto = require('node:crypto');
const { Client, Events, GatewayIntentBits, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { loadConfig, envSecret } = require('../shared/config.cjs');
const { getModule, MODULES } = require('../backend/modules/catalog.cjs');
const { BackendClient } = require('./backend-client.cjs');
const { StateStore } = require('./state-store.cjs');
const { ModuleProvisioner } = require('./module-provisioner.cjs');
const { hasAdministrator, assertAdministrator } = require('./discord-permissions.cjs');
const { parseActionId, renderModuleConsole, renderHelp } = require('./module-console.cjs');

const config = loadConfig();
const token = envSecret(config.discord?.tokenEnv);
if (!token) throw new Error(`Set ${config.discord?.tokenEnv || 'NEXUS_SENTINEL_TOKEN'} before starting Nexus Sentinal.`);
const guildId = String(config.discord?.guildId || '');
if (!guildId) throw new Error('Set discord.guildId in config.json or NEXUS_DISCORD_GUILD_ID before starting Nexus Sentinal.');

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
    content: '**Nexus Sentinal • Game Module Setup**\nChoose a module. Sentinal will automatically reuse a matching/similar category when one already exists, populate any missing module channels, or create a new category when no match exists.',
    components: [{
      type: 1,
      components: [{
        type: 3,
        custom_id: 'nexussetup:module',
        placeholder: 'Choose a game module',
        min_values: 1,
        max_values: 1,
        options: MODULES.map((module) => ({ label: module.name.slice(0, 100), value: module.id, description: `${module.console === false ? 'Veyra' : 'Sentinal'} surface • reconcile Discord channels`.slice(0, 100) }))
      }]
    }]
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

function setupSummary(module, setup, consoleMessage) {
  const categoryResult = setup.categoryCreated
    ? `Created **${setup.categoryName}**`
    : setup.categorySource === 'similar'
      ? `Reused matching category **${setup.categoryName}**`
      : `Reused **${setup.categoryName}**`;
  const additions = setup.createdChannels.length
    ? `Added missing channels: ${setup.createdChannels.map((name) => `\`${name}\``).join(', ')}`
    : 'No channels were missing.';
  const surface = consoleMessage
    ? 'Sentinal console published/reconciled.'
    : module.surface === 'veyra'
      ? 'Channel layout is ready; Veyra remains the interactive D&D surface.'
      : 'Module channel layout is ready.';
  return `✅ **${module.name} Discord setup complete**\n${categoryResult}\n${additions}\nJoin-to-build: <#${setup.lobbyBuilderChannelId}>\n${surface}`;
}

async function provisionModule(interaction, moduleId) {
  if (!canSetup(interaction)) throw new Error('Module setup requires Nexus owner access or Discord Manage Server permission.');
  assertAdministrator(interaction.guild);
  const setup = await provisioner.provision(interaction.guild, moduleId);
  const consoleMessage = await ensureConsole(moduleId);
  const module = getModule(moduleId);
  return { content: setupSummary(module, setup, consoleMessage), components: [] };
}

async function repairModules(interaction, requestedModuleId = '') {
  if (!canSetup(interaction)) throw new Error('Module repair requires Nexus owner access or Discord Manage Server permission.');
  assertAdministrator(interaction.guild);
  const moduleIds = requestedModuleId ? [requestedModuleId] : await provisioner.discoverModuleIds(interaction.guild);
  if (!moduleIds.length) return 'No existing Nexus module categories were detected. Run `/nexus setup` to install the first module.';

  const lines = [];
  for (const moduleId of moduleIds) {
    const module = getModule(moduleId);
    if (!module) continue;
    const setup = await provisioner.provision(interaction.guild, moduleId);
    await ensureConsole(moduleId);
    lines.push(`✅ **${module.name}** — ${setup.createdChannels.length ? `restored ${setup.createdChannels.length} missing channel${setup.createdChannels.length === 1 ? '' : 's'}` : 'layout already complete'}`);
  }
  return `**Nexus repair complete**\n${lines.join('\n')}`;
}

function nexusCommand() {
  return new SlashCommandBuilder()
    .setName('nexus')
    .setDescription('Nexus Sentinal module tools')
    .addSubcommand((sub) => sub.setName('setup').setDescription('Detect/reuse a game category or build a new module layout'))
    .addSubcommand((sub) => sub
      .setName('repair')
      .setDescription('Repair missing module channels and consoles')
      .addStringOption((opt) => opt
        .setName('module')
        .setDescription('Optional module to repair; omit to repair all detected modules')
        .setRequired(false)
        .addChoices(...MODULES.map((module) => ({ name: module.name.slice(0, 100), value: module.id })))))
    .addSubcommand((sub) => sub.setName('modules').setDescription('Show Nexus module Discord status'))
    .addSubcommand((sub) => sub.setName('refresh').setDescription('Refresh a module console').addStringOption((opt) => opt.setName('module').setDescription('Module id').setRequired(true)))
    .addSubcommand((sub) => sub.setName('run').setDescription('Run an advanced module action').addStringOption((opt) => opt.setName('module').setDescription('Module id').setRequired(true)).addStringOption((opt) => opt.setName('action').setDescription('Action id').setRequired(true)).addStringOption((opt) => opt.setName('input').setDescription('Optional text input')));
}

async function registerCommands(guild) {
  const command = nexusCommand();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === command.name);
  if (existing) await guild.commands.edit(existing, command.toJSON());
  else await guild.commands.create(command.toJSON());
  console.log(`[Nexus Sentinal] registered /nexus in guild ${guild.id} without replacing existing commands`);
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

client.once(Events.ClientReady, async () => {
  console.log(`[Nexus Sentinal] logged in as ${client.user.tag}`);
  const guild = await client.guilds.fetch(guildId);
  if (!hasAdministrator(guild)) {
    console.error('[Nexus Sentinal] Administrator permission is required. Re-authorize the bot with Discord Administrator before running module setup or temporary lobby management.');
  }
  await registerCommands(guild);
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
      assertAdministrator(interaction.guild);
      await interaction.deferUpdate();
      return interaction.editReply(await provisionModule(interaction, interaction.values[0]));
    }

    if (interaction.isButton()) {
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
      assertAdministrator(interaction.guild);
      return interaction.reply({ ...setupStart(), ephemeral: true });
    }
    if (sub === 'repair') {
      const moduleId = interaction.options.getString('module') || '';
      await interaction.deferReply({ ephemeral: true });
      return interaction.editReply(await repairModules(interaction, moduleId));
    }
    if (sub === 'modules') {
      const result = await backend.modules();
      const discovered = new Set(await provisioner.discoverModuleIds(interaction.guild));
      const admin = hasAdministrator(interaction.guild) ? 'Administrator ready' : '⚠️ Administrator missing';
      const lines = [`**Sentinal:** ${admin}`, ...(result.modules || []).map((m) => {
        const discordStatus = discovered.has(m.id) ? 'Discord ready' : 'not set up';
        const connection = m.configured ? ' • connected' : '';
        return `${m.enabled ? '🟢' : '⚫'} **${m.name}** — ${discordStatus}${connection}`;
      })];
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
