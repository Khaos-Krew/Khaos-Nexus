'use strict';

const RUNTIME = Object.freeze({
  id: 'khaos-nexus-ai-runtime',
  label: 'Khaos Nexus AI Runtime',
  version: '1.0.0'
});

const AGENTS = Object.freeze({
  dnd: Object.freeze({
    key: 'dnd',
    id: 'dnd-ai',
    name: 'Veyra',
    label: 'Veyra',
    title: 'D&D Lorewarden and Co-DM',
    role: 'D&D campaign intelligence, Co-DM guidance, homebrew, maps, encounters, and explicit AI Game Master sessions',
    endpoint: 'http://127.0.0.1:8787',
    healthPath: '/health',
    env: Object.freeze({
      HOST: '127.0.0.1',
      PORT: '8787',
      AI_PROVIDER: 'mock',
      CAMPAIGN_STORE: 'json',
      AUTH_REQUIRED: 'false'
    })
  }),
  core: Object.freeze({
    key: 'core',
    id: 'ai-core',
    name: 'Nexus Sentinel',
    label: 'Nexus Sentinel',
    title: 'System Health and Assistance AI',
    role: 'Khaos Nexus application health, diagnostics, update intelligence, module assistance, and advisory maintenance proposals',
    endpoint: '',
    env: Object.freeze({
      HOST: '127.0.0.1',
      PORT: '0',
      AI_PROVIDER: 'deterministic-local'
    })
  })
});

function cleanText(value, max = 800) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function agentKey(value, allowAll = false) {
  const key = String(value || '').trim().toLowerCase();
  if (allowAll && ['all', 'runtime'].includes(key)) return key === 'runtime' ? 'all' : key;
  if (!Object.hasOwn(AGENTS, key)) {
    const error = new Error('Unknown Khaos Nexus AI agent.');
    error.code = 'AI_AGENT_UNKNOWN';
    throw error;
  }
  return key;
}

function actionKey(value) {
  const action = String(value || '').trim().toLowerCase();
  if (!['start', 'stop', 'restart'].includes(action)) {
    const error = new Error('Unknown AI runtime action.');
    error.code = 'AI_RUNTIME_ACTION_UNKNOWN';
    throw error;
  }
  return action;
}

function validateCoreReadiness(readiness, nonce) {
  if (!readiness || readiness.event !== 'nexus-ai-core.ready') throw new Error('Nexus Sentinel readiness event is invalid.');
  if (readiness.startupNonce !== nonce) throw new Error('Nexus Sentinel readiness nonce did not match.');
  if (readiness.service !== 'khaos-nexus-ai-core' || readiness.serviceVersion !== '0.7.0') throw new Error('Nexus Sentinel service version is incompatible.');
  if (readiness.apiVersion !== '1' || readiness.serviceContractVersion !== '1.0.0' || readiness.sidecarContractVersion !== '1.0.0') throw new Error('Nexus Sentinel contract is incompatible.');
  if (readiness.targetService !== 'nexus-ai-core') throw new Error('Nexus Sentinel target service is incompatible.');
  if (readiness.host !== '127.0.0.1' || !Number.isInteger(readiness.port) || readiness.port < 1) throw new Error('Nexus Sentinel endpoint is not loopback-safe.');
  if (readiness.boundaries?.directExecution !== false || readiness.boundaries?.directDiscordConnection !== false || readiness.boundaries?.directServiceForwarding !== false || readiness.boundaries?.directDndCallsAllowed !== false) throw new Error('Nexus Sentinel authority boundary is unsafe.');
  if (readiness.monitor?.schedulerOwnedExternally !== true || readiness.monitor?.githubWebhooksEnabled !== false) throw new Error('Nexus Sentinel scheduler boundary is incompatible.');
  return `http://127.0.0.1:${readiness.port}`;
}

function agentState(key, value = {}) {
  const agent = AGENTS[agentKey(key)];
  return {
    key: agent.key,
    id: agent.id,
    name: agent.name,
    label: agent.label,
    title: agent.title,
    role: agent.role,
    endpoint: value.endpoint || agent.endpoint,
    status: value.status || 'stopped',
    pid: Number.isInteger(value.pid) ? value.pid : null,
    startedAt: value.startedAt || null,
    stoppedAt: value.stoppedAt || null,
    exitCode: Number.isInteger(value.exitCode) ? value.exitCode : null,
    error: cleanText(value.error),
    version: cleanText(value.version, 80),
    commit: cleanText(value.commit, 120),
    authenticated: key === 'core' ? value.authenticated === true : false,
    contract: value.contract || null
  };
}

function runtimeStatus(agents = [], value = {}) {
  const normalizedAgents = Object.keys(AGENTS).map((key) => {
    const current = agents.find?.((item) => item?.key === key) || {};
    return agentState(key, current);
  });
  const active = normalizedAgents.filter((item) => ['starting', 'running', 'ready', 'stopping'].includes(item.status));
  const failed = normalizedAgents.filter((item) => item.status === 'failed');
  const starting = normalizedAgents.some((item) => item.status === 'starting');
  const stopping = normalizedAgents.some((item) => item.status === 'stopping');
  const ready = normalizedAgents.filter((item) => ['running', 'ready'].includes(item.status));
  let status = value.status || 'stopped';
  if (!value.status) {
    if (stopping) status = 'stopping';
    else if (failed.length && active.length) status = 'degraded';
    else if (failed.length) status = 'failed';
    else if (starting) status = 'starting';
    else if (ready.length) status = 'ready';
    else status = 'stopped';
  }
  return {
    id: RUNTIME.id,
    label: RUNTIME.label,
    version: RUNTIME.version,
    status,
    pid: Number.isInteger(value.pid) ? value.pid : null,
    startedAt: value.startedAt || null,
    stoppedAt: value.stoppedAt || null,
    exitCode: Number.isInteger(value.exitCode) ? value.exitCode : null,
    error: cleanText(value.error),
    agents: normalizedAgents
  };
}

module.exports = {
  RUNTIME,
  AGENTS,
  cleanText,
  agentKey,
  actionKey,
  validateCoreReadiness,
  agentState,
  runtimeStatus
};
