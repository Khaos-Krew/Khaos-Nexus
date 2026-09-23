'use strict';

const { Events, MessageFlags } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { getModule } = require('../backend/modules/catalog.cjs');
const { BackendClient } = require('./backend-client.cjs');
const { formatActionResult } = require('./action-formatters.cjs');
const { marketCommand } = require('./commands.cjs');
const { commandDefinitions, resolveFriendlyCommand } = require('./friendly-commands.cjs');
const { CEPHALON_COMMANDS } = require('./game-command-ownership.cjs');

function warframeCommands() {
  return [marketCommand(), ...commandDefinitions().filter((command) => CEPHALON_COMMANDS.includes(command.name))];
}

function friendlyResponsePrivate(invocation) {
  const module = getModule(invocation.moduleId);
  const capability = module?.capabilities.find((item) => item.id === invocation.actionId);
  return Boolean(capability && (capability.destructive || capability.requiredRole !== 'viewer'));
}

async function registerWarframeCommands(guild) {
  const definitions = warframeCommands();
  const commands = await guild.commands.fetch();
  for (const command of definitions) {
    const existing = commands.find((item) => item.name === command.name);
    if (existing) await guild.commands.edit(existing, command.toJSON());
    else await guild.commands.create(command.toJSON());
  }
  console.log(`[Cephalon Nexus] registered ${definitions.map((item) => `/${item.name}`).join(', ')}`);
}

function bindCephalonCommands(client, options = {}) {
  const config = options.config || loadConfig();
  const backend = options.backend || new BackendClient(config);
  const guildId = String(config.discord?.guildId || process.env.NEXUS_DISCORD_GUILD_ID || '');

  async function roleFor(interaction) {
    if ((config.discord?.ownerUserIds || []).includes(String(interaction.user.id))) return 'owner';
    const roles = interaction.member?.roles?.cache;
    if (roles && (config.discord?.operatorRoleIds || []).some((id) => roles.has(String(id)))) return 'operator';
    const linked = await backend.accountByDiscord(String(interaction.user.id)).catch(() => null);
    if (linked?.ok && ['owner', 'co-owner'].includes(linked.account?.role)) return 'owner';
    return 'viewer';
  }

  async function runAction(interaction, moduleId, actionId, payload = {}) {
    const role = await roleFor(interaction);
    const result = await backend.invoke(moduleId, actionId, payload, {
      role,
      actorId: String(interaction.user.id),
      confirmed: false
    });
    if (result.code === 'CONFIRMATION_REQUIRED') {
      return { content: `⚠️ **Confirmation required**\n${result.message || 'This action needs confirmation.'}` };
    }
    return formatActionResult(moduleId, actionId, result);
  }

  client.once(Events.ClientReady, () => {
    void (async () => {
      if (!guildId) throw new Error('DISCORD_GUILD_ID is missing');
      const guild = await client.guilds.fetch(guildId);
      await registerWarframeCommands(guild);
    })().catch((error) => console.error(`[Cephalon Nexus] command registration failed: ${String(error?.message || error).slice(0, 300)}`));
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (!interaction.isChatInputCommand?.() || !CEPHALON_COMMANDS.includes(interaction.commandName)) return;
      if (guildId && String(interaction.guildId || '') !== guildId) return;
      if (interaction.commandName === 'market') {
        await interaction.deferReply();
        const item = interaction.options.getString('item', true).trim();
        return interaction.editReply(await runAction(interaction, 'warframe', 'market', { item, input: item }));
      }
      const invocation = resolveFriendlyCommand(interaction);
      if (!invocation || invocation.moduleId !== 'warframe') {
        return interaction.reply({ content: 'That Warframe command is not available.', flags: MessageFlags.Ephemeral });
      }
      if (friendlyResponsePrivate(invocation)) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      else await interaction.deferReply();
      return interaction.editReply(await runAction(interaction, invocation.moduleId, invocation.actionId, invocation.payload));
    } catch (error) {
      const content = `⚠️ ${String(error?.message || error)}`.slice(0, 1900);
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {});
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  });
}

module.exports = { bindCephalonCommands, registerWarframeCommands, warframeCommands };
