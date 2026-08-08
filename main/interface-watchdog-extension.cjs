'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const startupHealth = require('./startup-health-extension.cjs');
const crashDiagnostics = require('./crash-diagnostics-extension.cjs');
const rendererErrors = require('./renderer-action-error-extension.cjs');
const { appendLog, writeDiagnostic } = require('./portable-runtime.cjs');

const DISCOVERY_INTERVAL_MS = 1000;
const INSPECTION_INTERVAL_MS = 1000;
const INTERFACE_STABILITY_MS = 3000;
const FAILURE_STABILITY_MS = 1500;
const STARTUP_DEADLINE_MS = 45000;
const REPORT_RETRY_MS = 500;
const MAX_REPORT_RETRIES = 20;

let installed = false;
let discoveryTimer = null;
let inspectionTimer = null;
let currentWindow = null;
let attachedAt = 0;
let stableSince = 0;
let failureSince = 0;
let lastStateFingerprint = '';
let inspectionInFlight = false;

const state = {
  format: 'khaos-nexus-interface-watchdog-state',
  formatVersion: 2,
  installed: false,
  installedAt: null,
  attached: false,
  attachedAt: null,
  windowId: null,
  stage: 'not-installed',
  stable: false,
  stableSince: null,
  inspectionCount: 0,
  lastInspectionAt: null,
  lastReason: null,
  lastSnapshot: null,
  lastVisual: null,
  failureReported: false,
  failureId: null,
  appVersion: null
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function dataPath(name) {
  return path.join(electron.app.getPath('userData'), name);
}

function appLogPath() {
  return dataPath(path.join('logs', 'interface-watchdog.log'));
}

function statePath() {
  return dataPath('interface-watchdog-state.json');
}

function diagnosticPath() {
  return dataPath('interface-watchdog-error.json');
}

function appendAppLog(line) {
  try {
    const target = appLogPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `${line.endsWith('\n') ? line : `${line}\n`}`, 'utf8');
  } catch (error) {
    console.error('[Khaos Nexus] Interface watchdog could not append its AppData log.', error);
  }
  try { appendLog('interface-watchdog.log', line); } catch {}
}

function writeState(stage, detail = {}, forceLog = false) {
  state.stage = stage;
  state.lastInspectionAt = new Date().toISOString();
  state.appVersion = electron.app.getVersion?.() || null;
  const payload = { ...clone(state), detail: detail && typeof detail === 'object' ? detail : {} };
  try {
    const target = statePath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), 'utf8');
    try { fs.renameSync(temporary, target); }
    catch {
      fs.rmSync(target, { force: true });
      fs.renameSync(temporary, target);
    }
    try { writeDiagnostic('interface-watchdog-state.json', payload); } catch {}
  } catch (error) {
    console.error('[Khaos Nexus] Interface watchdog could not retain state.', error);
  }

  const fingerprint = JSON.stringify([stage, state.stable, state.attached, state.windowId, detail]);
  if (forceLog || fingerprint !== lastStateFingerprint) {
    lastStateFingerprint = fingerprint;
    appendAppLog(`[${new Date().toISOString()}] ${stage} ${JSON.stringify(detail)}`);
  }
  return payload;
}

function publicState() {
  return clone(state);
}

function preloadName(window) {
  try {
    const preload = String(window?.webContents?.getLastWebPreferences?.().preload || '');
    return path.basename(preload).toLowerCase();
  } catch {
    return '';
  }
}

function normalizedUrl(window) {
  try { return String(window?.webContents?.getURL?.() || '').replace(/\\/g, '/'); }
  catch { return ''; }
}

