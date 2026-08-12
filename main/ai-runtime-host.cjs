'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  buildServiceEnvironment,
  fileSize,
  readLatestSidecarDiagnostic,
  formatSidecarDiagnostic
} = require('./ai-runtime-environment.cjs');
const {
  RUNTIME,
  AGENTS,
  cleanText,
  agentKey,
  actionKey,
  validateCoreReadiness,
  agentState,
  runtimeStatus
} = require('./ai-runtime-contract.cjs');

const STOP_TIMEOUT_MS = 5000;
const FORCE_EXIT_TIMEOUT_MS = 2000;
const READY_TIMEOUT_MS = 15000;
const HEALTH_POLL_MS = 150;
const MAX_HEALTH_BYTES = 64 * 1024;
const agents = new Map();
let initialized = false;
let shuttingDown = false;
let runtimeNonce = '';
let launcherPath = '';
let configuration = null;
let runtimeStartedAt = null;
let runtimeStoppedAt = null;
let runtimeError = '';

function nowIso() { return new Date().toISOString(); }
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function clearTimer(value, key) {
  if (!value?.[key]) return;
  clearTimeout(value[key]);
  value[key] = null;
}
function closeDescriptor(descriptor) {
  if (!Number.isInteger(descriptor)) return;
  try { fs.closeSync(descriptor); } catch {}
}
function safeAbsolute(value, label) {
  const raw = String(value || '').trim();
  if (!raw || !path.isAbsolute(raw)) {
    const error = new Error(`${label} is unavailable.`);
    error.code = 'AI_RUNTIME_CONFIGURATION_INVALID';
    throw error;
  }
  const absolute = path.resolve(raw);
  if (!fs.existsSync(absolute)) {
    const error = new Error(`${label} is unavailable.`);
    error.code = 'AI_RUNTIME_CONFIGURATION_INVALID';
    throw error;
  }
  return absolute;
}
function safeEntry(root, value, label) {
  const absolute = safeAbsolute(value, label);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    const error = new Error(`${label} is outside its verified bundle.`);
    error.code = 'AI_RUNTIME_CONFIGURATION_INVALID';
    throw error;
  }
  return absolute;
}
function safePrivateFile(root, value, label) {
  const raw = String(value || '').trim();
  if (!raw || !path.isAbsolute(raw)) {
    const error = new Error(`${label} is unavailable.`);
    error.code = 'AI_RUNTIME_CONFIGURATION_INVALID';
    throw error;
  }
  const absolute = path.resolve(raw);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    const error = new Error(`${label} is outside its private data directory.`);
    error.code = 'AI_RUNTIME_CONFIGURATION_INVALID';
    throw error;
  }
  return absolute;
}
function normalizeAgentConfig(key, input = {}) {
  const agent = AGENTS[key];
  const root = safeAbsolute(input.root, `${agent.label} bundle root`);
  const entry = safeEntry(root, input.entry, `${agent.label} entry point`);
  const rawDataDir = String(input.dataDir || '').trim();
  if (!rawDataDir || !path.isAbsolute(rawDataDir)) throw new Error(`${agent.label} data directory is unavailable.`);
  const dataDir = path.resolve(rawDataDir);
  fs.mkdirSync(dataDir, { recursive: true });
  return {
    key,
    root,
    entry,
    dataDir,
    logPath: path.join(dataDir, 'service.log'),
    version: cleanText(input.version, 80),
    commit: cleanText(input.commit, 120),
    serviceToken: key === 'core' ? cleanText(input.serviceToken, 500) : '',
    startupNonce: key === 'core' ? cleanText(input.startupNonce, 500) : '',
    readyFile: key === 'core' ? safePrivateFile(dataDir, input.readyFile, `${agent.label} readiness file`) : '',
    monitorStateFile: key === 'core' ? safePrivateFile(dataDir, input.monitorStateFile, `${agent.label} monitor state file`) : ''
  };
}
function initialize(input = {}) {
  if (initialized) return;
  runtimeNonce = cleanText(input.nonce, 500);
  if (!runtimeNonce) throw new Error('AI runtime startup nonce is required.');
  launcherPath = safeAbsolute(input.launcher, 'AI runtime agent launcher');
  const launcherRelative = path.relative(__dirname, launcherPath);
  if (launcherRelative.startsWith('..') || path.isAbsolute(launcherRelative)) {
    throw new Error('AI runtime agent launcher is outside the application source.');
  }
  const startAgents = Array.isArray(input.startAgents)
    ? [...new Set(input.startAgents.map((key) => agentKey(key)))]
    : Object.keys(AGENTS);
  configuration = { startAgents };
  for (const key of Object.keys(AGENTS)) {
    if (input.agents?.[key]) configuration[key] = normalizeAgentConfig(key, input.agents[key]);
  }
  for (const key of startAgents) {
    if (configuration[key]) continue;
    const error = new Error(`${AGENTS[key].label} bundle is unavailable to the unified runtime host.`);
    error.code = 'AI_RUNTIME_AGENT_UNAVAILABLE';
    throw error;
  }
  if (configuration.core && (!configuration.core.serviceToken || !configuration.core.startupNonce || !configuration.core.readyFile || !configuration.core.monitorStateFile)) {
    throw new Error('Nexus Sentinel private startup contract is incomplete.');
  }
  initialized = true;
  runtimeStartedAt = nowIso();
  emitStatus();
}

