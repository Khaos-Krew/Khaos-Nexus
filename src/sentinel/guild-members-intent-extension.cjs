'use strict';

const discord = require('discord.js');
const { GatewayIntentBits, IntentsBitField } = discord;

const ORIGINAL_CLIENT = discord.Client;
const INSTALLED = Symbol.for('khaos.nexus.guildMembersIntent.constructor');

function withGuildMembersIntent(options = {}) {
  const intents = new IntentsBitField(options.intents || []);
  intents.add(GatewayIntentBits.GuildMembers);
  return { ...options, intents };
}

function clientHasGuildMembersIntent(client) {
  const clientEnabled = Boolean(client?.options?.intents?.has?.(GatewayIntentBits.GuildMembers));
  const websocketEnabled = Boolean(Number(client?.ws?.options?.intents || 0) & GatewayIntentBits.GuildMembers);
  return clientEnabled && websocketEnabled;
}

function installGuildMembersIntentExtension(options = {}) {
  const logger = options.logger || console;
  if (discord[INSTALLED]) return discord.Client;
  discord[INSTALLED] = true;

  class NexusSentinalClient extends ORIGINAL_CLIENT {
    constructor(clientOptions = {}) {
      super(withGuildMembersIntent(clientOptions));
      if (!clientHasGuildMembersIntent(this)) {
        throw new Error('Nexus Sentinal failed to declare Discord Guild Members intent during client construction.');
      }
    }
  }

  discord.Client = NexusSentinalClient;
  logger.log?.('[Nexus Sentinal] Guild Members gateway intent is declared at Discord client construction.');
  return NexusSentinalClient;
}

module.exports = {
  ORIGINAL_CLIENT,
  withGuildMembersIntent,
  clientHasGuildMembersIntent,
  installGuildMembersIntentExtension
};
