'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const electron = require('electron');
const { safeParentEnvironment } = require('./ai-runtime-environment.cjs');
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
const CORE_READY_TIMEOUT_MS = 15000;
const COMMAND_TIMEOUT_MS = 20000;
const refs = { autonomy: null, discordAuth: null, configStore: null, logger: null };
const pendingCommands = new Map();
let installed = false;
let host = null;
let hostStopPromise = null;
let hostExitPromise = null;
let resolveHostExit = null;
let hostStatus = runtimeStatus([], { status: 'stopped' });
let coreServiceToken = '';
let runtimeNonce = '';

function nowIso() { return new Date().toISOString(); }
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function runtimeRoot() {
  return electron.app.isPackaged
    ? path.join(process.resourcesPath, 'ai-services')
    : path.join(__dirname, '..', '.runtime', 'ai-services');
}
function dataRoot() { return path.join(electron.app.getPath('userData'), 'ai-services'); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function secret() { return crypto.randomBytes(48).toString('base64url'); }
function closeDescriptor(descriptor) {
  if (!Number.isInteger(descriptor)) return;
  try { fs.closeSync(descriptor); } catch {}
}
function safeRelative(root, value) {
  const absolute = path.resolve(root, value);
  if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('AI runtime manifest contains an unsafe path.');
  return absolute;
}
function currentRole() {
  try { return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'locked'; }
  catch { return 'locked'; }
}
function assertOwner(action) {
  if (refs.autonomy?.assertAccess) return refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), 'owner', action);
  if (!['owner', 'local-admin'].includes(currentRole())) {
    const error = new Error(`${action} requires Khaos Nexus Owner access. Desktop access control is not ready.`);
    error.code = 'ACCESS_DENIED';
    throw error;
  }
  return true;
}
function audit(action, service, outcome, detail = '') {
  const metadata = {
    service: cleanText(service, 40),
    outcome: cleanText(outcome, 40),
    detail: cleanText(detail, 500)
  };
  try { refs.configStore?.appendAiServiceAudit?.(`runtime.${action}`, metadata); } catch {}
  try {
    const level = outcome === 'failed' ? 'warn' : 'info';
    refs.logger?.write?.(level, `AI runtime ${action}: ${service} (${outcome}).`, metadata, 'ai-runtimes');
  } catch {}
}

function verifyBundle(service) {
  const root = path.join(runtimeRoot(), service.id);
  const manifestPath = path.join(root, 'bundle-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    const error = new Error(`${service.label} bundle is not installed.`);
    error.code = 'AI_RUNTIME_BUNDLE_MISSING';
    throw error;
  }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch (cause) {
    const error = new Error(`${service.label} bundle manifest cannot be read.`);
    error.code = 'AI_RUNTIME_BUNDLE_INVALID';
    error.cause = cause;
    throw error;
  }
  if (manifest.id !== service.id || manifest.runtime?.electronRunAsNode !== true) {
    const error = new Error(`${service.label} bundle manifest is invalid.`);
    error.code = 'AI_RUNTIME_BUNDLE_INVALID';
    throw error;
  }
  for (const item of manifest.files || []) {
    const file = safeRelative(root, item.path);
    if (!fs.existsSync(file) || fs.statSync(file).size !== item.size || sha256(file) !== item.sha256) {
      const error = new Error(`${service.label} bundle integrity check failed for ${item.path}.`);
      error.code = 'AI_RUNTIME_BUNDLE_CORRUPT';
      throw error;
    }
  }
  const entry = safeRelative(root, manifest.entry);
  if (!fs.existsSync(entry)) {
    const error = new Error(`${service.label} entry point is missing.`);
    error.code = 'AI_RUNTIME_BUNDLE_CORRUPT';
    throw error;
  }
  return { root, entry, manifest };
}

