'use strict';

const { Client, Events, MessageFlags } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const {
  memberVerificationCommandDefinition,
  handleMemberVerificationInteraction
} = require('./member-verification-commands.cjs');

const INSTALLED = Symbol.for('khaos.nexus.member.verification.extension');

async function registerMemberVerificationCommand(guild) {
  const definition = memberVerificationCommandDefinition();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === 'o9verify');
  if (existing) await guild.commands.edit(existing, definition.toJSON());
  else await guild.commands.create(definition.toJSON());
  return definition.toJSON();
}

function installMemberVerificationExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusMemberVerificationLogin(...args) {
    const client = this;
    client.on(Events.InteractionCreate, (interaction) => {
      void handleMemberVerificationInteraction(interaction).catch((error) => {
        console.warn(`[O9 Verify] interaction failed: ${String(error?.message || error).slice(0, 240)}`);
      });
    });
    client.once(Events.ClientReady, async () => {
      try {
        const config = loadConfig();
        const guildId = String(config.discord?.guildId || '').trim();
        if (!guildId) throw new Error('Nexus Discord guild ID is not configured.');
        const guild = await client.guilds.fetch(guildId);
        await registerMemberVerificationCommand(guild);
        console.log(`[O9 Verify] registered /o9verify in guild ${guild.id}`);
      } catch (error) {
        console.error(`[O9 Verify] /o9verify registration failed: ${String(error?.message || error).slice(0, 300)}`);
      }
    });
    return originalLogin.apply(client, args);
  };
}

module.exports = {
  registerMemberVerificationCommand,
  installMemberVerificationExtension,
  // Re-export helpers for tests / consumers
  ...require('./member-verification-commands.cjs')
};
