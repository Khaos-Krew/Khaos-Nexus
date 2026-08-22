'use strict';

const crypto = require('node:crypto');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { loadConfig, envSecret } = require('../shared/config.cjs');
const { getModule } = require('../backend/modules/catalog.cjs');
const { BackendClient } = require('./backend-client.cjs');
const { StateStore } = require('./state-store.cjs');
const { parseActionId, renderModuleConsole, renderHelp } = require('./module-console.cjs');

const config = loadConfig();
const token = envSecret(config.discord?.tokenEnv);
if (!token) throw new Error(`Set ${config.discord?.tokenEnv || 'NEXUS_SENTINEL_TOKEN'} before starting Nexus Sentinel.`);
const guildId = String(config.discord?.guildId || '');
if (!guildId) throw new Error('Set discord.guildId in config.json before starting Nexus Sentinel.');

const backend = new BackendClient(config);
const state = new StateStore();
const pending = new Map();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function roleFor(interaction) {
  if ((config.discord?.ownerUserIds || []).includes(String(interaction.user.id))) return 'owner';
  const roles = interaction.member?.roles?.cache;
  if (roles && (config.discord?.operatorRoleIds || []).some((id) => roles.has(String(id)))) return 'operator';
  return 'viewer';
}

function confirmationRow(nonce) {
  return [{ type: 1, components: [
    { type: 2, style: 4, label: 'Confirm', custom_id: `nexusconfirm:${nonce}` },
    { type: 2, style: 2, label: 'Cancel', custom_id: `nexuscancel:${nonce}` }
  ] }];
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

async function ensureConsole(moduleId) {
  const moduleConfig = config.modules?.[moduleId] || {};
  const module = getModule(moduleId);
  if (!module || module.console === false || moduleConfig.enabled === false || !moduleConfig.channelId) return null;
  const channel = await client.channels.fetch(String(moduleConfig.channelId));
  if (!channel?.isTextBased?.()) throw new Error(`${module.name}: configured channel is not text-capable.`);
  const payload = renderModuleConsole(moduleId, await manifestState(moduleId));
  const saved = state.getConsole(moduleId);
  let message = null;
  if (saved?.messageId) {
    try { message = await channel.messages.fetch(saved.messageId); await message.edit(payload); } catch { message = null; }
  }
  if (!message) message = await channel.send(payload);
  state.setConsole(moduleId, { guildId, channelId: String(channel.id), messageId: String(message.id), updatedAt: new Date().toISOString() });
  return message;
}

async function ensureAllConsoles() {
  for (const moduleId of Object.keys(config.modules || {})) {
    try { await ensureConsole(moduleId); } catch (error) { console.error(`[Sentinel] ${moduleId} console:`, error.message); }
  }
}

async function registerCommands() {
  const command = new SlashCommandBuilder()
    .setName('nexus')
    .setDescription('Nexus Sentinel module tools')
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
    return { content: `⚠️ **Confirmation required**\n${result.message}`, components: confirmationRow(nonce), ephemeral: true };
  }
  if (!result.ok) return { content: `⚠️ ${result.message || result.code}`, components: [], ephemeral: true };
  return { content: `✅ ${getModule(moduleId)?.name || moduleId}: ${actionId} completed.\n\`\`\`${JSON.stringify(result.data, null, 2).slice(0, 1600)}\`\`\``, components: [], ephemeral: true };
}

client.once('ready', async () => {
  console.log(`[Nexus Sentinel] logged in as ${client.user.tag}`);
  await registerCommands();
  await ensureAllConsoles();
});

client.on('interactionCreate', async (interaction) => {
  try {
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
    if (sub === 'modules') {
      const result = await backend.modules();
      const lines = (result.modules || []).map((m) => `${m.enabled ? '🟢' : '⚫'} **${m.name}** — ${m.configured ? 'provider ready' : 'provider setup needed'}`);
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
      return interaction.reply(await runAction(interaction, moduleId, actionId, { input }));
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
