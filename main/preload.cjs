'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const { isExpectedAccessDenial } = require('../shared/renderer-action-errors.cjs');

const REPORT_EXCLUDED_CHANNELS = new Set([
  'stability:heartbeat',
  'monitor:capture-renderer',
  'renderer-errors:get',
  'renderer-errors:clear',
  'renderer-errors:copy-latest',
  'startup:get-state'
]);
const STARTUP_TIMEOUT_MS = 45 * 1000;
let lastInteraction = null;
let startupSnapshot = null;
let modulesReady = false;
let splashCompleted = false;
let splashProgress = 6;
let splashTimeout = null;

function sendRendererHeartbeat() {
  ipcRenderer.invoke('stability:heartbeat').catch(() => {});
}

sendRendererHeartbeat();
const rendererHeartbeatTimer = setInterval(sendRendererHeartbeat, 2000);
process.once('exit', () => clearInterval(rendererHeartbeatTimer));

function subscribe(channel, callback) {
  const listener = (_event, state) => callback(state);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

function cleanText(value, max = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function elementContext(element) {
  const target = element?.closest?.('button, [role="button"], a, input, select, textarea') || element;
  if (!target || typeof target !== 'object') return {};
  return {
    elementId: cleanText(target.id, 120),
    elementText: cleanText(target.getAttribute?.('aria-label') || target.title || target.textContent || target.value, 160),
    elementTag: cleanText(target.tagName, 40).toLowerCase(),
    operation: cleanText(
      target.dataset?.hostedSignal || target.dataset?.view || target.dataset?.viewLink || target.dataset?.commandView ||
      target.getAttribute?.('name') || target.id || target.textContent,
      140
    )
  };
}

function currentView() {
  return cleanText(document.querySelector?.('.view.active')?.id || 'unknown-view', 100).replace(/^view-/, '');
}

function reportRendererActionError(input = {}) {
  if (isExpectedAccessDenial(input.error || input.message || input.reason || input)) return { ignored: true, reason: 'expected-access-denial' };
  const error = input.error instanceof Error ? input.error : null;
  const interaction = input.interaction || lastInteraction || elementContext(document.activeElement);
  ipcRenderer.send('renderer-action:error', {
    source: input.source || 'manual',
    channel: cleanText(input.channel || '', 140),
    view: cleanText(input.view || currentView(), 100),
    operation: cleanText(input.operation || interaction?.operation || '', 140),
    elementId: cleanText(input.elementId || interaction?.elementId || '', 120),
    elementText: cleanText(input.elementText || interaction?.elementText || '', 160),
    elementTag: cleanText(input.elementTag || interaction?.elementTag || '', 40),
    message: cleanText(input.message || error?.message || String(input.reason || 'Unknown renderer error'), 1600),
    stack: String(input.stack || error?.stack || '').slice(0, 12000),
    time: new Date().toISOString()
  });
  return { reported: true };
}

async function invoke(channel, payload) {
  try {
    return await ipcRenderer.invoke(channel, payload);
  } catch (error) {
    if (!REPORT_EXCLUDED_CHANNELS.has(channel) && !isExpectedAccessDenial(error)) {
      reportRendererActionError({ source: 'ipc', channel, error, interaction: lastInteraction });
    }
    throw error;
  }
}

function splashElement(id) {
  return document.getElementById(id);
}

function ensureSplashStyles() {
  if (document.querySelector('link[data-khaos-startup-splash]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'startup-splash.css';
  link.dataset.khaosStartupSplash = 'true';
  (document.head || document.documentElement).appendChild(link);
}

function splashMarkup() {
  return `
    <main class="khaos-splash-shell">
      <div class="khaos-splash-logo-wrap"><img class="khaos-splash-logo" src="../assets/icon.png" alt="Khaos Nexus logo"></div>
      <h1 class="khaos-splash-title">Khaos Nexus</h1>
      <p class="khaos-splash-subtitle">Desktop Control Center</p>
      <div id="khaosSplashStatus" class="khaos-splash-status">Restoring local configuration…</div>
      <div class="khaos-splash-track"><div id="khaosSplashProgress" class="khaos-splash-progress"></div></div>
      <div class="khaos-splash-meta"><span id="khaosSplashStep">Startup lock active</span><span id="khaosSplashPercent">6%</span></div>
      <section id="khaosSplashError" class="khaos-splash-error">
        <strong>Startup is taking longer than expected.</strong>
        <span>The interface remains locked to prevent incomplete actions. Retry the interface or open in limited mode.</span>
        <div class="khaos-splash-actions">
          <button id="khaosSplashRetry" class="khaos-splash-button" type="button">Retry Interface</button>
          <button id="khaosSplashContinue" class="khaos-splash-button" type="button">Open Limited Mode</button>
        </div>
      </section>
    </main>`;
}

function installSplashDom() {
  ensureSplashStyles();
  document.documentElement?.classList.add('khaos-starting');
  if (!document.body) return false;
  document.body.classList.add('khaos-starting');
  let splash = splashElement('khaosStartupSplash');
  if (!splash) {
    splash = document.createElement('section');
    splash.id = 'khaosStartupSplash';
    splash.setAttribute('role', 'status');
    splash.setAttribute('aria-live', 'polite');
    splash.innerHTML = splashMarkup();
    document.body.prepend(splash);
    splashElement('khaosSplashRetry')?.addEventListener('click', () => location.reload());
    splashElement('khaosSplashContinue')?.addEventListener('click', () => unlockSplash(true));
  }
  if (!splashTimeout) {
    splashTimeout = setTimeout(() => {
      if (splashCompleted) return;
      updateSplash('Startup needs attention', Math.max(splashProgress, 88), 'Waiting for configuration or remaining modules');
      splashElement('khaosSplashError')?.classList.add('is-visible');
    }, STARTUP_TIMEOUT_MS);
  }
  renderStartupState();
  return true;
}

function scheduleSplashInstall() {
  ensureSplashStyles();
  document.documentElement?.classList.add('khaos-starting');
  if (installSplashDom()) return;
  const observer = new MutationObserver(() => {
    ensureSplashStyles();
    if (installSplashDom()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function updateSplash(message, value, detail = '') {
  if (splashCompleted) return;
  installSplashDom();
  splashProgress = Math.max(splashProgress, Math.min(100, Number(value) || splashProgress));
  const status = splashElement('khaosSplashStatus');
  const progress = splashElement('khaosSplashProgress');
  const percent = splashElement('khaosSplashPercent');
  const step = splashElement('khaosSplashStep');
  if (status) status.textContent = message;
  if (progress) progress.style.width = `${splashProgress}%`;
  if (percent) percent.textContent = `${Math.round(splashProgress)}%`;
  if (detail && step) step.textContent = detail;
}

function startupReady() {
  return Boolean(startupSnapshot?.configLoaded && startupSnapshot?.authRestoreComplete);
}

function maybeUnlockSplash() {
  if (modulesReady && startupReady()) unlockSplash(false);
}

function unlockSplash(limited = false) {
  if (splashCompleted) return;
  splashCompleted = true;
  if (splashTimeout) clearTimeout(splashTimeout);
  splashTimeout = null;
  updateSplash(limited ? 'Opened in limited mode' : 'Khaos Nexus is ready', 100, limited ? 'Some services may still be restoring' : 'Configuration and modules loaded');
  const splash = splashElement('khaosStartupSplash');
  setTimeout(() => {
    splash?.classList.add('is-closing');
    document.documentElement?.classList.remove('khaos-starting');
    document.body?.classList.remove('khaos-starting');
    setTimeout(() => splash?.remove(), 460);
  }, limited ? 120 : 320);
}

function renderStartupState() {
  if (splashCompleted || !startupSnapshot) return;
  const migration = startupSnapshot.migration || {};
  if (!startupSnapshot.configLoaded) {
    updateSplash('Restoring local configuration…', 12, 'Locating previous Khaos Nexus data');
    return;
  }
  if (!startupSnapshot.authRestoreComplete) {
    updateSplash(
      migration.migrated ? 'Previous configuration restored. Restoring Discord access…' : 'Restoring saved configuration and Discord access…',
      22,
      migration.migrated ? 'Migrated previous local data' : 'Reading protected local credentials'
    );
    return;
  }
  if (!modulesReady) {
    const status = startupSnapshot.authRestoreStatus || 'signed-out';
    updateSplash('Loading desktop modules…', Math.max(splashProgress, 30), `Configuration ready • Discord ${status}`);
  }
  maybeUnlockSplash();
}

function handleBootStage(stage, detail = {}) {
  if (splashCompleted) return;
  if (stage === 'features-ready') {
    modulesReady = true;
    updateSplash('Desktop modules ready', Math.max(splashProgress, 92), 'Finishing configuration restoration');
    maybeUnlockSplash();
    return;
  }
  if (stage === 'coordinator-ready') updateSplash('Preparing startup coordinator…', 28, 'Startup coordinator ready');
  if (stage === 'document-loaded') updateSplash('Loading command center…', 32, 'Base interface loaded');
  if (stage === 'feature-loading') {
    const position = Number(detail.position) || 0;
    const remaining = Number(detail.remaining) || 0;
    const total = Math.max(1, position + remaining);
    const value = 34 + (position / total) * 55;
    updateSplash(detail.source ? `Loading ${detail.source}…` : 'Loading desktop modules…', value, `${position} of ${total} modules`);
  }
  if (stage === 'feature-ready' && detail.source) updateSplash(`${detail.source} ready`, Math.max(splashProgress, 72), 'Initializing remaining services');
  if (stage === 'feature-failed') updateSplash('A module reported a startup warning…', Math.max(splashProgress, 82), detail.source || 'Module warning retained');
}

window.addEventListener('click', (event) => {
  lastInteraction = elementContext(event.target);
}, true);

scheduleSplashInstall();
subscribe('startup:state', (snapshot) => {
  startupSnapshot = snapshot;
  renderStartupState();
});
ipcRenderer.invoke('startup:get-state').then((snapshot) => {
  startupSnapshot = snapshot;
  renderStartupState();
}).catch((error) => {
  updateSplash('Could not read startup state', Math.max(splashProgress, 40), cleanText(error.message, 120));
});

contextBridge.exposeInMainWorld('__khaosStartupSplashInstalled', true);
contextBridge.exposeInMainWorld('khaos', {
  invoke,
  reportRendererActionError: (payload) => reportRendererActionError(payload || {}),
  isExpectedAccessDenial: (value) => isExpectedAccessDenial(value),
  reportBootStage: (stage, detail = {}) => {
    const normalizedStage = String(stage || 'unknown').slice(0, 80);
    const normalizedDetail = detail && typeof detail === 'object' ? detail : {};
    handleBootStage(normalizedStage, normalizedDetail);
    try {
      window.dispatchEvent(new CustomEvent('khaos:boot-stage', { detail: { stage: normalizedStage, detail: normalizedDetail } }));
    } catch {}
    ipcRenderer.send('renderer-boot:stage', {
      stage: normalizedStage,
      detail: normalizedDetail,
      time: new Date().toISOString()
    });
  },
  onState: (callback) => subscribe('state:update', callback),
  onStartupState: (callback) => subscribe('startup:state', callback),
  onLog: (callback) => subscribe('log:entry', callback),
  onUpdate: (callback) => subscribe('update:state', callback),
  onDiscordAutomation: (callback) => subscribe('discord-automation:update', callback),
  onDiscordObservability: (callback) => subscribe('discord-observability:state', callback),
  onStatusPanels: (callback) => subscribe('status-panels:update', callback),
  onServerScheduler: (callback) => subscribe('server-scheduler:update', callback),
  onPlayerConsole: (callback) => subscribe('player-console:update', callback),
  onHostedServer: (callback) => subscribe('hosted-server:update', callback),
  onRendererErrors: (callback) => subscribe('renderer-errors:update', callback)
});
