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
    endpoint: 'http://127.0.0.1:8790',
    env: { HOST: '127.0.0.1', PORT: '8790', AI_PROVIDER: 'deterministic-local' }
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
    endpoint: service.endpoint,
    status: value.status || 'stopped',
    pid: value.child?.pid || null,
    startedAt: value.startedAt || null,
    stoppedAt: value.stoppedAt || null,
    exitCode: value.exitCode ?? null,
    error: value.error || '',
    version: value.manifest?.version || '',
    commit: value.manifest?.commit || ''
  };
}

function emit() {
  const payload = status();
  for (const window of electron.BrowserWindow.getAllWindows()) window.webContents.send('ai:runtimes-changed', payload);
}
function status() { return { nodeRequired: false, runtime: 'electron-embedded-node', services: Object.keys(services).map(stateFor) }; }

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
  const env = {
    ...process.env,
    ...service.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'development',
    DATA_DIR: serviceData,
    KHAOS_NEXUS_BUNDLED_SERVICE: '1'
  };
  const child = spawn(process.execPath, [bundle.entry], {
    cwd: bundle.root,
    env,
    windowsHide: true,
    stdio: ['ignore', log, log]
  });
  const value = { child, manifest: bundle.manifest, status: 'starting', startedAt: nowIso(), error: '', exitCode: null, logPath };
  runtime.set(key, value);
  child.once('spawn', () => { value.status = 'running'; emit(); });
  child.once('error', (error) => { value.status = 'failed'; value.error = String(error.message || error).slice(0, 800); emit(); });
  child.once('exit', (code) => { value.status = code === 0 ? 'stopped' : 'failed'; value.exitCode = code; value.stoppedAt = nowIso(); value.child = null; emit(); });
  emit();
  return stateFor(key);
}

function stop(key) {
  const value = runtime.get(key);
  if (!value?.child) return stateFor(key);
  value.status = 'stopping';
  value.child.kill();
  setTimeout(() => { if (value.child && !value.child.killed) value.child.kill('SIGKILL'); }, 5000).unref?.();
  emit();
  return stateFor(key);
}
function restart(key) { stop(key); return new Promise((resolve) => setTimeout(() => resolve(start(key)), 300)); }
function startAll() { return Object.keys(services).map(start); }
function stopAll() { return Object.keys(services).map(stop); }

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

module.exports = { install, verifyBundle, status, start, stop, restart, runtimeRoot };
