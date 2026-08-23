'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { NEXUS_RANKS } = require('../shared/ranks.cjs');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function atomicWriteJson(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function ensureUserConfig(userDataPath, templatePath) {
  ensureDirectory(userDataPath);
  const configPath = path.join(userDataPath, 'config.json');
  if (!fs.existsSync(configPath)) atomicWriteJson(configPath, readJson(templatePath));
  return configPath;
}

function safeText(value, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function safeBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function safeInteger(value, fallback = 0, min = 0, max = 65535) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return fallback;
  return number;
}

function safeList(value, maxItems = 50, maxLength = 80) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(',');
  return source.map((item) => safeText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function safeProtocol(value, fallback = '') {
  const protocol = safeText(value, 12).toLowerCase();
  return ['http', 'https', 'ws', 'wss', ''].includes(protocol) ? protocol : fallback;
}

function safeEnvName(value, fallback = '') {
  const name = safeText(value, 100).toUpperCase();
  return /^NEXUS_[A-Z0-9_]+$/.test(name) ? name : fallback;
}

function safeSnowflake(value) {
  const id = safeText(value, 32);
  return /^\d{15,24}$/.test(id) ? id : '';
}

function safeSnowflakeList(value, maxItems = 50) {
  return safeList(value, maxItems, 32).map(safeSnowflake).filter(Boolean);
}

function safeDiscordRedirect(value, fallback = 'http://127.0.0.1:53117/callback') {
  const text = safeText(value, 300);
  try {
    const parsed = new URL(text || fallback);
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) return fallback;
    return parsed.toString();
  } catch {
    return fallback;
  }
}

function safeSentinalAdminUrl(value, fallback = 'http://127.0.0.1:3220') {
  const text = safeText(value, 500);
  try {
    const parsed = new URL(text || fallback);
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) return fallback;
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return fallback;
  }
}

function safeUpdateChannel(value, fallback = 'owner-test') {
  const channel = safeText(value, 40).toLowerCase();
  return ['owner-test', 'stable'].includes(channel) ? channel : fallback;
}

function normalizeRankRoles(input = {}, previous = {}) {
  const result = {};
  for (const rank of NEXUS_RANKS) result[rank.id] = safeSnowflake(input?.[rank.id]) || safeSnowflake(previous?.[rank.id]);
  return result;
}

function normalizeRankSkus(input = {}, previous = {}) {
  const result = {};
  for (const rank of NEXUS_RANKS) {
    const incoming = Object.prototype.hasOwnProperty.call(input || {}, rank.id) ? input[rank.id] : previous?.[rank.id] || [];
    result[rank.id] = safeSnowflakeList(incoming, 25);
  }
  return result;
}

function normalizeServer(server = {}, previous = {}) {
  return {
    ...previous,
    name: safeText(server.name, 80) || previous.name || 'Server',
    host: safeText(server.host, 255),
    port: safeInteger(server.port, Number(previous.port || 0)),
    passwordEnv: safeEnvName(server.passwordEnv, previous.passwordEnv || ''),
    restartOnExit: safeBoolean(server.restartOnExit, Boolean(previous.restartOnExit)),
    restartCommand: safeText(server.restartCommand, 500),
    backupPath: safeText(server.backupPath, 1000),
    ...(Object.prototype.hasOwnProperty.call(previous, 'mods') || Object.prototype.hasOwnProperty.call(server, 'mods') ? { mods: safeList(server.mods, 200, 120) } : {}),
    ...(Object.prototype.hasOwnProperty.call(previous, 'modpack') || Object.prototype.hasOwnProperty.call(server, 'modpack') ? { modpack: safeText(server.modpack, 160) } : {})
  };
}

function normalizeConnection(connection = {}, previous = {}) {
  const next = { ...previous };
  if (Array.isArray(previous.servers) || Array.isArray(connection.servers)) {
    const incoming = Array.isArray(connection.servers) ? connection.servers : [];
    const oldServers = Array.isArray(previous.servers) ? previous.servers : [];
    next.servers = incoming.slice(0, 20).map((server, index) => normalizeServer(server, oldServers[index] || {}));
    if (!next.servers.length && oldServers.length) next.servers = oldServers;
    return next;
  }

  if (Object.prototype.hasOwnProperty.call(previous, 'host')) next.host = safeText(connection.host, 255);
  if (Object.prototype.hasOwnProperty.call(previous, 'port')) next.port = safeInteger(connection.port, Number(previous.port || 0));
  if (Object.prototype.hasOwnProperty.call(previous, 'protocol')) next.protocol = safeProtocol(connection.protocol, previous.protocol || '');
  if (Object.prototype.hasOwnProperty.call(previous, 'apiPath')) {
    const apiPath = safeText(connection.apiPath, 180);
    next.apiPath = apiPath.startsWith('/') ? apiPath : previous.apiPath || '/';
  }
  if (Object.prototype.hasOwnProperty.call(previous, 'username')) next.username = safeText(connection.username, 120);
  if (Object.prototype.hasOwnProperty.call(previous, 'passwordEnv')) next.passwordEnv = safeEnvName(connection.passwordEnv, previous.passwordEnv || '');
  if (Object.prototype.hasOwnProperty.call(previous, 'restartViaShutdown')) next.restartViaShutdown = safeBoolean(connection.restartViaShutdown, Boolean(previous.restartViaShutdown));
  if (Object.prototype.hasOwnProperty.call(previous, 'backupPath')) next.backupPath = safeText(connection.backupPath, 1000);
  if (Object.prototype.hasOwnProperty.call(previous, 'tlsFingerprint')) next.tlsFingerprint = safeText(connection.tlsFingerprint, 200);
  return next;
}