function childAlive(value, child = value?.child) {
  return Boolean(child && value?.child === child && child.exitCode === null && child.signalCode === null);
}
function stateFor(key) {
  const value = agents.get(key) || {};
  return agentState(key, {
    endpoint: value.endpoint,
    status: value.status,
    pid: value.child?.pid,
    startedAt: value.startedAt,
    stoppedAt: value.stoppedAt,
    exitCode: value.exitCode,
    error: value.error,
    version: value.config?.version,
    commit: value.config?.commit,
    authenticated: key === 'core' && Boolean(value.config?.serviceToken),
    contract: value.readiness ? {
      apiVersion: value.readiness.apiVersion,
      serviceContractVersion: value.readiness.serviceContractVersion,
      sidecarContractVersion: value.readiness.sidecarContractVersion,
      targetService: value.readiness.targetService,
      monitorAvailable: value.readiness.monitor?.available === true,
      schedulerOwnedExternally: value.readiness.monitor?.schedulerOwnedExternally === true
    } : null
  });
}
function publicStatus() {
  const values = Object.keys(AGENTS).map(stateFor);
  const base = runtimeStatus(values, {
    pid: process.pid,
    startedAt: runtimeStartedAt,
    stoppedAt: runtimeStoppedAt,
    error: runtimeError
  });
  if (shuttingDown) base.status = 'stopping';
  return base;
}
function send(message) {
  if (!process.connected) return false;
  try { process.send(message); return true; } catch { return false; }
}
function emitStatus() {
  send({ type: 'khaos-nexus-ai-runtime.status', nonce: runtimeNonce, payload: publicStatus() });
}
function recordFailure(key, error) {
  const value = agents.get(key) || { config: configuration?.[key] };
  value.status = 'failed';
  value.error = cleanText(error?.message || error || `${AGENTS[key].label} failed to start.`);
  value.stoppedAt = nowIso();
  agents.set(key, value);
  emitStatus();
  return stateFor(key);
}

function launchLogEvents(logPath, startOffset = 0) {
  try {
    const descriptor = fs.openSync(logPath, 'r');
    try {
      const stat = fs.fstatSync(descriptor);
      if (stat.size <= startOffset) return [];
      const length = Math.min(stat.size - startOffset, MAX_HEALTH_BYTES);
      const buffer = Buffer.alloc(length);
      fs.readSync(descriptor, buffer, 0, length, startOffset);
      return buffer.toString('utf8').split(/\r?\n/).map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
    } finally { fs.closeSync(descriptor); }
  } catch { return []; }
}
function veyraListening(value) {
  return launchLogEvents(value.config.logPath, value.logStartOffset || 0).some((event) =>
    event?.event === 'service.listening'
      && event?.service === 'khaos-nexus-ai'
      && Number(event?.port) === 8787
      && String(event?.host || '') === '127.0.0.1'
  );
}

