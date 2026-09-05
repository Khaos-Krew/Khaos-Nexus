'use strict';

const VALID_MODES = new Set(['disabled', 'shadow', 'active']);

function env(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

function booleanEnv(name, fallback = false) {
  const raw = env(name);
  if (!raw) return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function integerEnv(name, fallback, minimum = 1000) {
  const parsed = Number(env(name));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.floor(parsed));
}

function loadArnDedicatedConfig() {
  const modeRaw = env('ARN_MODE', 'shadow').toLowerCase();
  const mode = VALID_MODES.has(modeRaw) ? modeRaw : 'shadow';

  return {
    mode,
    discord: {
      token: env('ARN_DISCORD_TOKEN'),
      applicationId: env('ARN_DISCORD_APPLICATION_ID'),
      clientId: env('ARN_DISCORD_CLIENT_ID'),
      guildId: env('ARN_DISCORD_GUILD_ID', env('NEXUS_DISCORD_GUILD_ID')),
      publicChannelId: env('ARN_PUBLIC_CHANNEL_ID'),
      ingestChannelId: env('ARN_INGEST_CHANNEL_ID')
    },
    polling: {
      intervalMs: integerEnv('ARN_RECONCILE_INTERVAL_MS', 30_000, 10_000)
    },
    cutover: {
      ready: booleanEnv('ARN_CUTOVER_READY', false),
      cleanupForeignPanels: booleanEnv('ARN_CLEANUP_SENTINAL_PANELS', false)
    },
    storage: {
      databaseUrl: env('ARN_DATABASE_URL', env('DATABASE_URL'))
    },
    sentinal: {
      jobEndpoint: env('ARN_SENTINAL_JOB_ENDPOINT'),
      jobSecret: env('ARN_SENTINAL_JOB_SECRET')
    }
  };
}

function validateArnDedicatedConfig(config = loadArnDedicatedConfig()) {
  const missing = [];
  if (config.mode === 'disabled') return { ok: true, missing, mode: config.mode };
  if (!config.discord.token) missing.push('ARN_DISCORD_TOKEN');
  if (!config.discord.guildId) missing.push('ARN_DISCORD_GUILD_ID');
  if (config.mode === 'active') {
    if (!config.discord.publicChannelId) missing.push('ARN_PUBLIC_CHANNEL_ID');
    if (!config.discord.ingestChannelId) missing.push('ARN_INGEST_CHANNEL_ID');
    if (!config.cutover.ready) missing.push('ARN_CUTOVER_READY=true');
  }
  return { ok: missing.length === 0, missing, mode: config.mode };
}

function safeConfigSummary(config = loadArnDedicatedConfig()) {
  return {
    mode: config.mode,
    guildConfigured: Boolean(config.discord.guildId),
    publicChannelConfigured: Boolean(config.discord.publicChannelId),
    ingestChannelConfigured: Boolean(config.discord.ingestChannelId),
    databaseConfigured: Boolean(config.storage.databaseUrl),
    sentinalJobHandoffConfigured: Boolean(config.sentinal.jobEndpoint && config.sentinal.jobSecret),
    reconcileIntervalMs: config.polling.intervalMs,
    cutoverReady: config.cutover.ready,
    cleanupForeignPanels: config.cutover.cleanupForeignPanels
  };
}

module.exports = {
  VALID_MODES,
  loadArnDedicatedConfig,
  validateArnDedicatedConfig,
  safeConfigSummary
};