function applyPublicSettings(currentConfig, input = {}) {
  const config = clone(currentConfig);
  delete config.__source;

  config.backend ||= {};
  config.backend.host = '127.0.0.1';
  config.backend.port = safeInteger(input.backend?.port, Number(config.backend.port || 3210), 1024, 65535);
  config.backend.publicBaseUrl = `http://127.0.0.1:${config.backend.port}`;

  config.accounts ||= {};
  config.accounts.stateFile ||= 'data/accounts.json';

  config.scheduler ||= {};
  config.scheduler.timeZone = safeText(input.scheduler?.timeZone, 80) || config.scheduler.timeZone || 'America/Chicago';

  config.discord ||= {};
  config.discord.guildId = safeSnowflake(input.discord?.guildId) || safeSnowflake(config.discord.guildId);
  config.discord.ownerUserIds = safeSnowflakeList(input.discord?.ownerUserIds, 20);
  config.discord.operatorRoleIds = safeSnowflakeList(input.discord?.operatorRoleIds, 50);
  config.discord.maxTemporaryLobbiesPerModule = safeInteger(
    input.discord?.maxTemporaryLobbiesPerModule,
    Number(config.discord.maxTemporaryLobbiesPerModule || 20),
    1,
    100
  );
  config.discord.oauthClientId = safeSnowflake(input.discord?.oauthClientId) || safeSnowflake(config.discord.oauthClientId);
  config.discord.oauthClientSecretEnv = safeEnvName(config.discord.oauthClientSecretEnv, 'NEXUS_DISCORD_OAUTH_CLIENT_SECRET');
  config.discord.oauthRedirectUri = safeDiscordRedirect(input.discord?.oauthRedirectUri || config.discord.oauthRedirectUri);
  config.discord.sentinalAdminUrl = safeSentinalAdminUrl(input.discord?.sentinalAdminUrl || config.discord.sentinalAdminUrl);
  config.discord.sentinalAdminTokenEnv = safeEnvName(config.discord.sentinalAdminTokenEnv, 'NEXUS_SENTINAL_ADMIN_TOKEN');
  config.discord.rankRoles = normalizeRankRoles(input.discord?.rankRoles || {}, config.discord.rankRoles || {});
  config.discord.rankSkus = normalizeRankSkus(input.discord?.rankSkus || {}, config.discord.rankSkus || {});

  config.thora ||= {};
  config.thora.enabled = safeBoolean(input.thora?.enabled, Boolean(config.thora.enabled));
  config.thora.executablePath = safeText(input.thora?.executablePath, 1200);

  config.updates ||= {};
  config.updates.enabled = safeBoolean(input.updates?.enabled, config.updates.enabled !== false);
  config.updates.channel = safeUpdateChannel(input.updates?.channel, safeUpdateChannel(config.updates.channel));
  config.updates.autoDownload = safeBoolean(input.updates?.autoDownload, config.updates.autoDownload !== false);

  config.modules ||= {};
  const incomingModules = input.modules && typeof input.modules === 'object' ? input.modules : {};
  for (const [moduleId, existing] of Object.entries(config.modules)) {
    const incoming = incomingModules[moduleId] && typeof incomingModules[moduleId] === 'object' ? incomingModules[moduleId] : {};
    existing.enabled = safeBoolean(incoming.enabled, existing.enabled !== false);
    existing.channelId = safeSnowflake(incoming.channelId) || '';
    if (Object.prototype.hasOwnProperty.call(existing, 'platform')) existing.platform = safeText(incoming.platform, 20).toLowerCase() || existing.platform || 'pc';
    if (Object.prototype.hasOwnProperty.call(existing, 'marketPlatform')) existing.marketPlatform = safeText(incoming.marketPlatform, 20).toLowerCase() || existing.marketPlatform || 'pc';
    if (existing.connection && typeof existing.connection === 'object') existing.connection = normalizeConnection(incoming.connection || {}, existing.connection);
  }

  return config;
}

