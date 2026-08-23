'use strict';

const crypto = require('node:crypto');
const { Client, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { loadConfig, envSecret } = require('../shared/config.cjs');
const { getModule, MODULES } = require('../backend/modules/catalog.cjs');
const { BackendClient } = require('./backend-client.cjs');
const { StateStore } = require('./state-store.cjs');
const { ModuleProvisioner } = require('./module-provisioner.cjs');
const { hasAdministrator, assertAdministrator } = require('./discord-permissions.cjs');
const { parseActionId, renderModuleConsole, renderHelp } = require('./module-console.cjs');
const { formatActionResult: renderActionResult } = require('./action-formatters.cjs');
const { marketCommand } = require('./commands.cjs');
const { commandDefinitions: friendlyCommandDefinitions, commandNames: friendlyCommandNames, isFriendlyCommand, resolveFriendlyCommand } = require('./friendly-commands.cjs');
const { SentinalAdminOps } = require('./admin-ops.cjs');
const { createSentinalAdminServer } = require('./admin-server.cjs');

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
let adminOps = null;

const adminToken = envSecret(config.discord?.sentinalAdminTokenEnv || 'NEXUS_SENTINAL_ADMIN_TOKEN');
const railwayAdmin = Boolean(adminToken && process.env.PORT);
const adminHost = String(process.env.NEXUS_SENTINAL_ADMIN_HOST || (railwayAdmin ? '0.0.0.0' : '127.0.0.1'));
const adminPort = Number(process.env.NEXUS_SENTINAL_ADMIN_PORT || (railwayAdmin ? process.env.PORT : 3220));
const adminServer = createSentinalAdminServer({
  host: adminHost,
  port: adminPort,
  token: adminToken,
  getController: () => adminOps
});
adminServer.start().catch((error) => console.error('[Nexus Sentinal Admin] startup failed:', error.message));

const moduleChoices = () => MODULES.map((module) => ({ name: module.name.slice(0, 100), value: module.id }));
const enabledModuleIds = () => MODULES.filter((module) => config.modules?.[module.id]?.enabled !== false).map((module) => module.id);

function configuredRoleFor(interaction) {
  if ((config.discord?.ownerUserIds || []).includes(String(interaction.user.id))) return 'owner';
  const roles = interaction.member?.roles?.cache;
  if (roles && (config.discord?.operatorRoleIds || []).some((id) => roles.has(String(id)))) return 'operator';
  return 'viewer';
}

async function roleFor(interaction) {
  const configured = configuredRoleFor(interaction);
  if (configured !== 'viewer') return configured;
  const linked = await backend.accountByDiscord(String(interaction.user.id)).catch(() => null);
  if (linked?.ok && ['owner', 'co-owner'].includes(linked.account?.role)) return 'owner';
  return 'viewer';
}

async function canSetup(interaction) {
  if (await roleFor(interaction) === 'owner') return true;
  return Boolean(interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild));
}

function interactionAlreadyAcknowledged(error) {
  return Number(error?.code) === 40060 || Number(error?.rawError?.code) === 40060;
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
        options: MODULES.map((module) => ({
          label: module.name.slice(0, 100),
          value: module.id,
          description: `${module.console === false ? 'Veyra' : 'Sentinal'} surface • reconcile Discord channels`.slice(0, 100)
        }))
      }]
    }]
  };
}

function createPending(interaction, moduleId, actionId, payload, role) {
  const nonce = crypto.randomBytes(12).toString('hex');
  pending.set(nonce, {
    moduleId,
    actionId,
    payload,
    userId: String(interaction.user.id),
    role,
    expiresAt: Date.now() + 5 * 60 * 1000
  });
  return nonce;
}

async function manifestState(moduleId) {
  const result = await backend.modules();
  return result.modules?.find((module) => module.id === moduleId) || {
    id: moduleId,
    enabled: true,
    configured: false,
    connected: false,
    availableActions: []
  };
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
    try {
      message = await channel.messages.fetch(saved.messageId);
      await message.edit(payload);
    } catch { message = null; }
  }
  if (!message) message = await channel.send(payload);
  state.setConsole(moduleId, {
    guildId,
    channelId: String(channel.id),
    messageId: String(message.id),
    updatedAt: new Date().toISOString()
  });
  return message;
}