function isMainInterfaceWindow(window) {
  try {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false;
    if (window.__khaosStartupSplashWindow || window === startupHealth.refs.splashWindow) return false;
    if (preloadName(window) === 'startup-health-preload.cjs') return false;
    if (window === startupHealth.refs.mainWindow) return true;
    if (preloadName(window) === 'preload.cjs') return true;
    return /\/renderer\/index\.html(?:[?#]|$)/i.test(normalizedUrl(window));
  } catch {
    return false;
  }
}

function safeSnapshot(snapshot = {}) {
  return {
    href: String(snapshot.href || '').slice(0, 1200),
    title: String(snapshot.title || '').slice(0, 300),
    readyState: String(snapshot.readyState || ''),
    expectedDocument: Boolean(snapshot.expectedDocument),
    hasShell: Boolean(snapshot.hasShell),
    hasSidebar: Boolean(snapshot.hasSidebar),
    hasContent: Boolean(snapshot.hasContent),
    hasActiveView: Boolean(snapshot.hasActiveView),
    activeViewId: String(snapshot.activeViewId || '').slice(0, 120),
    bodyChildCount: Number(snapshot.bodyChildCount || 0),
    bodyTextLength: Number(snapshot.bodyTextLength || 0),
    shellDisplay: String(snapshot.shellDisplay || '').slice(0, 80),
    shellVisibility: String(snapshot.shellVisibility || '').slice(0, 80),
    shellOpacity: String(snapshot.shellOpacity || '').slice(0, 80),
    shellWidth: Number(snapshot.shellWidth || 0),
    shellHeight: Number(snapshot.shellHeight || 0),
    contentWidth: Number(snapshot.contentWidth || 0),
    contentHeight: Number(snapshot.contentHeight || 0),
    viewportWidth: Number(snapshot.viewportWidth || 0),
    viewportHeight: Number(snapshot.viewportHeight || 0),
    inspectedAt: new Date().toISOString()
  };
}

function retain(record) {
  try {
    const target = diagnosticPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(record, null, 2), 'utf8');
    try { writeDiagnostic('interface-watchdog-error.json', record); } catch {}
    appendAppLog(`[${record.time}] ${record.source}: ${record.message} ${JSON.stringify(record.snapshot || {})}`);
    return target;
  } catch (error) {
    console.error('[Khaos Nexus] Interface watchdog could not retain diagnostics.', error);
    return null;
  }
}

function queueAutomaticReport(payload, attempt = 0) {
  try {
    const result = rendererErrors.record(payload);
    if (result) return result;
  } catch (error) {
    console.error('[Khaos Nexus] Interface watchdog could not queue the renderer error.', error);
  }
  if (attempt >= MAX_REPORT_RETRIES) return null;
  const timer = setTimeout(() => queueAutomaticReport(payload, attempt + 1), REPORT_RETRY_MS);
  timer.unref?.();
  return null;
}

function recoveryMarkup(record) {
  const safeId = String(record.id || 'unknown').replace(/[&<>"']/g, '');
  const safePath = String(record.filePath || 'Diagnostics were retained in the Khaos Nexus data folder.').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeMessage = String(record.message || 'The desktop interface did not load correctly.').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const retryUrl = String(record.snapshot?.href || '').startsWith('file:') ? String(record.snapshot.href) : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Khaos Nexus Recovery</title><style>
    :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08090d;color:#f4f5f7;font:15px/1.5 Segoe UI,system-ui,sans-serif;padding:32px}.card{width:min(760px,100%);border:1px solid #4b1d28;border-radius:18px;background:#11131a;padding:30px;box-shadow:0 24px 70px rgba(0,0,0,.45)}.eyebrow{color:#ff5475;text-transform:uppercase;letter-spacing:1.6px;font-size:11px;font-weight:800}h1{margin:8px 0 10px;font-size:28px}p{color:#abb1bf}.id,.path{padding:12px 14px;border:1px solid #2b303b;border-radius:10px;background:#0b0d12;font-family:Consolas,monospace;overflow-wrap:anywhere}.id{color:#ff8490}.actions{display:flex;gap:10px;margin-top:20px;flex-wrap:wrap}button{border:1px solid #ff5e6c;border-radius:9px;padding:10px 15px;background:#d92543;color:white;font-weight:750;cursor:pointer}button.secondary{border-color:#3a404d;background:#1a1d26}.note{font-size:12px;color:#7f8796;margin-top:18px}
  </style></head><body><main class="card"><div class="eyebrow">Interface recovery</div><h1>Khaos Nexus could not display the desktop interface</h1><p>${safeMessage}</p><div class="id">Error ID: ${safeId}</div><p>Diagnostic file:</p><div class="path">${safePath}</div><div class="actions"><button onclick="${retryUrl ? `location.href=${JSON.stringify(retryUrl)}` : 'location.reload()'}">Retry interface</button><button class="secondary" onclick="window.close()">Close window</button></div><div class="note">The bot and local services may still be running in the system tray. Protected credentials are not intentionally written to this report.</div></main></body></html>`;
}

async function showRecovery(window, record) {
  try {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false;
    const html = recoveryMarkup(record);
    try {
      await window.webContents.executeJavaScript(`document.open();document.write(${JSON.stringify(html)});document.close();`);
    } catch {
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    }
    window.show();
    window.focus();
    return true;
  } catch (error) {
    console.error('[Khaos Nexus] Interface watchdog could not display recovery UI.', error);
    return false;
  }
}

function reportFailure(window, source, message, snapshot = {}, extra = {}) {
  if (window?.__khaosInterfaceFailureReported) return window.__khaosInterfaceFailureReported;
  const error = new Error(message);
  const crash = crashDiagnostics.writeCrashReport(error, source);
  const record = {
    format: 'khaos-nexus-interface-watchdog',
    formatVersion: 2,
    id: crash?.id || `interface-${Date.now()}`,
    time: new Date().toISOString(),
    appVersion: electron.app.getVersion?.() || null,
    source,
    message,
    stack: String(error.stack || '').slice(0, 16000),
    snapshot: safeSnapshot(snapshot),
    watchdog: publicState(),
    extra: extra && typeof extra === 'object' ? extra : {}
  };
  record.filePath = retain(record);
  if (window) window.__khaosInterfaceFailureReported = record;
  state.failureReported = true;
  state.failureId = record.id;
  state.stable = false;
  state.stableSince = null;
  writeState('failure-reported', { id: record.id, source, message }, true);

  queueAutomaticReport({
    source: 'main-interface-watchdog',
    channel: source,
    view: record.snapshot.activeViewId || 'startup',
    operation: 'verify-main-interface',
    message: `${message} Error ID: ${record.id}`,
    stack: record.stack,
    time: record.time
  });

  console.error('[Khaos Nexus] Main interface watchdog detected a failure.', record);
  showRecovery(window, record).catch(() => {});
  return record;
}

async function captureVisual(window) {
  try {
    if (!window.isVisible()) return { checked: false, reason: 'window-hidden' };
    const image = await window.webContents.capturePage();
    const bitmap = image.toBitmap();
    const size = image.getSize();
    const pixelCount = Math.floor(bitmap.length / 4);
    if (!pixelCount || !size.width || !size.height) return { checked: false, reason: 'empty-capture' };
    const step = Math.max(1, Math.floor(pixelCount / 12000));
    let sampled = 0;
    let nonDark = 0;
    let minLuma = 255;
    let maxLuma = 0;
    let lumaSum = 0;
    for (let pixel = 0; pixel < pixelCount; pixel += step) {
      const offset = pixel * 4;
      const blue = bitmap[offset] || 0;
      const green = bitmap[offset + 1] || 0;
      const red = bitmap[offset + 2] || 0;
      const luma = Math.round((red * 0.2126) + (green * 0.7152) + (blue * 0.0722));
      minLuma = Math.min(minLuma, luma);
      maxLuma = Math.max(maxLuma, luma);
      lumaSum += luma;
      if (luma > 45) nonDark += 1;
      sampled += 1;
    }
    const nonDarkRatio = sampled ? nonDark / sampled : 0;
    const averageLuma = sampled ? lumaSum / sampled : 0;
    return {
      checked: true,
      width: size.width,
      height: size.height,
      sampled,
      nonDark,
      nonDarkRatio,
      averageLuma,
      minLuma,
      maxLuma,
      visuallyBlank: sampled > 500 && nonDarkRatio < 0.001 && maxLuma - minLuma < 24 && averageLuma < 28
    };
  } catch (error) {
    return { checked: false, reason: 'capture-failed', message: error.message || String(error) };
  }
}

async function inspect(window, reason = 'inspection') {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return null;
  let snapshot;
  try {
    snapshot = await window.webContents.executeJavaScript(`(() => {
      const href = String(location.href || '');
      const shell = document.querySelector('.app-shell');
      const sidebar = document.querySelector('.sidebar');
      const content = document.querySelector('.content');
      const activeView = document.querySelector('.view.active');
      const style = shell ? getComputedStyle(shell) : null;
      const shellRect = shell?.getBoundingClientRect?.() || { width: 0, height: 0 };
      const contentRect = content?.getBoundingClientRect?.() || { width: 0, height: 0 };
      return {
        href,
        title: document.title || '',
        readyState: document.readyState,
        expectedDocument: href.startsWith('file:') && /\\/renderer\\/index\\.html(?:[?#]|$)/i.test(href.replace(/\\\\/g, '/')),
        hasShell: Boolean(shell),
        hasSidebar: Boolean(sidebar),
        hasContent: Boolean(content),
        hasActiveView: Boolean(activeView),
        activeViewId: activeView?.id || '',
        bodyChildCount: Number(document.body?.children?.length || 0),
        bodyTextLength: String(document.body?.innerText || '').trim().length,
        shellDisplay: style?.display || '',
        shellVisibility: style?.visibility || '',
        shellOpacity: style?.opacity || '',
        shellWidth: Number(shellRect.width || 0),
        shellHeight: Number(shellRect.height || 0),
        contentWidth: Number(contentRect.width || 0),
        contentHeight: Number(contentRect.height || 0),
        viewportWidth: Number(innerWidth || 0),
        viewportHeight: Number(innerHeight || 0)
      };
    })()`);
  } catch (error) {
    const elapsed = attachedAt ? Date.now() - attachedAt : 0;
    if (elapsed >= STARTUP_DEADLINE_MS || state.stable) {
      return reportFailure(window, `${reason}:inspection-failed`, `The main interface could not be inspected: ${error.message}`, {}, { reason, elapsed });
    }
    writeState('inspection-pending', { reason, message: error.message || String(error), elapsed });
    return { pending: true };
  }

  const safe = safeSnapshot(snapshot);
  state.inspectionCount += 1;
  state.lastReason = reason;
  state.lastSnapshot = safe;
  const elapsed = attachedAt ? Date.now() - attachedAt : 0;

  if (safe.href === 'about:blank' || !safe.href) {
    stableSince = 0;
    state.stable = false;
    state.stableSince = null;
    writeState('waiting-for-real-document', { reason, elapsed, href: safe.href });
    if (elapsed >= STARTUP_DEADLINE_MS) {
      return reportFailure(window, 'startup-document-timeout', 'The main window remained on an empty document instead of loading Khaos Nexus.', safe, { reason, elapsed });
    }
    return { pending: true, snapshot: safe };
  }

  const domUsable = safe.expectedDocument && safe.hasShell && safe.hasSidebar && safe.hasContent && safe.hasActiveView && safe.bodyChildCount > 0 && safe.bodyTextLength > 20 && safe.shellDisplay !== 'none' && safe.shellVisibility !== 'hidden' && safe.shellOpacity !== '0' && safe.shellWidth > 100 && safe.shellHeight > 100 && safe.contentWidth > 100 && safe.contentHeight > 100;
  const visual = domUsable ? await captureVisual(window) : { checked: false, reason: 'dom-unusable' };
  state.lastVisual = visual;
  const usable = domUsable && !visual.visuallyBlank;

  if (!usable) {
    stableSince = 0;
    state.stable = false;
    state.stableSince = null;
    if (!failureSince) failureSince = Date.now();
    const failedForMs = Date.now() - failureSince;
    writeState('interface-unusable', { reason, elapsed, failedForMs, domUsable, visual });
    const documentFinished = safe.readyState === 'complete';
    if ((documentFinished && failedForMs >= FAILURE_STABILITY_MS) || elapsed >= STARTUP_DEADLINE_MS || window.__khaosInterfaceVerified) {
      const message = visual.visuallyBlank
        ? 'The main window rendered as an effectively blank surface after startup.'
        : 'The main window loaded without a usable Khaos Nexus interface.';
      return reportFailure(window, reason, message, safe, { reason, elapsed, failedForMs, domUsable, visual });
    }
    return { usable: false, snapshot: safe, visual };
  }

  failureSince = 0;
  if (!stableSince) stableSince = Date.now();
  const stableForMs = Date.now() - stableSince;
  const stable = stableForMs >= INTERFACE_STABILITY_MS;
  state.stable = stable;
  state.stableSince = stableSince ? new Date(stableSince).toISOString() : null;
  window.__khaosInterfaceVerified = stable;
  writeState(stable ? 'interface-stable' : 'interface-stabilizing', { reason, elapsed, stableForMs, requiredMs: INTERFACE_STABILITY_MS, visual });
  return { usable: true, stable, stableForMs, snapshot: safe, visual };
}

function stopDiscovery() {
  if (discoveryTimer) clearInterval(discoveryTimer);
  discoveryTimer = null;
}

function stopInspection() {
  if (inspectionTimer) clearInterval(inspectionTimer);
  inspectionTimer = null;
}

function scheduleInspection(reason) {
  const window = currentWindow;
  if (!window || window.isDestroyed() || window.webContents.isDestroyed() || inspectionInFlight) return;
  inspectionInFlight = true;
  inspect(window, reason).then((result) => {
    if (result?.stable) stopInspection();
  }).catch((error) => {
    console.error('[Khaos Nexus] Interface watchdog inspection failed unexpectedly.', error);
  }).finally(() => { inspectionInFlight = false; });
}

function startInspection(reason) {
  if (!currentWindow || currentWindow.isDestroyed() || currentWindow.webContents.isDestroyed()) return;
  if (inspectionTimer) return scheduleInspection(reason);
  scheduleInspection(reason);
  inspectionTimer = setInterval(() => scheduleInspection('stabilizing'), INSPECTION_INTERVAL_MS);
  inspectionTimer.unref?.();
}

function attach(window) {
  if (!isMainInterfaceWindow(window)) return false;
  if (window === currentWindow && window.__khaosInterfaceWatchdogAttached) return true;

  stopInspection();
  stopDiscovery();
  currentWindow = window;
  attachedAt = Date.now();
  stableSince = 0;
  failureSince = 0;
  window.__khaosInterfaceWatchdogAttached = true;
  state.attached = true;
  state.attachedAt = new Date(attachedAt).toISOString();
  state.windowId = window.id || window.webContents.id || null;
  state.stable = false;
  state.stableSince = null;
  writeState('watchdog-attached', {
    preload: preloadName(window),
    url: normalizedUrl(window),
    title: window.getTitle?.() || ''
  }, true);

  window.webContents.on('dom-ready', () => startInspection('dom-ready'));
  window.webContents.on('did-finish-load', () => startInspection('did-finish-load'));
  window.webContents.on('did-navigate', () => {
    stableSince = 0;
    failureSince = 0;
    state.stable = false;
    state.stableSince = null;
    startInspection('did-navigate');
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame) return;
    reportFailure(window, 'did-fail-load', `The main interface failed to load (${errorCode}: ${errorDescription}).`, { href: validatedUrl }, { errorCode, errorDescription, validatedUrl });
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    reportFailure(window, 'render-process-gone', `The main renderer process exited: ${details?.reason || 'unknown reason'}.`, { href: window.webContents.getURL?.() || '' }, { details });
  });
  window.on('show', () => startInspection('window-show'));
  window.on('closed', () => {
    if (currentWindow === window) {
      stopInspection();
      currentWindow = null;
      state.attached = false;
      state.windowId = null;
      state.stable = false;
      state.stableSince = null;
      writeState('window-closed', {}, true);
      startDiscovery();
    }
  });

  startInspection('attached');
  return true;
}

function discover() {
  const preferred = startupHealth.refs.mainWindow;
  if (preferred && isMainInterfaceWindow(preferred) && attach(preferred)) return preferred;
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (isMainInterfaceWindow(window) && attach(window)) return window;
  }
  writeState('waiting-for-main-window', {
    windows: electron.BrowserWindow.getAllWindows().map((window) => ({
      id: window.id || null,
      title: window.getTitle?.() || '',
      preload: preloadName(window),
      url: normalizedUrl(window),
      splash: Boolean(window.__khaosStartupSplashWindow || window === startupHealth.refs.splashWindow)
    }))
  });
  return null;
}

function startDiscovery() {
  if (currentWindow && !currentWindow.isDestroyed() && isMainInterfaceWindow(currentWindow)) return currentWindow;
  const found = discover();
  if (found || discoveryTimer) return found;
  discoveryTimer = setInterval(() => {
    if (discover()) stopDiscovery();
  }, DISCOVERY_INTERVAL_MS);
  discoveryTimer.unref?.();
  return null;
}

function scheduleDiscovery() {
  for (const delay of [0, 50, 250, 1000]) {
    const timer = setTimeout(() => startDiscovery(), delay);
    timer.unref?.();
  }
}

function install() {
  if (installed) return;
  installed = true;
  state.installed = true;
  state.installedAt = new Date().toISOString();

  electron.app.on('browser-window-created', () => scheduleDiscovery());
  electron.app.whenReady().then(() => {
    writeState('controller-installed', { userData: electron.app.getPath('userData') }, true);
    startDiscovery();
  }).catch((error) => {
    crashDiagnostics.writeCrashReport(error, 'interface-watchdog-initialization');
  });

  electron.app.on('before-quit', () => {
    stopDiscovery();
    stopInspection();
  });
}

module.exports = {
  DISCOVERY_INTERVAL_MS,
  INSPECTION_INTERVAL_MS,
  INTERFACE_STABILITY_MS,
  FAILURE_STABILITY_MS,
  STARTUP_DEADLINE_MS,
  isMainInterfaceWindow,
  safeSnapshot,
  publicState,
  inspect,
  reportFailure,
  install
};
