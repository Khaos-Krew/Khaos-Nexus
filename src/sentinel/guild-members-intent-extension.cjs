'use strict';

const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');

const INSTALLED = Symbol.for('khaos.nexus.guildMembersIntent.extension');
const PREPARED = Symbol.for('khaos.nexus.guildMembersIntent.prepared');
const GATEWAY_GUILD_MEMBERS = 1 << 14;
const GATEWAY_GUILD_MEMBERS_LIMITED = 1 << 15;

function applicationAllowsGuildMembers(flags = 0) {
  const value = Number(flags || 0);
  return Boolean(value & (GATEWAY_GUILD_MEMBERS | GATEWAY_GUILD_MEMBERS_LIMITED));
}

async function prepareGuildMembersIntent(client, token, options = {}) {
  if (!client || client[PREPARED]) return { prepared:true, enabled:Boolean(client?.options?.intents?.has?.(GatewayIntentBits.GuildMembers)), source:'cached' };
  client[PREPARED] = true;
  const logger = options.logger || console;
  const rest = options.rest || new REST({ version:'10' }).setToken(String(token || ''));

  try {
    const application = await rest.get(Routes.oauth2CurrentApplication());
    const flags = Number(application?.flags || 0);
    if (!applicationAllowsGuildMembers(flags)) {
      logger.warn?.('[Nexus Sentinal] Discord Server Members Intent is not enabled for this application. Full member-role migrations are deferred; enable Server Members Intent in the Discord Developer Portal to allow safe duplicate-role consolidation.');
      return { prepared:true, enabled:false, flags, source:'application-flags' };
    }
    client.options?.intents?.add?.(GatewayIntentBits.GuildMembers);
    const enabled = Boolean(client.options?.intents?.has?.(GatewayIntentBits.GuildMembers));
    if (enabled) logger.log?.('[Nexus Sentinal] Discord Guild Members intent authorized and enabled for safe member-role reconciliation.');
    else logger.warn?.('[Nexus Sentinal] Guild Members intent is authorized, but Sentinal could not add it to the gateway intent set.');
    return { prepared:true, enabled, flags, source:'application-flags' };
  } catch (error) {
    logger.warn?.(`[Nexus Sentinal] Guild Members intent preflight failed; continuing without privileged member inventory: ${String(error?.message || error)}`);
    return { prepared:true, enabled:false, flags:0, source:'preflight-error', error:String(error?.message || error) };
  }
}

function installGuildMembersIntentExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;

  Client.prototype.login = async function nexusGuildMembersIntentLogin(token, ...args) {
    await prepareGuildMembersIntent(this, token);
    return originalLogin.call(this, token, ...args);
  };
}

module.exports = {
  GATEWAY_GUILD_MEMBERS,
  GATEWAY_GUILD_MEMBERS_LIMITED,
  applicationAllowsGuildMembers,
  prepareGuildMembersIntent,
  installGuildMembersIntentExtension
};