async function ensureAllConsoles() {
  const moduleIds = new Set([...Object.keys(config.modules || {}), ...Object.keys(state.listModuleSetups())]);
  for (const moduleId of moduleIds) {
    try { await ensureConsole(moduleId); }
    catch (error) { console.error(`[Sentinal] ${moduleId} console:`, error.message); }
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
  if (!(await canSetup(interaction))) throw new Error('Module setup requires Nexus owner access or Discord Manage Server permission.');
  assertAdministrator(interaction.guild);
  const setup = await provisioner.provision(interaction.guild, moduleId);
  const consoleMessage = await ensureConsole(moduleId);
  const module = getModule(moduleId);
  return { content: setupSummary(module, setup, consoleMessage), components: [] };
}

async function repairModuleIds(interaction, moduleIds, title) {
  if (!(await canSetup(interaction))) throw new Error('Module repair requires Nexus owner access or Discord Manage Server permission.');
  assertAdministrator(interaction.guild);
  const lines = [];
  for (const moduleId of moduleIds) {
    const module = getModule(moduleId);
    if (!module) continue;
    try {
      const setup = await provisioner.provision(interaction.guild, moduleId);
      await ensureConsole(moduleId);
      const changes = [];
      if (setup.categoryCreated) changes.push('created category');
      if (setup.createdChannels.length) changes.push(`restored ${setup.createdChannels.length} channel${setup.createdChannels.length === 1 ? '' : 's'}`);
      lines.push(`✅ **${module.name}** — ${changes.length ? changes.join(' • ') : 'layout already complete'}`);
    } catch (error) {
      lines.push(`⚠️ **${module.name}** — ${String(error?.message || error).slice(0, 160)}`);
    }
  }
  return `**${title}**\n${lines.join('\n')}`;
}

async function repairModules(interaction, requestedModuleId = '') {
  if (requestedModuleId) return repairModuleIds(interaction, [requestedModuleId], 'Nexus module repair complete');
  return repairModuleIds(interaction, enabledModuleIds(), 'Nexus full repair complete');
}

async function repairAllModules(interaction) {
  return repairModuleIds(interaction, MODULES.map((module) => module.id), 'Nexus Repair All complete');
}

function nexusCommand() {
  return new SlashCommandBuilder()
    .setName('nexus')
    .setDescription('Nexus Sentinal setup and administration')
    .addSubcommand((sub) => sub.setName('setup').setDescription('Detect/reuse a game category or build a new module layout'))
    .addSubcommand((sub) => sub
      .setName('link')
      .setDescription('Link this Discord account to a Nexus household account')
      .addStringOption((opt) => opt.setName('code').setDescription('One-time code from Accounts & Access').setRequired(true)))
    .addSubcommand((sub) => sub.setName('account').setDescription('Show your linked Nexus account status'))
    .addSubcommand((sub) => sub
      .setName('repair')
      .setDescription('Repair every enabled Nexus module, or one selected module')
      .addStringOption((opt) => opt
        .setName('module')
        .setDescription('Optional module; omit to reconcile every enabled module')
        .setRequired(false)
        .addChoices(...moduleChoices())))
    .addSubcommand((sub) => sub
      .setName('repair-all')
      .setDescription('Compatibility command: create or repair every registered module, including disabled ones'))
    .addSubcommand((sub) => sub.setName('modules').setDescription('Show Nexus module Discord/backend status'))
    .addSubcommand((sub) => sub
      .setName('features')
      .setDescription('Show the easy commands for a module')
      .addStringOption((opt) => opt.setName('module').setDescription('Game module').setRequired(true).addChoices(...moduleChoices())))
    .addSubcommand((sub) => sub
      .setName('refresh')
      .setDescription('Refresh a module console')
      .addStringOption((opt) => opt.setName('module').setDescription('Game module').setRequired(true).addChoices(...moduleChoices())))
    .addSubcommand((sub) => sub
      .setName('run')
      .setDescription('Advanced compatibility tool for backend actions')
      .addStringOption((opt) => opt.setName('module').setDescription('Game module').setRequired(true).addChoices(...moduleChoices()))
      .addStringOption((opt) => opt.setName('action').setDescription('Advanced backend action').setRequired(true).setAutocomplete(true))
      .addStringOption((opt) => opt.setName('input').setDescription('Advanced action input')));
}

async function registerCommands(guild) {
  const definitions = [nexusCommand(), marketCommand(), ...friendlyCommandDefinitions()];
  const commands = await guild.commands.fetch();
  for (const command of definitions) {
    const existing = commands.find((item) => item.name === command.name);
    if (existing) await guild.commands.edit(existing, command.toJSON());
    else await guild.commands.create(command.toJSON());
  }
  console.log(`[Nexus Sentinal] registered ${definitions.map((item) => `/${item.name}`).join(', ')} in guild ${guild.id} without replacing unrelated commands`);
}

function formatActionResult(moduleId, actionId, result) {
  return renderActionResult(moduleId, actionId, result);
}

async function runAction(interaction, moduleId, actionId, payload = {}) {
  const role = await roleFor(interaction);
  const result = await backend.invoke(moduleId, actionId, payload, {
    role,
    actorId: String(interaction.user.id),
    confirmed: false
  });
  if (result.code === 'CONFIRMATION_REQUIRED') {
    const nonce = createPending(interaction, moduleId, actionId, payload, role);
    return { content: `⚠️ **Confirmation required**\n${result.message}`, components: confirmationRow(nonce) };
  }
  return formatActionResult(moduleId, actionId, result);
}

async function autocompleteActions(interaction) {
  if (interaction.commandName !== 'nexus' || interaction.options.getSubcommand(false) !== 'run') return interaction.respond([]);
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'action') return interaction.respond([]);
  const moduleId = String(interaction.options.getString('module') || '').toLowerCase();
  const module = getModule(moduleId);
  if (!module) return interaction.respond([]);
  const query = String(focused.value || '').toLowerCase();
  const choices = module.capabilities
    .filter((capability) => !query || capability.id.includes(query) || capability.label.toLowerCase().includes(query))
    .slice(0, 25)
    .map((capability) => ({ name: `${capability.label} (${capability.id})`.slice(0, 100), value: capability.id }));
  return interaction.respond(choices);
}