function inspectBundle(service) {
  const root = path.join(runtimeRoot(), service.id);
  const manifestPath = path.join(root, 'bundle-manifest.json');
  if (!fs.existsSync(manifestPath)) return { key: service.key || service.id, id: service.id, label: service.label, status: 'missing', error: `${service.label} bundle is not installed.` };
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.id !== service.id || manifest.runtime?.electronRunAsNode !== true) return { key: service.key || service.id, id: service.id, label: service.label, status: 'invalid', error: `${service.label} bundle manifest is invalid.` };
    const entry = safeRelative(root, manifest.entry);
    if (!fs.existsSync(entry)) return { key: service.key || service.id, id: service.id, label: service.label, status: 'corrupt', error: `${service.label} entry point is missing.` };
    return {
      key: service.key || service.id,
      id: service.id,
      label: service.label,
      status: 'ready',
      version: cleanText(manifest.version, 80),
      commit: cleanText(manifest.commit, 120),
      fileCount: Array.isArray(manifest.files) ? manifest.files.length : 0,
      integrity: 'verified-on-start',
      error: ''
    };
  } catch (error) {
    return { key: service.key || service.id, id: service.id, label: service.label, status: 'invalid', error: cleanText(error?.message || error, 500) };
  }
}

function bundleStates() {
  return Object.fromEntries(Object.entries(AGENTS).map(([key, service]) => [key, inspectBundle({ ...service, key })]));
}

