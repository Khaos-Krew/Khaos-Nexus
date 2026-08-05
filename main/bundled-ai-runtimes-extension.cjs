'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const electron = require('electron');

const STOP_TIMEOUT_MS = 5000;
const FORCE_EXIT_TIMEOUT_MS = 2000;
const CORE_READY_TIMEOUT_MS = 15000;
const services = {
  dnd: {
    id: 'dnd-ai',
    label: 'D&D AI',
    endpoint: 'http://127.0.0.1:8787',
    env: { HOST: '127.0.0.1', PORT: '8787', AI_PROVIDER: 'mock', CAMPAIGN_STORE: 'json', AUTH_REQUIRED: 'false' }
  },
  core: {
    id: 'ai-core',
    label: 'Nexus AI Core',
    endpoint: '',
    env: { HOST: '127.0.0.1', PORT: '0', AI_PROVIDER: 'deterministic-local' }
  }
};

const runtime = new Map();
const refs = { autonomy: null, discordAuth: null, configStore: null, logger: null };
let installed = false;

function nowIso() { return new Date().toISOString(); }
function runtimeRoot() {
  return electron.app.isPackaged
    ? path.join(process.resourcesPath, 'ai-services')
    : path.join(__dirname, '..', '.runtime', 'ai-services');
}
function dataRoot() { return path.join(electron.app.getPath('userData'), 'ai-services'); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function safeRelative(root, value) {
  const absolute = path.resolve(root, value);
  if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('AI runtime manifest contains an unsafe path.');
  return absolute;
}
function secret() { return crypto.randomBytes(48).toString('base64url'); }
function cleanText(value, max = 800) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }
function closeDescriptor(descriptor) {
  if (!Number.isInteger(descriptor)) return;
  try { fs.closeSync(descriptor); } catch {}
}
function clearTimer(value, key) {
  if (!value?.[key]) return;
  clearTimeout(value[key]);
  value[key] = null;
}
function serviceKey(value, allowAll = false) {
  const key = String(value || '').trim().toLowerCase();
  if (allowAll && key === 'all') return key;
  if (!Object.hasOwn(services, key)) {
    const error = new Error('Unknown AI runtime.');
    error.code = 'AI_RUNTIME_UNKNOWN';
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
function currentRole() {
  try { return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'locked'; }
  catch { return 'locked'; }
}
function assertOwner(action) {
  if (refs.autonomy?.assertAccess) {
    return refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), 'owner', action);
  }
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
  if (!fs.existsSync(manifestPath)) throw new Error(`${service.label} bundle is not installed.`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.id !== service.id || manifest.runtime?.electronRunAsNode !== true) throw new Error(`${service.label} bundle manifest is invalid.`);
  for (const item of manifest.files || []) {
    const file = safeRelative(root, item.path);
    if (!fs.existsSync(file) || fs.statSync(file).size !== item.size || sha256(file) !== item.sha256) {
      throw new Error(`${service.label} bundle integrity check failed for ${item.path}.`);
    }
  }
  const entry = safeRelative(root, manifest.entry);
  if (!fs.existsSync(entry)) throw new Error(`${service.label} entry point is missing.`);
  return { root, entry, manifest };
}

function childAlive(value, child = value?.child) {
  return Boolean(child && value?.child === child && child.exitCode === null && child.signalCode === null);
}

function stateFor(key) {
  const service = services[key];
  const value = runtime.get(key) || {};
  return {
    key,
    id: service.id,
    label: service.label,
    endpoint: value.endpoint || service.endpoint,
    status: value.status || 'stopped',
    pid: value.child?.pid || null,
    startedAt: value.startedAt || null,
    stoppedAt: value.stoppedAt || null,
    exitCode: value.exitCode ?? null,
    error: value.error || '',
    version: value.manifest?.version || '',
    commit: value.manifest?.commit || '',
    authenticated: key === 'core' ? Boolean(value.serviceToken) : false,
    contract: value.readiness ? {
      apiVersion: value.readiness.apiVersion,
      serviceContractVersion: value.readiness.serviceContractVersion,
      sidecarContractVersion: value.readiness.sidecarContractVersion,
      targetService: value.readiness.targetService,
      monitorAvailable: value.readiness.monitor?.available === true,
      schedulerOwnedExternally: value.readiness.monitor?.schedulerOwnedExternally === true
    } : null
  };
}

function emit() {
  const payload = status();
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('ai:runtimes-changed', payload);
  }
}
function status() { return { nodeRequired: false, runtime: 'electron-embedded-node', services: Object.keys(services).map(stateFor) }; }

