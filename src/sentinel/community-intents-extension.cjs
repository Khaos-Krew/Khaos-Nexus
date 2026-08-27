'use strict';

const discord = require('discord.js');
const { GatewayIntentBits, IntentsBitField } = discord;

const INSTALLED = Symbol.for('khaos.nexus.communityIntents.constructor');
const MIN_CLIENT_LISTENER_BUDGET = 50;

function messageContentRequested(env = process.env) {
  return ['1', 'true', 'yes', 'on'].includes(String(env.NEXUS_LEVEL_MESSAGE_CONTENT || '').trim().toLowerCase());
}

function withCommunityIntents(options = {}, env = process.env) {
  const intents = new IntentsBitField(options.intents || []);
  intents.add(GatewayIntentBits.GuildMessages);
  if (GatewayIntentBits.AutoModerationExecution !== undefined) intents.add(GatewayIntentBits.AutoModerationExecution);
  if (messageContentRequested(env)) intents.add(GatewayIntentBits.MessageContent);
  return { ...options, intents };
}

function clientHasGuildMessagesIntent(client) {
  return Boolean(client?.options?.intents?.has?.(GatewayIntentBits.GuildMessages));
}

function clientHasAutoModerationExecutionIntent(client) {
  if (GatewayIntentBits.AutoModerationExecution === undefined) return false;
  return Boolean(client?.options?.intents?.has?.(GatewayIntentBits.AutoModerationExecution));
}

function clientHasMessageContentIntent(client) {
  return Boolean(client?.options?.intents?.has?.(GatewayIntentBits.MessageContent));
}

function ensureListenerBudget(client, minimum = MIN_CLIENT_LISTENER_BUDGET) {
  if (!client?.getMaxListeners || !client?.setMaxListeners) return 0;
  const current = Number(client.getMaxListeners()) || 0;
  const target = Math.max(current, Number(minimum) || MIN_CLIENT_LISTENER_BUDGET);
  if (target !== current) client.setMaxListeners(target);
  return target;
}

function installCommunityIntentsExtension(options = {}) {
  const logger = options.logger || console;
  if (discord[INSTALLED]) return discord.Client;
  discord[INSTALLED] = true;
  const BaseClient = discord.Client;

  class NexusSentinalCommunityClient extends BaseClient {
    constructor(clientOptions = {}) {
      super(withCommunityIntents(clientOptions));
      ensureListenerBudget(this);
      if (!clientHasGuildMessagesIntent(this)) {
        throw new Error('Nexus Sentinal failed to declare Discord Guild Messages intent during client construction.');
      }
    }
  }

  discord.Client = NexusSentinalCommunityClient;
  logger.log?.(`[Nexus Sentinal] Guild Messages intent is declared for community leveling; native AutoMod execution telemetry ${GatewayIntentBits.AutoModerationExecution === undefined ? 'unavailable in this discord.js build' : 'enabled'}${messageContentRequested() ? '; Message Content requested for enhanced anti-spam checks' : '; privacy-safe metadata mode active'}.`);
  return NexusSentinalCommunityClient;
}

module.exports = {
  MIN_CLIENT_LISTENER_BUDGET,
  messageContentRequested,
  withCommunityIntents,
  clientHasGuildMessagesIntent,
  clientHasAutoModerationExecutionIntent,
  clientHasMessageContentIntent,
  ensureListenerBudget,
  installCommunityIntentsExtension
};