function emit() {
  const payload = status();
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('ai:runtimes-changed', payload);
  }
}
function serviceStates() {
  const values = Array.isArray(hostStatus?.agents) ? hostStatus.agents : [];
  return Object.keys(AGENTS).map((key) => {
    const value = values.find((item) => item?.key === key) || {};
    return agentState(key, value);
  });
}
function status() {
  const agents = serviceStates();
  const runtime = runtimeStatus(agents, {
    status: hostStatus?.status || (host ? 'starting' : 'stopped'),
    pid: host?.pid || hostStatus?.pid,
    startedAt: hostStatus?.startedAt,
    stoppedAt: hostStatus?.stoppedAt,
    exitCode: hostStatus?.exitCode,
    error: hostStatus?.error
  });
  return {
    nodeRequired: false,
    runtime: RUNTIME.id,
    runtimeLabel: RUNTIME.label,
    host: runtime,
    agents,
    services: agents,
    bundles: bundleStates()
  };
}
function rejectPending(error) {
  for (const value of pendingCommands.values()) {
    clearTimeout(value.timer);
    value.reject(error);
  }
  pendingCommands.clear();
}
function updateHostStatus(payload) {
  if (!payload || payload.id !== RUNTIME.id) return;
  hostStatus = runtimeStatus(payload.agents || [], {
    status: payload.status,
    pid: payload.pid,
    startedAt: payload.startedAt,
    stoppedAt: payload.stoppedAt,
    exitCode: payload.exitCode,
    error: payload.error
  });
  emit();
}
function hostAlive(child = host) {
  return Boolean(child && child === host && child.exitCode === null && child.signalCode === null);
}
function hostEnvironment() {
  return {
    ...safeParentEnvironment(process.env),
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    KHAOS_NEXUS_BUNDLED_SERVICE: '1'
  };
}
function hostConfiguration(startAgents) {
  const requested = [...new Set(startAgents.map((key) => agentKey(key)))];
  const bundles = {};
  for (const [key, service] of Object.entries(AGENTS)) {
    try { bundles[key] = verifyBundle(service); }
    catch (error) {
      if (requested.includes(key)) throw error;
      audit('bundle.skipped', key, 'failed', error.message);
    }
  }
  coreServiceToken = bundles.core ? secret() : '';
  runtimeNonce = secret();
  const agentConfig = {};
  if (bundles.dnd) {
    const dndData = path.join(dataRoot(), AGENTS.dnd.id);
    fs.mkdirSync(dndData, { recursive: true });
    agentConfig.dnd = {
      root: bundles.dnd.root,
      entry: bundles.dnd.entry,
      dataDir: dndData,
      version: bundles.dnd.manifest.version,
      commit: bundles.dnd.manifest.commit
    };
  }
  if (bundles.core) {
    const coreData = path.join(dataRoot(), AGENTS.core.id);
    fs.mkdirSync(coreData, { recursive: true });
    const startupNonce = secret();
    agentConfig.core = {
      root: bundles.core.root,
      entry: bundles.core.entry,
      dataDir: coreData,
      version: bundles.core.manifest.version,
      commit: bundles.core.manifest.commit,
      serviceToken: coreServiceToken,
      startupNonce,
      readyFile: path.join(coreData, `ready-${process.pid}-${Date.now()}.json`),
      monitorStateFile: path.join(coreData, 'monitor-state.json')
    };
  }
  return {
    nonce: runtimeNonce,
    launcher: path.join(__dirname, 'ai-runtime-agent-launcher.cjs'),
    startAgents: requested,
    agents: agentConfig
  };
}
function finalizeHostExit(child, code, signal, stopRequested) {
  if (host !== child) return;
  host = null;
  coreServiceToken = '';
  runtimeNonce = '';
  const previousAgents = serviceStates().map((item) => ({
    ...item,
    status: stopRequested || code === 0 ? 'stopped' : 'failed',
    stoppedAt: nowIso(),
    exitCode: Number.isInteger(code) ? code : null,
    error: stopRequested || code === 0 ? '' : item.error || `${RUNTIME.label} exited unexpectedly${Number.isInteger(code) ? ` with code ${code}` : ''}${signal ? ` (${signal})` : ''}.`
  }));
  hostStatus = runtimeStatus(previousAgents, {
    status: stopRequested || code === 0 ? 'stopped' : 'failed',
    stoppedAt: nowIso(),
    exitCode: Number.isInteger(code) ? code : null,
    error: stopRequested || code === 0 ? '' : `${RUNTIME.label} exited unexpectedly.`
  });
  const error = new Error(hostStatus.error || `${RUNTIME.label} stopped.`);
  error.code = 'AI_RUNTIME_HOST_EXITED';
  rejectPending(error);
  resolveHostExit?.();
  resolveHostExit = null;
  emit();
}
function startHost(startAgents = Object.keys(AGENTS)) {
  if (host) return status();
  let config;
  try { config = hostConfiguration(startAgents.map((key) => agentKey(key))); }
  catch (error) {
    hostStatus = runtimeStatus([], { status: 'failed', stoppedAt: nowIso(), error: error?.message || error });
    emit();
    throw error;
  }
  const hostEntry = path.join(__dirname, 'ai-runtime-host.cjs');
  const hostData = path.join(dataRoot(), 'runtime-host');
  fs.mkdirSync(hostData, { recursive: true });
  const logPath = path.join(hostData, 'service.log');
  let descriptor = null;
  let child;
  try {
    descriptor = fs.openSync(logPath, 'a');
    child = spawn(process.execPath, [hostEntry], {
      cwd: electron.app.isPackaged ? process.resourcesPath : __dirname,
      env: hostEnvironment(),
      windowsHide: true,
      stdio: ['ignore', descriptor, descriptor, 'ipc']
    });
  } catch (error) {
    hostStatus = runtimeStatus([], { status: 'failed', stoppedAt: nowIso(), error: error?.message || error });
    emit();
    throw error;
  } finally {
    closeDescriptor(descriptor);
  }
  host = child;
  let stopRequested = false;
  hostExitPromise = new Promise((resolve) => { resolveHostExit = resolve; });
  hostStatus = runtimeStatus([], { status: 'starting', pid: child.pid, startedAt: nowIso() });
  child.once('spawn', () => {
    if (!hostAlive(child)) return;
    child.send({ type: 'khaos-nexus-ai-runtime.initialize', payload: config });
    emit();
  });
  child.on('message', (message) => {
    if (child !== host) return;
    if (message?.nonce && message.nonce !== runtimeNonce) return;
    if (message?.type === 'khaos-nexus-ai-runtime.status') return updateHostStatus(message.payload);
    if (message?.type === 'khaos-nexus-ai-runtime.fatal') {
      hostStatus = runtimeStatus(serviceStates(), { status: 'failed', pid: child.pid, error: message.error || 'AI runtime host failed.' });
      emit();
      return;
    }
    if (message?.type === 'khaos-nexus-ai-runtime.response') {
      const pending = pendingCommands.get(message.requestId);
      if (!pending) return;
      pendingCommands.delete(message.requestId);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.result);
      else {
        const error = new Error(message.error || 'AI runtime command failed.');
        error.code = message.code || 'AI_RUNTIME_COMMAND_FAILED';
        pending.reject(error);
      }
    }
  });
  child.once('error', (error) => {
    if (child !== host) return;
    hostStatus = runtimeStatus(serviceStates(), { status: 'failed', pid: child.pid, error: error?.message || error });
    emit();
  });
  child.once('close', (code, signal) => finalizeHostExit(child, code, signal, stopRequested));
  child.__khaosRequestStop = () => { stopRequested = true; };
  emit();
  return status();
}
function sendCommand(actionInput, serviceInput, options = {}) {
  const action = actionKey(actionInput);
  const service = agentKey(serviceInput, true);
  if (!hostAlive()) {
    if (action === 'start') {
      startHost(service === 'all' ? Object.keys(AGENTS).filter((key) => inspectBundle({ ...AGENTS[key], key }).status === 'ready') : [service]);
      return Promise.resolve(service === 'all' ? serviceStates() : serviceStates().find((item) => item.key === service));
    }
    return Promise.resolve(service === 'all' ? serviceStates() : serviceStates().find((item) => item.key === service));
  }
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCommands.delete(requestId);
      const error = new Error(`${RUNTIME.label} did not answer the ${action} command.`);
      error.code = 'AI_RUNTIME_COMMAND_TIMEOUT';
      reject(error);
    }, COMMAND_TIMEOUT_MS);
    timer.unref?.();
    pendingCommands.set(requestId, { resolve, reject, timer });
    try {
      host.send({ type: 'khaos-nexus-ai-runtime.command', nonce: runtimeNonce, requestId, action, service, options });
    } catch (error) {
      clearTimeout(timer);
      pendingCommands.delete(requestId);
      reject(error);
    }
  });
}
async function stopHost(options = {}) {
  const child = host;
  if (!child) return serviceStates();
  if (!hostAlive(child)) {
    await (hostExitPromise || Promise.resolve());
    return serviceStates();
  }
  if (hostStopPromise) return hostStopPromise;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Math.max(100, Number(options.timeoutMs)) : STOP_TIMEOUT_MS;
  hostStopPromise = (async () => {
    child.__khaosRequestStop?.();
    hostStatus = runtimeStatus(serviceStates(), { status: 'stopping', pid: child.pid, startedAt: hostStatus.startedAt });
    emit();
    try { child.send({ type: 'khaos-nexus-ai-runtime.shutdown', nonce: runtimeNonce }); }
    catch { try { child.kill(); } catch {} }
    const graceful = await Promise.race([hostExitPromise.then(() => true), delay(timeoutMs).then(() => false)]);
    if (!graceful && hostAlive(child)) {
      try { child.kill('SIGKILL'); } catch {}
      await Promise.race([hostExitPromise, delay(FORCE_EXIT_TIMEOUT_MS)]);
    }
    if (hostAlive(child)) {
      const error = new Error(`${RUNTIME.label} did not stop after forced termination.`);
      error.code = 'AI_RUNTIME_STOP_TIMEOUT';
      throw error;
    }
    return serviceStates();
  })().finally(() => { hostStopPromise = null; });
  return hostStopPromise;
}