function validateCoreReadiness(readiness, nonce) {
  if (!readiness || readiness.event !== 'nexus-ai-core.ready') throw new Error('AI Core readiness event is invalid.');
  if (readiness.startupNonce !== nonce) throw new Error('AI Core readiness nonce did not match.');
  if (readiness.service !== 'khaos-nexus-ai-core' || readiness.serviceVersion !== '0.7.0') throw new Error('AI Core service version is incompatible.');
  if (readiness.apiVersion !== 'v1' || readiness.serviceContractVersion !== '1.0.0' || readiness.sidecarContractVersion !== '1.0.0') throw new Error('AI Core contract is incompatible.');
  if (readiness.targetService !== 'khaos-nexus') throw new Error('AI Core target service is incompatible.');
  if (readiness.host !== '127.0.0.1' || !Number.isInteger(readiness.port) || readiness.port < 1) throw new Error('AI Core endpoint is not loopback-safe.');
  if (readiness.boundaries?.directExecution !== false || readiness.boundaries?.directDiscordConnection !== false || readiness.boundaries?.directServiceForwarding !== false || readiness.boundaries?.directDndCallsAllowed !== false) throw new Error('AI Core authority boundary is unsafe.');
  if (readiness.monitor?.schedulerOwnedExternally !== true || readiness.monitor?.githubWebhooksEnabled !== false) throw new Error('AI Core scheduler boundary is incompatible.');
  return `http://127.0.0.1:${readiness.port}`;
}

function recordFailure(key, error) {
  const service = services[key];
  const value = runtime.get(key) || {};
  value.status = 'failed';
  value.error = cleanText(error?.message || error || `${service.label} failed to start.`);
  value.stoppedAt = nowIso();
  runtime.set(key, value);
  emit();
  return stateFor(key);
}

function finalizeExit(key, value, child, code, signal) {
  clearTimer(value, 'readyTimer');
  clearTimer(value, 'forceTimer');
  if (value.child !== child) return;
  value.exitCode = code;
  value.exitSignal = signal || null;
  value.stoppedAt = nowIso();
  value.child = null;
  value.endpoint = services[key].endpoint;
  value.serviceToken = '';
  value.startupNonce = '';
  value.readiness = null;
  if (value.readyFile) {
    try { fs.rmSync(value.readyFile, { force: true }); } catch {}
  }
  if (value.stopRequested || code === 0) {
    value.status = 'stopped';
    if (value.stopRequested) value.error = '';
  } else {
    value.status = 'failed';
    if (!value.error) value.error = cleanText(`${services[key].label} exited unexpectedly${code === null ? '' : ` with code ${code}`}${signal ? ` (${signal})` : ''}.`);
  }
  value.resolveExit?.();
  value.resolveExit = null;
  emit();
}

function start(inputKey) {
  const key = serviceKey(inputKey);
  const service = services[key];
  const current = runtime.get(key);
  if (current?.child) return stateFor(key);

  let bundle;
  try {
    bundle = verifyBundle(service);
  } catch (error) {
    recordFailure(key, error);
    throw error;
  }

  const serviceData = path.join(dataRoot(), service.id);
  fs.mkdirSync(serviceData, { recursive: true });
  const logPath = path.join(serviceData, 'service.log');
  const value = {
    child: null,
    manifest: bundle.manifest,
    status: 'starting',
    startedAt: nowIso(),
    stoppedAt: null,
    stopRequested: false,
    error: '',
    exitCode: null,
    logPath,
    endpoint: service.endpoint,
    readyTimer: null,
    forceTimer: null,
    stopPromise: null,
    exitPromise: null,
    resolveExit: null
  };
  const env = { ...process.env, ...service.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'development', DATA_DIR: serviceData, KHAOS_NEXUS_BUNDLED_SERVICE: '1' };
  if (key === 'core') {
    value.serviceToken = secret();
    value.startupNonce = secret();
    value.readyFile = path.join(serviceData, `ready-${process.pid}-${Date.now()}.json`);
    value.monitorStateFile = path.join(serviceData, 'monitor-state.json');
    env.NEXUS_AI_CORE_SERVICE_TOKEN = value.serviceToken;
    env.NEXUS_AI_CORE_STARTUP_NONCE = value.startupNonce;
    env.NEXUS_AI_CORE_READY_FILE = value.readyFile;
    env.MONITOR_STATE_FILE = value.monitorStateFile;
    env.NEXUS_AI_CORE_PARENT_PID = String(process.pid);
  }

  let descriptor = null;
  let child;
  try {
    descriptor = fs.openSync(logPath, 'a');
    child = spawn(process.execPath, [bundle.entry], {
      cwd: bundle.root,
      env,
      windowsHide: true,
      stdio: key === 'core' ? ['ignore', descriptor, descriptor, 'ipc'] : ['ignore', descriptor, descriptor]
    });
  } catch (error) {
    recordFailure(key, error);
    throw error;
  } finally {
    closeDescriptor(descriptor);
  }

  value.child = child;
  value.exitPromise = new Promise((resolve) => { value.resolveExit = resolve; });
  runtime.set(key, value);

  child.once('spawn', () => {
    if (value.child !== child) return;
    if (key !== 'core') value.status = 'running';
    emit();
  });

  if (key === 'core') {
    value.readyTimer = setTimeout(() => {
      if (!childAlive(value, child) || value.status !== 'starting') return;
      value.status = 'failed';
      value.error = 'Nexus AI Core did not report readiness before the startup timeout.';
      audit('startup-timeout', key, 'failed', value.error);
      try { child.kill(); } catch {}
      emit();
    }, CORE_READY_TIMEOUT_MS);
    value.readyTimer.unref?.();

    child.on('message', (message) => {
      if (!childAlive(value, child) || value.status !== 'starting') return;
      try {
        value.endpoint = validateCoreReadiness(message, value.startupNonce);
        value.readiness = message;
        value.status = 'ready';
        clearTimer(value, 'readyTimer');
        emit();
      } catch (error) {
        value.status = 'failed';
        value.error = cleanText(error.message || error);
        clearTimer(value, 'readyTimer');
        try { child.kill(); } catch {}
        emit();
      }
    });
  }

  child.once('error', (error) => {
    if (value.child !== child) return;
    value.status = 'failed';
    value.error = cleanText(error.message || error);
    clearTimer(value, 'readyTimer');
    emit();
  });
  child.once('exit', (code, signal) => finalizeExit(key, value, child, code, signal));
  emit();
  return stateFor(key);
}

