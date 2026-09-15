'use strict';

const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const {
  COMMAND_NAME,
  walletAdjustCommandDefinition,
  handleWalletAdjustInteraction
} = require('./wallet-adjust-commands.cjs');

const INSTALLED = Symbol.for('khaos.nexus.wallet.adjust.extension');

async function registerWalletAdjustCommand(guild) {
  const definition = walletAdjustCommandDefinition();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === COMMAND_NAME);
  if (existing) await guild.commands.edit(existing, definition.toJSON());
  else await guild.commands.create(definition.toJSON());
  return definition.toJSON();
}

function defaultEconomyClient() {
  const { NexusEconomyClient } = require('./nexus-economy-client.cjs');
  return new NexusEconomyClient();
}

/**
 * Attach InteractionCreate (+ optional ready registration) listeners.
 * @param {import('discord.js').Client | import('node:events').EventEmitter} client
 * @param {{ economyClient?: object, registerOnReady?: boolean }} [deps]
 */
function attachWalletAdjustListeners(client, deps = {}) {
  const economyClient = Object.prototype.hasOwnProperty.call(deps, 'economyClient')
    ? deps.economyClient
    : defaultEconomyClient();
  const registerOnReady = deps.registerOnReady !== false;

  client.on(Events.InteractionCreate, (interaction) => {
    void handleWalletAdjustInteraction(interaction, { economyClient }).catch((error) => {
      console.warn(`[Wallet Adjust] interaction failed: ${String(error?.message || error).slice(0, 240)}`);
    });
  });

  if (!registerOnReady) return { economyClient };

  client.once(Events.ClientReady, async () => {
    try {
      const config = loadConfig();
      const guildId = String(config.discord?.guildId || '').trim();
      if (!guildId) throw new Error('Nexus Discord guild ID is not configured.');
      const guild = await client.guilds.fetch(guildId);
      await registerWalletAdjustCommand(guild);
      console.log(`[Wallet Adjust] registered /${COMMAND_NAME} in guild ${guild.id}`);
    } catch (error) {
      console.error(`[Wallet Adjust] /${COMMAND_NAME} registration failed: ${String(error?.message || error).slice(0, 300)}`);
    }
  });

  return { economyClient };
}

function installWalletAdjustExtension(deps = {}) {
  if (Client.prototype[INSTALLED]) return false;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusWalletAdjustLogin(...args) {
    attachWalletAdjustListeners(this, deps);
    return originalLogin.apply(this, args);
  };
  return true;
}

module.exports = {
  registerWalletAdjustCommand,
  attachWalletAdjustListeners,
  installWalletAdjustExtension,
  defaultEconomyClient,
  ...require('./wallet-adjust-commands.cjs')
};
