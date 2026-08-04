'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const electron = require('electron');

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
  for (const window of electron.BrowserWindow.getAllWindows()) window.webContents.send('ai:runtimes-changed', payload);
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

function start(key) {
  const service = services[key];
  if (!service) throw new Error('Unknown AI runtime.');
  const current = runtime.get(key);
  if (current?.child && !current.child.killed) return stateFor(key);
  const bundle = verifyBundle(service);
  const serviceData = path.join(dataRoot(), service.id);
  fs.mkdirSync(serviceData, { recursive: true });
  const logPath = path.join(serviceData, 'service.log');
  const log = fs.openSync(logPath, 'a');
  const value = { child: null, manifest: bundle.manifest, status: 'starting', startedAt: nowIso(), error: '', exitCode: null, logPath, endpoint: service.endpoint };
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
  const child = spawn(process.execPath, [bundle.entry], {
    cwd: bundle.root,
    env,
    windowsHide: true,
    stdio: key === 'core' ? ['ignore', log, log, 'ipc'] : ['ignore', log, log]
  });
  value.child = child;
  runtime.set(key, value);
  child.once('spawn', () => { if (key !== 'core') value.status = 'running'; emit(); });
  if (key === 'core') child.on('message', (message) => {
    try {
      value.endpoint = validateCoreReadiness(message, value.startupNonce);
      value.readiness = message;
      value.status = 'ready';
      emit();
    } catch (error) {
      value.status = 'failed';
      value.error = String(error.message || error).slice(0, 800);
      child.kill();
      emit();
    }
  });
  child.once('error', (error) => { value.status = 'failed'; value.error = String(error.message || error).slice(0, 800); emit(); });
  child.once('exit', (code) => {
    value.status = code === 0 ? 'stopped' : 'failed';
    value.exitCode = code;
    value.stoppedAt = nowIso();
    value.child = null;
    value.serviceToken = '';
    value.startupNonce = '';
    value.readiness = null;
    if (value.readyFile) fs.rmSync(value.readyFile, { force: true });
    emit();
  });
  emit();
  return stateFor(key);
}

function stop(key) {
  const value = runtime.get(key);
  if (!value?.child) return stateFor(key);
  value.status = 'stopping';
  if (key === 'core' && value.child.connected) value.child.send({ type: 'nexus-ai-core.shutdown' });
  else value.child.kill();
  setTimeout(() => { if (value.child && !value.child.killed) value.child.kill('SIGKILL'); }, 5000).unref?.();
  emit();
  return stateFor(key);
}
function restart(key) { stop(key); return new Promise((resolve) => setTimeout(() => resolve(start(key)), 500)); }
function startAll() { return Object.keys(services).map(start); }
function stopAll() { return Object.keys(services).map(stop); }
function coreConnection() {
  const value = runtime.get('core');
  if (!value || value.status !== 'ready' || !value.endpoint || !value.serviceToken) throw new Error('Nexus AI Core is not ready.');
  return { endpoint: value.endpoint, serviceToken: value.serviceToken, readiness: value.readiness };
}

function install() {
  if (installed) return;
  installed = true;
  electron.app.whenReady().then(() => {
    electron.ipcMain.handle('ai:runtimes-status', () => status());
    electron.ipcMain.handle('ai:runtimes-start', (_event, input = {}) => input.service === 'all' ? startAll() : start(input.service));
    electron.ipcMain.handle('ai:runtimes-stop', (_event, input = {}) => input.service === 'all' ? stopAll() : stop(input.service));
    electron.ipcMain.handle('ai:runtimes-restart', async (_event, input = {}) => input.service === 'all' ? Promise.all(Object.keys(services).map(restart)) : restart(input.service));
    try { startAll(); } catch (error) {
      for (const key of Object.keys(services)) runtime.set(key, { status: 'failed', error: String(error.message || error).slice(0, 800) });
      emit();
    }
  });
  electron.app.on('before-quit', stopAll);
}

module.exports = { install, verifyBundle, status, start, stop, restart, runtimeRoot, coreConnection, validateCoreReadiness };
