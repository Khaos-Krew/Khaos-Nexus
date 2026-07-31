'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const diagnosticRuntime = require('./diagnostic-runtime-updater.cjs');

let installed = false;
let service = null;
let baselineTimer = null;
let flushTimer = null;
const attachedWebContents = new WeakSet();

function windowState() {
  const windows = electron.BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
  return {
    count: windows.length,
    visibleCount: windows.filter((window) => window.isVisible()).length,
    focusedCount: windows.filter((window) => window.isFocused()).length,
    unresponsiveCount: windows.filter((window) => window.__khaosDiagnosticUnresponsive).length
  };
}

function context(additionalChecks = []) {
  return {
    secureStorageAvailable: (() => {
      try { return electron.safeStorage.isEncryptionAvailable(); }
      catch { return false; }
    })(),
    windowState: windowState(),
    additionalChecks
  };
}

function broadcast() {
  if (!service) return;
  const state = service.publicStatus();
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('diagnostic-suite:update', state);
  }
}

function capture(type, reason, error = null, detail = {}, severity = 'error') {
  if (!service) return null;
  const report = service.captureAutomatic({ type, reason, error, detail, severity }, context());
  if (!report?.skipped) broadcast();
  return report;
}

function attachWebContents(contents) {
  if (!contents || attachedWebContents.has(contents)) return;
  attachedWebContents.add(contents);
  contents.on('render-process-gone', (_event, detail = {}) => {
    capture('renderer-process-gone', `The renderer process stopped: ${detail.reason || 'unknown reason'}.`, null, detail, 'fatal');
  });
  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame) return;
    const error = new Error(`The desktop interface failed to load (${code}): ${description || 'Unknown load error'}`);
    error.code = `LOAD_${code}`;
    capture('renderer-load-failed', error.message, error, { url }, 'error');
  });
  contents.on('unresponsive', () => capture('renderer-unresponsive', 'The desktop renderer stopped responding.', null, {}, 'error'));
}

function attachWindow(window) {
  if (!window || window.isDestroyed()) return;
  attachWebContents(window.webContents);
  window.on('unresponsive', () => {
    window.__khaosDiagnosticUnresponsive = true;
    capture('window-unresponsive', 'The Khaos Nexus desktop window stopped responding.', null, { windowId: window.id }, 'error');
  });
  window.on('responsive', () => {
    window.__khaosDiagnosticUnresponsive = false;
    service?.breadcrumb('window-responsive', { windowId: window.id });
    broadcast();
  });
}

function installIpc() {
  const ipc = electron.ipcMain;
  if (installIpc.done) return;
  installIpc.done = true;
  ipc.handle('diagnostic-suite:get-status', () => service.publicStatus());
  ipc.handle('diagnostic-suite:run', (_event, payload = {}) => {
    const report = service.createReport({
      type: 'manual-health-check',
      reason: String(payload.reason || 'Manual Khaos Nexus diagnostic check'),
      severity: 'info',
      automatic: false
    }, context());
    broadcast();
    return report;
  });
  ipc.handle('diagnostic-suite:package-latest', () => service.packageReport(service.latestReport()));
  ipc.handle('diagnostic-suite:copy-summary', () => {
    const text = service.summaryText();
    electron.clipboard.writeText(text);
    return { copied: true, text };
  });
  ipc.handle('diagnostic-suite:open-folder', async () => {
    fs.mkdirSync(service.diagnosticsDirectory, { recursive: true });
    const result = await electron.shell.openPath(service.diagnosticsDirectory);
    if (result) throw new Error(result);
    return { opened: true, path: service.diagnosticsDirectory };
  });
  ipc.handle('diagnostic-suite:set-settings', (_event, payload = {}) => {
    const settings = service.setSettings(payload);
    broadcast();
    return settings;
  });
  ipc.handle('diagnostic-suite:upload-latest', async () => {
    const result = await service.uploadReport(service.latestReport(), { force: true });
    broadcast();
    return result;
  });
}

function initialize() {
  if (service) return service;
  const runtime = diagnosticRuntime.runtimeService({
    dataDirectory: electron.app.getPath('userData'),
    desktopVersion: electron.app.getVersion()
  });
  service = new runtime.DiagnosticSuite({
    dataDirectory: electron.app.getPath('userData'),
    appVersion: electron.app.getVersion(),
    runtimeVersion: runtime.version,
    executablePath: process.execPath,
    resourcesPath: process.resourcesPath,
    isPackaged: electron.app.isPackaged
  });
  service.runtimeVersion = runtime.version;
  service.startSession({ source: 'desktop', diagnosticsRuntime: runtime.version, argv: process.argv.filter((value) => !/token|password|secret/i.test(value)).slice(0, 20) });
  installIpc();
  for (const window of electron.BrowserWindow.getAllWindows()) attachWindow(window);
  electron.app.on('browser-window-created', (_event, window) => attachWindow(window));
  electron.app.on('web-contents-created', (_event, contents) => attachWebContents(contents));

  if (service.hadUncleanPreviousSession()) {
    service.captureAutomatic({
      type: 'unexpected-previous-shutdown',
      reason: 'The previous Khaos Nexus session ended without recording a clean shutdown.',
      severity: 'warning'
    }, context());
    service.acknowledgePreviousSession('unexpected-previous-shutdown-captured');
  }

  baselineTimer = setTimeout(() => {
    const marker = path.join(service.diagnosticsDirectory, `baseline-${electron.app.getVersion()}-${runtime.version}.json`);
    if (!fs.existsSync(marker)) {
      const report = service.createReport({
        type: 'post-install-baseline',
        reason: 'Automatic installer/update baseline health check.',
        severity: 'info',
        automatic: true
      }, context());
      fs.writeFileSync(marker, JSON.stringify({ reportId: report.reportId, createdAt: report.createdAt, diagnosticsRuntime: runtime.version }, null, 2), 'utf8');
      broadcast();
    }
  }, 10000);
  baselineTimer.unref?.();

  flushTimer = setInterval(() => service.flushOutbox().then(broadcast).catch(() => {}), 30 * 60 * 1000);
  flushTimer.unref?.();
  diagnosticRuntime.scheduleBackgroundUpdate({ delayMs: 15000 });
  broadcast();
  return service;
}

function install() {
  if (installed) return;
  installed = true;
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    capture('main-uncaught-exception', `Unhandled desktop exception from ${origin || 'unknown origin'}.`, error, { origin }, 'fatal');
  });
  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    capture('main-unhandled-rejection', 'An unhandled desktop promise rejection occurred.', error, {}, 'error');
  });
  electron.app.whenReady().then(initialize).catch((error) => {
    console.error('[Khaos Nexus] Installer diagnostics failed to initialize.', error);
  });
  electron.app.on('before-quit', () => {
    try { service?.endSession('clean-exit'); } catch {}
    clearTimeout(baselineTimer);
    clearInterval(flushTimer);
  });
}

module.exports = { install, initialize, capture, context, get service() { return service; } };