function friendlyResponsePrivate(invocation) {
  const module = getModule(invocation.moduleId);
  const capability = module?.capabilities.find((item) => item.id === invocation.actionId);
  return Boolean(capability && (capability.destructive || capability.requiredRole !== 'viewer'));
}

client.once(Events.ClientReady, async () => {
  console.log(`[Nexus Sentinal] logged in as ${client.user.tag}`);
  const guild = await client.guilds.fetch(guildId);
  adminOps = new SentinalAdminOps({ client, guild, config, state, provisioner, backend, ensureConsole, registerCommands });
  if (!hasAdministrator(guild)) {
    console.error('[Nexus Sentinal] Administrator permission is required. Re-authorize the bot with Discord Administrator before running module setup or temporary lobby management.');
  }
  await registerCommands(guild);
  await provisioner.cleanupOrphanedLobbies(client);
  await ensureAllConsoles();
});

client.on(Events.Error, (error) => {
  if (interactionAlreadyAcknowledged(error)) return;
  console.error('[Nexus Sentinal] Discord client error:', error);
});

client.on('voiceStateUpdate', (oldState, newState) => {
  provisioner.handleVoiceState(oldState, newState).catch((error) => console.error('[Sentinal] voice lobby event:', error.message));
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isAutocomplete()) return autocompleteActions(interaction);

    if (interaction.isStringSelectMenu() && interaction.customId === 'nexussetup:module') {
      if (!(await canSetup(interaction))) return interaction.reply({ content: 'Module setup requires Nexus owner access or Discord Manage Server permission.', flags: MessageFlags.Ephemeral });
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
          return interaction.reply({ content: 'That confirmation expired. Run the action again.', flags: MessageFlags.Ephemeral });
        }
        if (item.userId !== String(interaction.user.id)) {
          return interaction.reply({ content: 'Only the user who requested this action can confirm it.', flags: MessageFlags.Ephemeral });
        }
        pending.delete(confirm[2]);
        if (confirm[1] === 'nexuscancel') return interaction.update({ content: 'Action cancelled.', components: [] });
        await interaction.deferUpdate();
        const result = await backend.invoke(item.moduleId, item.actionId, item.payload, {
          role: item.role,
          actorId: item.userId,
          confirmed: true
        });
        return interaction.editReply(formatActionResult(item.moduleId, item.actionId, result));
      }

      const parsed = parseActionId(interaction.customId);
      if (!parsed) return;
      if (parsed.actionId === 'help') return interaction.reply({ ...renderHelp(parsed.moduleId), flags: MessageFlags.Ephemeral });
      if (parsed.actionId === 'refresh') {
        await ensureConsole(parsed.moduleId);
        return interaction.reply({ content: 'Module console refreshed.', flags: MessageFlags.Ephemeral });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return interaction.editReply(await runAction(interaction, parsed.moduleId, parsed.actionId, {}));
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'market') {
      await interaction.deferReply();
      const item = interaction.options.getString('item', true).trim();
      return interaction.editReply(await runAction(interaction, 'warframe', 'market', { item, input: item }));
    }

    if (interaction.isChatInputCommand() && isFriendlyCommand(interaction.commandName)) {
      const invocation = resolveFriendlyCommand(interaction);
      if (!invocation) return interaction.reply({ content: 'That module command is not available.', flags: MessageFlags.Ephemeral });
      if (friendlyResponsePrivate(invocation)) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      else await interaction.deferReply();
      return interaction.editReply(await runAction(interaction, invocation.moduleId, invocation.actionId, invocation.payload));
    }

    if (!interaction.isChatInputCommand() || interaction.commandName !== 'nexus') return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const sub = interaction.options.getSubcommand();
    if (sub === 'link') {
      const code = interaction.options.getString('code', true).trim().toUpperCase();
      const linked = await backend.linkAccount(code, {
        id: String(interaction.user.id),
        username: interaction.user.username,
        globalName: interaction.user.globalName,
        avatar: interaction.user.avatar
      });
      if (!linked.ok) return interaction.editReply({ content: `⚠️ ${linked.message || 'That Nexus link code is invalid or expired.'}` });
      return interaction.editReply({ content: `✅ **Nexus account linked**\n${linked.account.displayName} • ${linked.account.role === 'owner' ? 'Owner' : 'Co-Owner'}\nYour Discord ID now resolves to Nexus account \`${linked.account.id}\`.` });
    }
    if (sub === 'account') {
      const linked = await backend.accountByDiscord(String(interaction.user.id));
      if (!linked.ok) return interaction.editReply({ content: 'This Discord account is not linked to Nexus yet. Create a code in **Accounts & Access** and run `/nexus link`.' });
      return interaction.editReply({ content: `**Nexus Account**\n${linked.account.displayName}\nRole: **${linked.account.role === 'owner' ? 'Owner' : 'Co-Owner'}**\nNexus ID: \`${linked.account.id}\`` });
    }
    if (sub === 'setup') {
      if (!(await canSetup(interaction))) return interaction.editReply({ content: 'Module setup requires Nexus owner access or Discord Manage Server permission.' });
      assertAdministrator(interaction.guild);
      return interaction.editReply(setupStart());
    }
    if (sub === 'repair') {
      const moduleId = interaction.options.getString('module') || '';
      return interaction.editReply(await repairModules(interaction, moduleId));
    }
    if (sub === 'repair-all') return interaction.editReply(await repairAllModules(interaction));
    if (sub === 'modules') {
      const result = await backend.modules();
      const discovered = new Set(await provisioner.discoverModuleIds(interaction.guild));
      const admin = hasAdministrator(interaction.guild) ? 'Administrator ready' : '⚠️ Administrator missing';
      const lines = [`**Sentinal:** ${admin}`, ...(result.modules || []).map((m) => {
        const discordStatus = discovered.has(m.id) ? 'Discord ready' : 'not set up';
        const connection = m.connected === true ? 'connected' : m.configured ? m.providerKind || 'backend active' : 'provider setup needed';
        const actions = `${(m.availableActions || []).length}/${(m.capabilities || []).length} actions`;
        return `${m.enabled ? '🟢' : '⚫'} **${m.name}** — ${discordStatus} • ${connection} • ${actions}`;
      })];
      return interaction.editReply({ content: lines.join('\n').slice(0, 1950) || 'No modules registered.' });
    }
    if (sub === 'features') {
      const moduleId = interaction.options.getString('module', true).toLowerCase();
      return interaction.editReply(renderHelp(moduleId));
    }
    if (sub === 'refresh') {
      const moduleId = interaction.options.getString('module', true).toLowerCase();
      await ensureConsole(moduleId);
      return interaction.editReply({ content: `Refreshed ${getModule(moduleId)?.name || moduleId}.` });
    }
    if (sub === 'run') {
      const moduleId = interaction.options.getString('module', true).toLowerCase();
      const actionId = interaction.options.getString('action', true).toLowerCase();
      const input = interaction.options.getString('input') || '';
      return interaction.editReply(await runAction(interaction, moduleId, actionId, { input }));
    }
  } catch (error) {
    if (interactionAlreadyAcknowledged(error)) {
      console.warn('[Nexus Sentinal] interaction already acknowledged by another runtime; ignoring duplicate response.');
      return;
    }
    const content = `⚠️ ${String(error?.message || error)}`.slice(0, 1900);
    try {
      if (interaction.isAutocomplete?.()) await interaction.respond([]).catch(() => {});
      else if (interaction.deferred || interaction.replied) await interaction.editReply({ content, components: [], embeds: [] });
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch (replyError) {
      if (!interactionAlreadyAcknowledged(replyError)) console.error('[Nexus Sentinal] failed to report interaction error:', replyError);
    }
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [nonce, item] of pending) if (item.expiresAt < now) pending.delete(nonce);
}, 60_000).unref();

client.login(token);