function start(inputKey) {
  const key = agentKey(inputKey);
  if (!hostAlive()) {
    startHost([key]);
    return serviceStates().find((item) => item.key === key);
  }
  return sendCommand('start', key);
}
async function stop(inputKey, options = {}) {
  const key = agentKey(inputKey);
  if (!hostAlive()) return serviceStates().find((item) => item.key === key);
  return sendCommand('stop', key, options);
}
async function restart(inputKey) {
  const key = agentKey(inputKey);
  if (!hostAlive()) {
    startHost([key]);
    return serviceStates().find((item) => item.key === key);
  }
  return sendCommand('restart', key);
}
function availableAgentKeys() {
  return Object.keys(AGENTS).filter((key) => inspectBundle({ ...AGENTS[key], key }).status === 'ready');
}
function startAll() {
  if (!hostAlive()) {
    const available = availableAgentKeys();
    if (!available.length) {
      const error = new Error('No verified AI runtime bundles are available. Reinstall or update Khaos Nexus to repair packaged AI resources.');
      error.code = 'AI_RUNTIME_BUNDLES_UNAVAILABLE';
      throw error;
    }
    startHost(available);
    return serviceStates();
  }
  return sendCommand('start', 'all');
}
async function stopAll(options = {}) { return stopHost(options); }
async function restartAll() {
  if (!hostAlive()) {
    const available = availableAgentKeys();
    if (!available.length) {
      const error = new Error('No verified AI runtime bundles are available. Reinstall or update Khaos Nexus to repair packaged AI resources.');
      error.code = 'AI_RUNTIME_BUNDLES_UNAVAILABLE';
      throw error;
    }
    startHost(available);
    return serviceStates();
  }
  return sendCommand('restart', 'all');
}
function coreConnection() {
  const value = serviceStates().find((item) => item.key === 'core');
  if (!value || value.status !== 'ready' || !value.endpoint || !coreServiceToken) throw new Error('Nexus Sentinel is not ready.');
  return { endpoint: value.endpoint, serviceToken: coreServiceToken, readiness: value.contract };
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosBundledAiRuntimeCapture) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
    }
  }
  Object.defineProperty(Captured, '__khaosBundledAiRuntimeCapture', { value: true });
  target[exportName] = Captured;
}
async function manualAction(actionInput, input = {}) {
  const action = actionKey(actionInput);
  const key = agentKey(input.service, true);
  assertOwner(`${action[0].toUpperCase()}${action.slice(1)} ${RUNTIME.label}`);
  audit(`${action}.requested`, key, 'requested');
  try {
    const result = key === 'all'
      ? action === 'start' ? await startAll() : action === 'stop' ? await stopAll() : await restartAll()
      : action === 'start' ? await start(key) : action === 'stop' ? await stop(key) : await restart(key);
    const states = key === 'all' ? result : [result];
    const failed = states.filter((item) => item?.status === 'failed');
    audit(`${action}.completed`, key, failed.length ? 'partial' : 'success', failed.map((item) => `${item.key}: ${item.error}`).join('; '));
    return result;
  } catch (error) {
    audit(`${action}.completed`, key, 'failed', error?.message || error);
    throw error;
  }
}
function registerIpc() {
  electron.ipcMain.handle('ai:runtimes-status', () => {
    assertOwner('View AI runtime status');
    return status();
  });
  electron.ipcMain.handle('ai:runtimes-start', (_event, input = {}) => manualAction('start', input));
  electron.ipcMain.handle('ai:runtimes-stop', (_event, input = {}) => manualAction('stop', input));
  electron.ipcMain.handle('ai:runtimes-restart', (_event, input = {}) => manualAction('restart', input));
}
function install() {
  if (installed) return;
  installed = true;
  captureClass('./services/config-store.cjs', 'ConfigStore', 'configStore');
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  electron.app.whenReady().then(() => {
    registerIpc();
  });
  electron.app.on('before-quit', () => { void stopAll({ timeoutMs: 1500 }); });
}

module.exports = {
  install,
  verifyBundle,
  inspectBundle,
  bundleStates,
  status,
  start,
  stop,
  restart,
  startAll,
  stopAll,
  restartAll,
  runtimeRoot,
  coreConnection,
  validateCoreReadiness,
  serviceKey: agentKey,
  agentKey,
  actionKey,
  startHost,
  stopHost,
  STOP_TIMEOUT_MS,
  CORE_READY_TIMEOUT_MS
};