function requestJson(endpoint, pathname, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const request = http.get(`${endpoint}${pathname}`, {
      headers: { accept: 'application/json', 'user-agent': 'Khaos-Nexus-AI-Runtime/1' },
      timeout: timeoutMs
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_HEALTH_BYTES) request.destroy(new Error('Agent health response was too large.'));
      });
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`Agent health returned HTTP ${response.statusCode}.`));
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Agent health returned invalid JSON.')); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Agent health request timed out.')));
    request.on('error', reject);
  });
}
async function waitForVeyra(value, child) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError = null;
  while (Date.now() < deadline && childAlive(value, child) && value.status === 'starting') {
    try {
      if (!veyraListening(value)) throw new Error('Veyra has not emitted a launch-scoped listening event.');
      const health = await requestJson(AGENTS.dnd.endpoint, AGENTS.dnd.healthPath);
      if (health?.status !== 'ok' || health?.service !== 'khaos-nexus-ai') throw new Error('Veyra health contract is incompatible.');
      if (!childAlive(value, child) || value.status !== 'starting') return;
      value.endpoint = AGENTS.dnd.endpoint;
      value.readiness = { service: health.service, version: health.version || value.config.version, provider: health.provider, model: health.model };
      value.status = 'ready';
      value.error = '';
      emitStatus();
      return;
    } catch (error) {
      lastError = error;
      await delay(HEALTH_POLL_MS);
    }
  }
  if (!childAlive(value, child) || value.status !== 'starting') return;
  value.status = 'failed';
  value.error = cleanText(`Veyra did not report readiness before the startup timeout${lastError?.message ? `: ${lastError.message}` : '.'}`);
  try { child.kill(); } catch {}
  emitStatus();
}
function workerEnvironment(key, config) {
  const serviceEnv = { ...AGENTS[key].env };
  if (key === 'core') {
    serviceEnv.NEXUS_AI_CORE_SERVICE_TOKEN = config.serviceToken;
    serviceEnv.NEXUS_AI_CORE_STARTUP_NONCE = config.startupNonce;
    serviceEnv.NEXUS_AI_CORE_READY_FILE = config.readyFile;
    serviceEnv.MONITOR_STATE_FILE = config.monitorStateFile;
    serviceEnv.NEXUS_AI_CORE_PARENT_PID = String(process.pid);
  }
  return buildServiceEnvironment({
    serviceEnv,
    serviceData: config.dataDir,
    parentEnv: process.env,
    nodeEnv: key === 'dnd' ? 'development' : 'production'
  });
}
function finalizeExit(key, value, child, code, signal) {
  clearTimer(value, 'readyTimer');
  if (value.child !== child) return;
  value.exitCode = Number.isInteger(code) ? code : null;
  value.exitSignal = signal || null;
  value.stoppedAt = nowIso();
  value.child = null;
  value.endpoint = AGENTS[key].endpoint;
  value.readiness = null;
  if (key === 'core' && value.config?.readyFile) {
    try { fs.rmSync(value.config.readyFile, { force: true }); } catch {}
  }
  if (value.stopRequested || code === 0) {
    value.status = 'stopped';
    if (value.stopRequested) value.error = '';
  } else {
    value.status = 'failed';
    if (key === 'core') {
      const diagnostic = readLatestSidecarDiagnostic(value.config.logPath, value.logStartOffset || 0);
      if (diagnostic) value.error = formatSidecarDiagnostic(AGENTS.core.label, diagnostic);
    }
    if (!value.error) value.error = cleanText(`${AGENTS[key].label} exited unexpectedly${Number.isInteger(code) ? ` with code ${code}` : ''}${signal ? ` (${signal})` : ''}.`);
  }
  value.resolveExit?.();
  value.resolveExit = null;
  emitStatus();
}
function startAgent(inputKey) {
  if (!initialized || !configuration) throw new Error('Khaos Nexus AI Runtime is not initialized.');
  const key = agentKey(inputKey);
  const current = agents.get(key);
  if (current?.child) return stateFor(key);
  const config = configuration[key];
  if (!config) {
    const error = new Error(`${AGENTS[key].label} bundle was not supplied to this runtime host. Restart the AI runtime after repairing the bundle.`);
    error.code = 'AI_RUNTIME_AGENT_UNAVAILABLE';
    throw error;
  }
  const value = {
    config,
    child: null,
    status: 'starting',
    startedAt: nowIso(),
    stoppedAt: null,
    stopRequested: false,
    endpoint: AGENTS[key].endpoint,
    readiness: null,
    error: '',
    exitCode: null,
    exitPromise: null,
    resolveExit: null,
    stopPromise: null,
    readyTimer: null,
    logStartOffset: fileSize(config.logPath)
  };
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (key === 'core') {
    try { fs.rmSync(config.readyFile, { force: true }); } catch {}
  }
  let descriptor = null;
  let child;
  try {
    descriptor = fs.openSync(config.logPath, 'a');
    child = spawn(process.execPath, [launcherPath, key, config.entry], {
      cwd: config.root,
      env: workerEnvironment(key, config),
      windowsHide: true,
      stdio: ['ignore', descriptor, descriptor, 'ipc']
    });
  } catch (error) {
    closeDescriptor(descriptor);
    return recordFailure(key, error);
  } finally {
    closeDescriptor(descriptor);
  }
  value.child = child;
  value.exitPromise = new Promise((resolve) => { value.resolveExit = resolve; });
  agents.set(key, value);
  child.once('spawn', () => emitStatus());
  if (key === 'dnd') void waitForVeyra(value, child);
  if (key === 'core') {
    value.readyTimer = setTimeout(() => {
      if (!childAlive(value, child) || value.status !== 'starting') return;
      value.status = 'failed';
      value.error = 'Nexus Sentinel did not report readiness before the startup timeout.';
      try { child.kill(); } catch {}
      emitStatus();
    }, READY_TIMEOUT_MS);
    value.readyTimer.unref?.();
    child.on('message', (message) => {
      if (!childAlive(value, child) || value.status !== 'starting') return;
      try {
        value.endpoint = validateCoreReadiness(message, config.startupNonce);
        value.readiness = message;
        value.status = 'ready';
        value.error = '';
        clearTimer(value, 'readyTimer');
        emitStatus();
      } catch (error) {
        value.status = 'failed';
        value.error = cleanText(error?.message || error);
        clearTimer(value, 'readyTimer');
        try { child.kill(); } catch {}
        emitStatus();
      }
    });
  }
  child.once('error', (error) => {
    if (value.child !== child) return;
    value.status = 'failed';
    value.error = cleanText(error?.message || error);
    clearTimer(value, 'readyTimer');
    emitStatus();
  });
  child.once('close', (code, signal) => finalizeExit(key, value, child, code, signal));
  emitStatus();
  return stateFor(key);
}
async function stopAgent(inputKey, options = {}) {
  const key = agentKey(inputKey);
  const value = agents.get(key);
  const child = value?.child;
  if (!child) return stateFor(key);
  if (!childAlive(value, child)) {
    await (value.exitPromise || Promise.resolve());
    return stateFor(key);
  }
  if (value.stopPromise) return value.stopPromise;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Math.max(100, Number(options.timeoutMs)) : STOP_TIMEOUT_MS;
  value.stopPromise = (async () => {
    value.stopRequested = true;
    value.status = 'stopping';
    clearTimer(value, 'readyTimer');
    emitStatus();
    try {
      if (key === 'core' && child.connected) child.send({ type: 'nexus-ai-core.shutdown' });
      else child.kill();
    } catch (error) { value.error = cleanText(error?.message || error); }
    const graceful = await Promise.race([value.exitPromise.then(() => true), delay(timeoutMs).then(() => false)]);
    if (!graceful && childAlive(value, child)) {
      try { child.kill('SIGKILL'); } catch (error) { value.error = cleanText(error?.message || error); }
      await Promise.race([value.exitPromise, delay(FORCE_EXIT_TIMEOUT_MS)]);
    }
    if (childAlive(value, child)) {
      value.status = 'failed';
      value.error = `${AGENTS[key].label} did not stop after forced termination.`;
      emitStatus();
      const error = new Error(value.error);
      error.code = 'AI_AGENT_STOP_TIMEOUT';
      throw error;
    }
    return stateFor(key);
  })().finally(() => {
    if (agents.get(key) === value) value.stopPromise = null;
  });
  return value.stopPromise;
}
async function restartAgent(inputKey) {
  const key = agentKey(inputKey);
  await stopAgent(key);
  return startAgent(key);
}
function startAll() {
  return Object.keys(AGENTS).map((key) => {
    try { return startAgent(key); }
    catch (error) { return recordFailure(key, error); }
  });
}
async function stopAll(options = {}) {
  return Promise.all(Object.keys(AGENTS).map(async (key) => {
    try { return await stopAgent(key, options); }
    catch (error) { return recordFailure(key, error); }
  }));
}
async function restartAll() {
  return Promise.all(Object.keys(AGENTS).map(async (key) => {
    try { return await restartAgent(key); }
    catch (error) { return recordFailure(key, error); }
  }));
}
async function command(actionInput, serviceInput, options = {}) {
  const action = actionKey(actionInput);
  const service = agentKey(serviceInput, true);
  if (service === 'all') {
    if (action === 'start') return startAll();
    if (action === 'stop') return stopAll(options);
    return restartAll();
  }
  if (action === 'start') return startAgent(service);
  if (action === 'stop') return stopAgent(service, options);
  return restartAgent(service);
}
async function handleMessage(message = {}) {
  if (message.type === 'khaos-nexus-ai-runtime.initialize') {
    try {
      initialize(message.payload || {});
      for (const key of configuration.startAgents) startAgent(key);
    } catch (error) {
      runtimeError = cleanText(error?.message || error);
      send({ type: 'khaos-nexus-ai-runtime.fatal', nonce: runtimeNonce, error: runtimeError, code: error?.code || 'AI_RUNTIME_INITIALIZATION_FAILED' });
      process.exitCode = 70;
      setImmediate(() => process.exit());
    }
    return;
  }
  if (!initialized || message.nonce !== runtimeNonce) return;
  if (message.type === 'khaos-nexus-ai-runtime.command') {
    const requestId = cleanText(message.requestId, 200);
    try {
      const result = await command(message.action, message.service, message.options || {});
      send({ type: 'khaos-nexus-ai-runtime.response', nonce: runtimeNonce, requestId, ok: true, result });
    } catch (error) {
      send({ type: 'khaos-nexus-ai-runtime.response', nonce: runtimeNonce, requestId, ok: false, error: cleanText(error?.message || error), code: error?.code || 'AI_RUNTIME_COMMAND_FAILED' });
    }
    return;
  }
  if (message.type === 'khaos-nexus-ai-runtime.shutdown') await shutdown('parent-requested');
}
async function shutdown(reason = 'shutdown') {
  if (shuttingDown) return;
  shuttingDown = true;
  emitStatus();
  await stopAll({ timeoutMs: 1500 });
  runtimeStoppedAt = nowIso();
  const stoppedPayload = runtimeStatus(Object.keys(AGENTS).map(stateFor), {
    status: 'stopped',
    pid: process.pid,
    startedAt: runtimeStartedAt,
    stoppedAt: runtimeStoppedAt,
    error: runtimeError
  });
  send({ type: 'khaos-nexus-ai-runtime.stopped', nonce: runtimeNonce, reason, payload: stoppedPayload });
  try { if (process.connected) process.disconnect(); } catch {}
  process.exitCode = 0;
  setImmediate(() => process.exit());
}

process.on('message', (message) => { void handleMessage(message); });
process.on('disconnect', () => { void shutdown('parent-disconnected'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('uncaughtException', (error) => {
  runtimeError = cleanText(error?.message || error);
  send({ type: 'khaos-nexus-ai-runtime.fatal', nonce: runtimeNonce, error: runtimeError, code: error?.code || 'AI_RUNTIME_UNCAUGHT_EXCEPTION' });
  void shutdown('uncaught-exception');
});
process.on('unhandledRejection', (error) => {
  runtimeError = cleanText(error?.message || error);
  send({ type: 'khaos-nexus-ai-runtime.fatal', nonce: runtimeNonce, error: runtimeError, code: error?.code || 'AI_RUNTIME_UNHANDLED_REJECTION' });
});

send({ type: 'khaos-nexus-ai-runtime.host-online', runtime: RUNTIME });

module.exports = {
  requestJson,
  launchLogEvents,
  veyraListening,
  stateFor,
  publicStatus,
  startAgent,
  stopAgent,
  restartAgent,
  startAll,
  stopAll,
  restartAll,
  command,
  STOP_TIMEOUT_MS,
  READY_TIMEOUT_MS
};
