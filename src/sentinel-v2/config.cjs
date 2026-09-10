'use strict';

function env(name, legacyName, fallback = '') {
  const primary = String(process.env[name] ?? '').trim();
  if (primary) return primary;
  if (legacyName) {
    const legacy = String(process.env[legacyName] ?? '').trim();
    if (legacy) return legacy;
  }
  return fallback;
}

function boolEnv(name, fallback = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error(`Invalid boolean for ${name}`);
}

function intEnv(name, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid integer for ${name}`);
  }
  return value;
}

function listEnv(name, fallback = []) {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return [...fallback];
  return [...new Set(raw.split(',').map((item) => item.trim()).filter(Boolean))];
}

function loadSentinelConfig() {
  const config = {
    serviceName: env('NEXUS_SENTINEL_SERVICE_NAME', null, 'nexus-sentinel'),
    mode: env('NEXUS_SENTINEL_MODE', null, 'control-plane'),
    port: intEnv('PORT', 3210, { min: 1, max: 65535 }),
    mutationEnabled: boolEnv('NEXUS_SENTINEL_MUTATIONS_ENABLED', false),
    dryRun: boolEnv('NEXUS_SENTINEL_DRY_RUN', true),
    actionAllowlist: listEnv('NEXUS_SENTINEL_ACTION_ALLOWLIST'),
    discordToken: env('NEXUS_SENTINEL_TOKEN', 'NEXUS_SENTINAL_TOKEN'),
    guildId: env('NEXUS_SENTINEL_GUILD_ID', 'NEXUS_DISCORD_GUILD_ID'),
    adminPublicUrl: env('NEXUS_SENTINEL_ADMIN_PUBLIC_URL', 'NEXUS_SENTINAL_ADMIN_PUBLIC_URL'),
    adminToken: env('NEXUS_SENTINEL_ADMIN_TOKEN', 'NEXUS_SENTINAL_ADMIN_TOKEN'),
    databaseUrl: env('DATABASE_URL'),
    logLevel: env('NEXUS_SENTINEL_LOG_LEVEL', null, 'info'),
    schedulerPollMs: intEnv('NEXUS_SENTINEL_SCHEDULER_POLL_MS', 5000, { min: 500, max: 60000 }),
    arkShadowEnabled: boolEnv('NEXUS_SENTINEL_ARK_SHADOW_ENABLED', false),
    arkShadowIntervalMs: intEnv('NEXUS_SENTINEL_ARK_SHADOW_INTERVAL_MS', 300000, { min: 60000, max: 3600000 }),
    arkShadowJitterMs: intEnv('NEXUS_SENTINEL_ARK_SHADOW_JITTER_MS', 30000, { min: 0, max: 300000 }),
    arkShadowHistoryHours: intEnv('NEXUS_SENTINEL_ARK_SHADOW_HISTORY_HOURS', 24, { min: 1, max: 168 }),
    arkRconShadowEnabled: boolEnv('NEXUS_SENTINEL_ARK_RCON_SHADOW_ENABLED', false),
    arkRconShadowIntervalMs: intEnv('NEXUS_SENTINEL_ARK_RCON_SHADOW_INTERVAL_MS', 300000, { min: 60000, max: 3600000 }),
    arkRconShadowJitterMs: intEnv('NEXUS_SENTINEL_ARK_RCON_SHADOW_JITTER_MS', 30000, { min: 0, max: 300000 }),
    arkRconShadowHistoryHours: intEnv('NEXUS_SENTINEL_ARK_RCON_SHADOW_HISTORY_HOURS', 24, { min: 1, max: 168 }),
    deploymentCommit: env('NEXUS_SENTINEL_DEPLOYMENT_COMMIT'),
    rollbackCommit: env('NEXUS_SENTINEL_ROLLBACK_COMMIT'),
    rollbackVerified: boolEnv('NEXUS_SENTINEL_ROLLBACK_VERIFIED', false),
  };

  if (!['control-plane', 'worker', 'shadow'].includes(config.mode)) {
    throw new Error(`Invalid NEXUS_SENTINEL_MODE: ${config.mode}`);
  }

  if (config.mutationEnabled && config.dryRun) {
    config.mutationEnabled = false;
  }

  return Object.freeze(config);
}

module.exports = { loadSentinelConfig, env, boolEnv, intEnv, listEnv };
