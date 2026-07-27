'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const crashDiagnostics = require('./crash-diagnostics-extension.cjs');
const rendererErrors = require('./renderer-action-error-extension.cjs');
const { appendLog, writeDiagnostic } = require('./portable-runtime.cjs');

const INSPECTION_DELAY_MS = 1200;
const STARTUP_DEADLINE_MS = 12000;
const REPORT_RETRY_MS = 500;
const MAX_REPORT_RETRIES = 20;

let installed = false;

function isMainInterfaceWindow(window) {
  try {
    const preload = String(window?.webContents?.getLastWebPreferences?.().preload || '');
    return path.basename(preload).toLowerCase() === 'preload.cjs';
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
    inspectedAt: new Date().toISOString()
  };
}

function diagnosticPath() {
  return path.join(electron.app.getPath('userData'), 'interface-watchdog-error.json');
}

function retain(record) {
  try {
    const target = diagnosticPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(record, null, 2), 'utf8');
    try {
      writeDiagnostic('interface-watchdog-error.json', record);
      appendLog('interface-watchdog.log', `[${record.time}] ${record.source}: ${record.message} ${JSON.stringify(record.snapshot || {})}`);
    } catch {}
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
  return `<!doctype html><html><head><meta charset="utf-8"><title>Khaos Nexus Recovery</title><style>
    :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08090d;color:#f4f5f7;font:15px/1.5 Segoe UI,system-ui,sans-serif;padding:32px}.card{width:min(760px,100%);border:1px solid #4b1d28;border-radius:18px;background:#11131a;padding:30px;box-shadow:0 24px 70px rgba(0,0,0,.45)}.eyebrow{color:#ff5475;text-transform:uppercase;letter-spacing:1.6px;font-size:11px;font-weight:800}h1{margin:8px 0 10px;font-size:28px}p{color:#abb1bf}.id,.path{padding:12px 14px;border:1px solid #2b303b;border-radius:10px;background:#0b0d12;font-family:Consolas,monospace;overflow-wrap:anywhere}.id{color:#ff8490}.actions{display:flex;gap:10px;margin-top:20px;flex-wrap:wrap}button{border:1px solid #ff5e6c;border-radius:9px;padding:10px 15px;background:#d92543;color:white;font-weight:750;cursor:pointer}button.secondary{border-color:#3a404d;background:#1a1d26}.note{font-size:12px;color:#7f8796;margin-top:18px}
  </style></head><body><main class="card"><div class="eyebrow">Interface recovery</div><h1>Khaos Nexus could not display the desktop interface</h1><p>${safeMessage}</p><div class="id">Error ID: ${safeId}</div><p>Diagnostic file:</p><div class="path">${safePath}</div><div class="actions"><button onclick="location.reload()">Retry interface</button><button class="secondary" onclick="window.close()">Close window</button></div><div class="note">The bot and local services may still be running in the system tray. Protected credentials are not intentionally written to this report.</div></main></body></html>`;
}

async function showRecovery(window, record) {
  try {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false;
    const html = recoveryMarkup(record);
    await window.webContents.executeJavaScript(`document.open();document.write(${JSON.stringify(html)});document.close();`);
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
    formatVersion: 1,
    id: crash?.id || `interface-${Date.now()}`,
    time: new Date().toISOString(),
    appVersion: electron.app.getVersion?.() || null,
    source,
    message,
    stack: String(error.stack || '').slice(0, 16000),
    snapshot: safeSnapshot(snapshot),
    extra: extra && typeof extra === 'object' ? extra : {}
  };
  record.filePath = retain(record);
  if (window) window.__khaosInterfaceFailureReported = record;

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
        shellOpacity: style?.opacity || ''
      };
    })()`);
  } catch (error) {
    return reportFailure(window, `${reason}:inspection-failed`, `The main interface could not be inspected: ${error.message}`, {}, { reason });
  }

  const safe = safeSnapshot(snapshot);
  if (safe.href === 'about:blank' || !safe.href) return { pending: true, snapshot: safe };
  const usable = safe.expectedDocument && safe.hasShell && safe.hasSidebar && safe.hasContent && safe.hasActiveView && safe.bodyChildCount > 0 && safe.bodyTextLength > 20 && safe.shellDisplay !== 'none' && safe.shellVisibility !== 'hidden' && safe.shellOpacity !== '0';
  if (!usable) {
    return reportFailure(window, reason, 'The main window loaded without a usable Khaos Nexus interface.', safe, { reason });
  }

  window.__khaosInterfaceVerified = true;
  return { usable: true, snapshot: safe };
}

function attach(window) {
  if (!isMainInterfaceWindow(window) || window.__khaosInterfaceWatchdogAttached) return;
  window.__khaosInterfaceWatchdogAttached = true;

  const deadline = setTimeout(() => {
    if (!window.__khaosInterfaceVerified && !window.__khaosInterfaceFailureReported) inspect(window, 'startup-deadline').catch(() => {});
  }, STARTUP_DEADLINE_MS);
  deadline.unref?.();

  window.webContents.on('did-finish-load', () => {
    const timer = setTimeout(() => inspect(window, 'did-finish-load').catch(() => {}), INSPECTION_DELAY_MS);
    timer.unref?.();
  });

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame) return;
    reportFailure(window, 'did-fail-load', `The main interface failed to load (${errorCode}: ${errorDescription}).`, { href: validatedUrl }, { errorCode, errorDescription, validatedUrl });
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    reportFailure(window, 'render-process-gone', `The main renderer process exited: ${details?.reason || 'unknown reason'}.`, { href: window.webContents.getURL?.() || '' }, { details });
  });

  window.on('closed', () => clearTimeout(deadline));
}

function install() {
  if (installed) return;
  installed = true;
  electron.app.on('browser-window-created', (_event, window) => attach(window));
  electron.app.whenReady().then(() => {
    for (const window of electron.BrowserWindow.getAllWindows()) attach(window);
  }).catch((error) => crashDiagnostics.writeCrashReport(error, 'interface-watchdog-initialization'));
}

module.exports = {
  INSPECTION_DELAY_MS,
  STARTUP_DEADLINE_MS,
  isMainInterfaceWindow,
  safeSnapshot,
  inspect,
  reportFailure,
  install
};
