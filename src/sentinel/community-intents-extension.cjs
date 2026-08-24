'use strict';

const discord = require('discord.js');
const { GatewayIntentBits, IntentsBitField } = discord;

const INSTALLED = Symbol.for('khaos.nexus.communityIntents.constructor');

function messageContentRequested(env = process.env) {
  return ['1', 'true', 'yes', 'on'].includes(String(env.NEXUS_LEVEL_MESSAGE_CONTENT || '').trim().toLowerCase());
}

function withCommunityIntents(options = {}, env = process.env) {
  const intents = new IntentsBitField(options.intents || []);
  intents.add(GatewayIntentBits.GuildMessages);
  if (messageContentRequested(env)) intents.add(GatewayIntentBits.MessageContent);
  return { ...options, intents };
}

function clientHasGuildMessagesIntent(client) {
  return Boolean(client?.options?.intents?.has?.(GatewayIntentBits.GuildMessages));
}

function clientHasMessageContentIntent(client) {
  return Boolean(client?.options?.intents?.has?.(GatewayIntentBits.MessageContent));
}

function installCommunityIntentsExtension(options = {}) {
  const logger = options.logger || console;
  if (discord[INSTALLED]) return discord.Client;
  discord[INSTALLED] = true;
  const BaseClient = discord.Client;

  class NexusSentinalCommunityClient extends BaseClient {
    constructor(clientOptions = {}) {
      super(withCommunityIntents(clientOptions));
      if (!clientHasGuildMessagesIntent(this)) {
        throw new Error('Nexus Sentinal failed to declare Discord Guild Messages intent during client construction.');
      }
    }
  }

  discord.Client = NexusSentinalCommunityClient;
  logger.log?.(`[Nexus Sentinal] Guild Messages intent is declared for community leveling${messageContentRequested() ? '; Message Content requested for enhanced anti-spam checks' : '; privacy-safe metadata mode active'}.`);
  return NexusSentinalCommunityClient;
}

module.exports = {
  messageContentRequested,
  withCommunityIntents,
  clientHasGuildMessagesIntent,
  clientHasMessageContentIntent,
  installCommunityIntentsExtension
};
