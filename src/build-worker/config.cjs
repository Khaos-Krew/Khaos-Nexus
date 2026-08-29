'use strict';

const VALID_CAPABILITIES = new Set(['build', 'test', 'validation', 'deploy']);
const VALID_LANES = new Set(['forge', 'ark', 'general']);

function positiveInteger(value, fallback, minimum = 1) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function list(value) {
  return String(value || '').split(',').map((part) => part.trim()).filter(Boolean);
}

function loadConfig(env = process.env) {
  const nodeId = String(env.NODE_ID || '').trim();
  if (!/^KNX-BUILD-NODE-0[1-3]$/.test(nodeId)) {
    throw new Error('NODE_ID must be KNX-BUILD-NODE-01, KNX-BUILD-NODE-02, or KNX-BUILD-NODE-03');
  }
  const lane = String(env.NODE_LANE || 'general').trim().toLowerCase();
  if (!VALID_LANES.has(lane)) throw new Error(`Unsupported NODE_LANE: ${lane}`);

  const capabilities = list(env.NODE_CAPABILITIES || 'build,test,validation,deploy').map((item) => item.toLowerCase());
  if (!capabilities.length || capabilities.some((item) => !VALID_CAPABILITIES.has(item))) {
    throw new Error('NODE_CAPABILITIES contains an unsupported capability');
  }

  const databaseUrl = String(env.DATABASE_URL || '').trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  return {
    nodeId,
    lane,
    capabilities,
    databaseUrl,
    port: positiveInteger(env.PORT, 8080),
    pollMs: positiveInteger(env.WORKER_POLL_MS, 3_000, 250),
    heartbeatMs: positiveInteger(env.WORKER_HEARTBEAT_MS, 20_000, 1_000),
    leaseSeconds: positiveInteger(env.WORKER_LEASE_SECONDS, 120, 30),
    commandTimeoutMs: positiveInteger(env.WORKER_COMMAND_TIMEOUT_SECONDS, 1_800, 30) * 1_000,
    workspaceRoot: String(env.WORKER_WORKSPACE_ROOT || '/tmp/nexus-worker').trim(),
    allowedRepos: new Set(list(env.WORKER_ALLOWED_REPOS || 'Khaos-Krew/Khaos-Nexus,Khaos-Krew/Nexus-Overseer')),
    githubToken: String(env.GITHUB_TOKEN || '').trim(),
    apiToken: String(env.WORKER_API_TOKEN || '').trim(),
    deployWebhookUrl: String(env.SENTINAL_DEPLOY_WEBHOOK_URL || '').trim(),
    sentinalHealthUrl: String(env.SENTINAL_HEALTH_URL || '').trim(),
    healthTimeoutMs: positiveInteger(env.SENTINAL_HEALTH_TIMEOUT_SECONDS, 180, 10) * 1_000,
    releaseLockName: String(env.SENTINAL_DEPLOY_LOCK_NAME || 'sentinal-production-deploy').trim()
  };
}

module.exports = { loadConfig, VALID_CAPABILITIES, VALID_LANES };
