'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function csv(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function loadConfig(options = {}) {
  const root = path.resolve(__dirname, '../..');
  const requested = options.requestedPath
    ? path.resolve(options.requestedPath)
    : process.env.NEXUS_CONFIG
      ? path.resolve(process.env.NEXUS_CONFIG)
      : path.join(root, 'config.json');
  const fallback = options.fallbackPath ? path.resolve(options.fallbackPath) : path.join(root, 'config.example.json');
  const source = fs.existsSync(requested) ? requested : fallback;
  const config = readJson(source);

  config.backend ||= {};
  config.discord ||= {};
  config.discord.nexusStatus ||= {};

  if (process.env.NEXUS_BACKEND_HOST) config.backend.host = process.env.NEXUS_BACKEND_HOST;
  if (process.env.NEXUS_BACKEND_PORT) config.backend.port = Number(process.env.NEXUS_BACKEND_PORT);
  if (process.env.NEXUS_BACKEND_URL) config.backend.publicBaseUrl = process.env.NEXUS_BACKEND_URL;
  if (process.env.NEXUS_DISCORD_GUILD_ID) config.discord.guildId = process.env.NEXUS_DISCORD_GUILD_ID;
  if (process.env.NEXUS_OWNER_USER_IDS) config.discord.ownerUserIds = csv(process.env.NEXUS_OWNER_USER_IDS);
  if (process.env.NEXUS_CACHE_TOKEN_ISSUER_USER_ID) config.discord.cacheTokenIssuerUserId = String(process.env.NEXUS_CACHE_TOKEN_ISSUER_USER_ID).trim();
  if (process.env.NEXUS_OPERATOR_ROLE_IDS) config.discord.operatorRoleIds = csv(process.env.NEXUS_OPERATOR_ROLE_IDS);
  if (process.env.NEXUS_MAX_TEMP_LOBBIES) config.discord.maxTemporaryLobbiesPerModule = Number(process.env.NEXUS_MAX_TEMP_LOBBIES);
  if (process.env.NEXUS_SENTINAL_ADMIN_URL) config.discord.sentinalAdminUrl = process.env.NEXUS_SENTINAL_ADMIN_URL;
  if (process.env.NEXUS_SENTINAL_ADMIN_TOKEN_ENV) config.discord.sentinalAdminTokenEnv = process.env.NEXUS_SENTINAL_ADMIN_TOKEN_ENV;
  if (process.env.NEXUS_STATUS_CHANNEL_ID) config.discord.nexusStatus.channelId = process.env.NEXUS_STATUS_CHANNEL_ID;
  if (process.env.NEXUS_STATUS_REFRESH_SECONDS) config.discord.nexusStatus.refreshSeconds = Number(process.env.NEXUS_STATUS_REFRESH_SECONDS);
  if (process.env.NEXUS_VEYRA_HEALTH_URL) config.discord.nexusStatus.veyraHealthUrl = process.env.NEXUS_VEYRA_HEALTH_URL;
  if (process.env.NEXUS_VEYRA_GATEWAY_HEALTH_URL) config.discord.nexusStatus.veyraGatewayHealthUrl = process.env.NEXUS_VEYRA_GATEWAY_HEALTH_URL;
  config.modules ||= {};
  config.modules.dnd ||= { enabled: true, surface: 'veyra', provider: {} };
  config.modules.dnd.provider ||= {};
  if (process.env.NEXUS_DND_PROVIDER_URL) {
    config.modules.dnd.provider.type = 'veyra';
    config.modules.dnd.provider.baseUrl = process.env.NEXUS_DND_PROVIDER_URL;
  }
  if (process.env.NEXUS_DND_PROVIDER_ACTIONS) config.modules.dnd.provider.actions = csv(process.env.NEXUS_DND_PROVIDER_ACTIONS);

  config.__source = source;
  return config;
}

function envSecret(name) {
  return name ? String(process.env[name] || '') : '';
}

module.exports = { loadConfig, envSecret, csv, readJson };