function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

async function stop(inputKey, options = {}) {
  const key = serviceKey(inputKey);
  const value = runtime.get(key);
  const child = value?.child;
  if (!child || !childAlive(value, child)) return stateFor(key);
  if (value.stopPromise) return value.stopPromise;

  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Math.max(100, Number(options.timeoutMs)) : STOP_TIMEOUT_MS;
  value.stopPromise = (async () => {
    value.stopRequested = true;
    value.status = 'stopping';
    clearTimer(value, 'readyTimer');
    emit();

    try {
      if (key === 'core' && child.connected) child.send({ type: 'nexus-ai-core.shutdown' });
      else child.kill();
    } catch (error) {
      value.error = cleanText(error.message || error);
    }

    const graceful = await Promise.race([
      value.exitPromise.then(() => true),
      delay(timeoutMs).then(() => false)
    ]);

    if (!graceful && childAlive(value, child)) {
      try { child.kill('SIGKILL'); } catch (error) { value.error = cleanText(error.message || error); }
      await Promise.race([
        value.exitPromise,
        delay(FORCE_EXIT_TIMEOUT_MS)
      ]);
    }

    if (childAlive(value, child)) {
      value.status = 'failed';
      value.error = `${services[key].label} did not stop after forced termination.`;
      emit();
      const error = new Error(value.error);
      error.code = 'AI_RUNTIME_STOP_TIMEOUT';
      throw error;
    }
    return stateFor(key);
  })().finally(() => {
    if (runtime.get(key) === value) value.stopPromise = null;
  });

  return value.stopPromise;
}

async function restart(inputKey) {
  const key = serviceKey(inputKey);
  await stop(key);
  const value = runtime.get(key);
  if (value?.child) {
    const error = new Error(`${services[key].label} is still stopping.`);
    error.code = 'AI_RUNTIME_STILL_STOPPING';
    throw error;
  }
  return start(key);
}

function startAll() {
  return Object.keys(services).map((key) => {
    try { return start(key); }
    catch (error) { return recordFailure(key, error); }
  });
}
async function stopAll(options = {}) {
  return Promise.all(Object.keys(services).map(async (key) => {
    try { return await stop(key, options); }
    catch (error) { return recordFailure(key, error); }
  }));
}
async function restartAll() {
  return Promise.all(Object.keys(services).map(async (key) => {
    try { return await restart(key); }
    catch (error) { return recordFailure(key, error); }
  }));
}

function coreConnection() {
  const value = runtime.get('core');
  if (!value || value.status !== 'ready' || !value.endpoint || !value.serviceToken) throw new Error('Nexus AI Core is not ready.');
  return { endpoint: value.endpoint, serviceToken: value.serviceToken, readiness: value.readiness };
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
  const key = serviceKey(input.service, true);
  assertOwner(`${action[0].toUpperCase()}${action.slice(1)} AI services`);
  audit(`${action}.requested`, key, 'requested');
  try {
    const result = key === 'all'
      ? action === 'start' ? startAll() : action === 'stop' ? await stopAll() : await restartAll()
      : action === 'start' ? start(key) : action === 'stop' ? await stop(key) : await restart(key);
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
    startAll();
  });
  electron.app.on('before-quit', () => { void stopAll({ timeoutMs: 1500 }); });
}

module.exports = {
  install,
  verifyBundle,
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
  serviceKey,
  actionKey,
  STOP_TIMEOUT_MS,
  CORE_READY_TIMEOUT_MS
};