function publicSettings(config) {
  const modules = {};
  for (const [moduleId, moduleConfig] of Object.entries(config.modules || {})) {
    modules[moduleId] = {
      enabled: moduleConfig.enabled !== false,
      channelId: moduleConfig.channelId || '',
      ...(Object.prototype.hasOwnProperty.call(moduleConfig, 'platform') ? { platform: moduleConfig.platform || 'pc' } : {}),
      ...(Object.prototype.hasOwnProperty.call(moduleConfig, 'marketPlatform') ? { marketPlatform: moduleConfig.marketPlatform || 'pc' } : {}),
      ...(moduleConfig.connection ? { connection: clone(moduleConfig.connection) } : {})
    };
  }
  return {
    backend: { port: Number(config.backend?.port || 3210) },
    scheduler: { timeZone: config.scheduler?.timeZone || 'America/Chicago' },
    discord: {
      guildId: config.discord?.guildId || '',
      ownerUserIds: [...(config.discord?.ownerUserIds || [])],
      operatorRoleIds: [...(config.discord?.operatorRoleIds || [])],
      maxTemporaryLobbiesPerModule: Number(config.discord?.maxTemporaryLobbiesPerModule || 20),
      oauthClientId: config.discord?.oauthClientId || '',
      oauthRedirectUri: config.discord?.oauthRedirectUri || 'http://127.0.0.1:53117/callback',
      sentinalAdminUrl: safeSentinalAdminUrl(config.discord?.sentinalAdminUrl),
      rankRoles: normalizeRankRoles(config.discord?.rankRoles || {}, {}),
      rankSkus: normalizeRankSkus(config.discord?.rankSkus || {}, {})
    },
    thora: {
      enabled: config.thora?.enabled === true,
      executablePath: config.thora?.executablePath || ''
    },
    updates: {
      enabled: config.updates?.enabled !== false,
      channel: safeUpdateChannel(config.updates?.channel),
      autoDownload: config.updates?.autoDownload !== false
    },
    modules
  };
}

function resolveUserDataPath(userDataPath, value, fallbackName) {
  const raw = safeText(value, 1200) || path.join('data', fallbackName);
  return path.isAbsolute(raw) ? raw : path.join(userDataPath, raw);
}

function runtimeConfig(config, userDataPath, configPath) {
  const next = clone(config);
  next.__source = configPath;
  next.backend ||= {};
  next.backend.host = '127.0.0.1';
  next.backend.port = Number(next.backend.port || 3210);
  next.backend.publicBaseUrl = `http://127.0.0.1:${next.backend.port}`;
  next.accounts ||= {};
  next.accounts.stateFile = resolveUserDataPath(userDataPath, next.accounts.stateFile, 'accounts.json');
  next.scheduler ||= {};
  next.scheduler.stateFile = resolveUserDataPath(userDataPath, next.scheduler.stateFile, 'schedules.json');
  if (next.modules?.division2) next.modules.division2.stateFile = resolveUserDataPath(userDataPath, next.modules.division2.stateFile, 'division2-state.json');
  if (next.modules?.idleon) next.modules.idleon.stateFile = resolveUserDataPath(userDataPath, next.modules.idleon.stateFile, 'idleon-state.json');
  ensureDirectory(path.join(userDataPath, 'data'));
  return next;
}

function saveUserConfig(configPath, config) {
  const cleanConfig = clone(config);
  delete cleanConfig.__source;
  atomicWriteJson(configPath, cleanConfig);
}

function collectSecretEnvNames(config) {
  const names = new Set();
  const add = (value) => {
    const name = safeEnvName(value, '');
    if (name) names.add(name);
  };
  add(config.backend?.serviceTokenEnv);
  add(config.discord?.tokenEnv);
  add(config.discord?.oauthClientSecretEnv);
  add(config.discord?.sentinalAdminTokenEnv);
  for (const moduleConfig of Object.values(config.modules || {})) {
    add(moduleConfig?.provider?.tokenEnv);
    add(moduleConfig?.connection?.passwordEnv);
    for (const server of moduleConfig?.connection?.servers || []) add(server?.passwordEnv);
  }
  return [...names].sort();
}

function configWarnings(config) {
  const warnings = [];
  if (!config.discord?.guildId) warnings.push('Discord guild ID is not configured.');
  if (!(config.discord?.ownerUserIds || []).length) warnings.push('No legacy Nexus owner user IDs are configured; Accounts & Access can link the Owner instead.');
  if (config.discord?.oauthClientId && !config.discord?.oauthRedirectUri) warnings.push('Discord OAuth redirect URI is not configured.');
  if (!config.discord?.sentinalAdminUrl) warnings.push('Nexus Sentinal admin URL is not configured.');
  const mappedRanks = NEXUS_RANKS.filter((rank) => config.discord?.rankRoles?.[rank.id]);
  if (mappedRanks.length && mappedRanks.length < NEXUS_RANKS.length) warnings.push(`Discord rank-role mapping is incomplete (${mappedRanks.length}/${NEXUS_RANKS.length}).`);
  for (const [moduleId, moduleConfig] of Object.entries(config.modules || {})) {
    if (moduleConfig.enabled !== false && !moduleConfig.channelId && moduleId !== 'dnd') warnings.push(`${moduleId}: Sentinal channel binding is not configured.`);
  }
  return warnings;
}

module.exports = {
  applyPublicSettings,
  atomicWriteJson,
  collectSecretEnvNames,
  configWarnings,
  ensureUserConfig,
  normalizeRankRoles,
  normalizeRankSkus,
  publicSettings,
  readJson,
  runtimeConfig,
  safeSentinalAdminUrl,
  safeUpdateChannel,
  saveUserConfig
};
