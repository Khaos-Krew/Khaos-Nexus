'use strict';

const { Client, Events } = require('discord.js');
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

function defaultEconomyClient() {
  // Lazy require so unit tests can inject a mock without loading worker client deps.
  const { NexusEconomyClient } = require('./nexus-economy-client.cjs');
  return new NexusEconomyClient();
}

/**
 * Attach InteractionCreate (+ optional ready registration) listeners.
 * Wires economyClient so /o9verify revoke can demoteIdentityToRestricted (WARDEN B1).
 * @param {import('discord.js').Client | import('node:events').EventEmitter} client
 * @param {{ economyClient?: object, storeFactory?: Function, registerOnReady?: boolean }} [deps]
 */
function attachMemberVerificationListeners(client, deps = {}) {
  const economyClient = Object.prototype.hasOwnProperty.call(deps, 'economyClient')
    ? deps.economyClient
    : defaultEconomyClient();
  const storeFactory = deps.storeFactory;
  const registerOnReady = deps.registerOnReady !== false;

  client.on(Events.InteractionCreate, (interaction) => {
    void handleMemberVerificationInteraction(interaction, { economyClient, storeFactory }).catch((error) => {
      console.warn(`[O9 Verify] interaction failed: ${String(error?.message || error).slice(0, 240)}`);
    });
  });

  if (!registerOnReady) return { economyClient };

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

  return { economyClient };
}

function installMemberVerificationExtension(deps = {}) {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusMemberVerificationLogin(...args) {
    attachMemberVerificationListeners(this, deps);
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  registerMemberVerificationCommand,
  attachMemberVerificationListeners,
  installMemberVerificationExtension,
  defaultEconomyClient,
  // Re-export helpers for tests / consumers
  ...require('./member-verification-commands.cjs')
};
