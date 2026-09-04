'use strict';

const { Client, MessageFlags } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { BackendClient } = require('./backend-client.cjs');
const { normalizeRequiredOptions } = require('./discord-command-schema.cjs');
const { registerStartupTask, startupDiagnostics } = require('./startup-coordinator.cjs');
const {
  divisionLootCommand,
  handleDivisionLootCommand,
  handleDivisionLootButton
} = require('./division2-targeted-loot.cjs');

const INSTALLED = Symbol.for('khaos.nexus.division2.targeted.loot.extension');
const BOUND = Symbol.for('khaos.nexus.division2.targeted.loot.bound');
const STARTUP_TASK_ID = 'division2-command-registration';

async function registerDivisionLootCommand(client, guildId) {
  if (!guildId) return { skipped: 'guild-not-configured' };
  const guild = await client.guilds.fetch(guildId);
  const definition = divisionLootCommand();
  const commandJson = normalizeRequiredOptions(definition.toJSON());
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === definition.name);
  if (existing) await guild.commands.edit(existing, commandJson);
  else await guild.commands.create(commandJson);
  console.log(`[Nexus Sentinal] registered /divisionloot in guild ${guild.id}`);
  return { skipped: '', guildId: String(guild.id) };
}

function installDivision2TargetedLootExtension() {
  if (Client.prototype[INSTALLED]) return { installed: false };
  Client.prototype[INSTALLED] = true;

  const config = loadConfig();
  const backend = new BackendClient(config);
  const guildId = String(config.discord?.guildId || '');
  const originalLogin = Client.prototype.login;

  async function roleFor(interaction) {
    if ((config.discord?.ownerUserIds || []).includes(String(interaction.user.id))) return 'owner';
    const roles = interaction.member?.roles?.cache;
    if (roles && (config.discord?.operatorRoleIds || []).some((id) => roles.has(String(id)))) return 'operator';
    const linked = await backend.accountByDiscord(String(interaction.user.id)).catch(() => null);
    if (linked?.ok && ['owner', 'co-owner'].includes(linked.account?.role)) return 'owner';
    return 'viewer';
  }

  Client.prototype.login = function nexusDivision2TargetedLootLogin(...args) {
    if (!this[BOUND]) {
      this[BOUND] = true;
      this.on('interactionCreate', async (interaction) => {
        const isCommand = interaction.isChatInputCommand?.() && interaction.commandName === 'divisionloot';
        const isButton = interaction.isButton?.() && String(interaction.customId || '').startsWith('divisionloot:');
        if (!isCommand && !isButton) return;
        try {
          if (isButton) return await handleDivisionLootButton(interaction, { backend, roleFor });
          return await handleDivisionLootCommand(interaction, { backend, roleFor });
        } catch (error) {
          const content = `⚠️ Division 2 targeted loot is unavailable: ${String(error?.message || error)}`.slice(0, 1900);
          try {
            if (interaction.deferred || interaction.replied) await interaction.editReply({ content, components: [], embeds: [] });
            else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
          } catch (replyError) {
            console.error('[Nexus Sentinal] Division 2 targeted-loot interaction error:', replyError);
          }
        }
      });
    }
    return originalLogin.apply(this, args);
  };

  if (!startupDiagnostics().tasks.some((task) => task.id === STARTUP_TASK_ID)) {
    registerStartupTask({
      id: STARTUP_TASK_ID,
      owner: 'division2',
      priority: 130,
      async run(client) {
        try { await registerDivisionLootCommand(client, guildId); }
        catch (error) { console.error('[Nexus Sentinal] Division 2 targeted-loot command registration:', error); }
      }
    });
  }
  return { installed: true, coordinated: true };
}

module.exports = { STARTUP_TASK_ID, registerDivisionLootCommand, installDivision2TargetedLootExtension };
