'use strict';

const electron = require('electron');

const FEATURE_START_DELAY_MS = 750;
const FEATURE_GAP_MS = 180;
const FEATURE_LOAD_TIMEOUT_MS = 8000;
let installed = false;

function bootstrapSource() {
  return `(() => {
    if (window.__khaosBootCoordinatorInstalled) return;
    window.__khaosBootCoordinatorInstalled = true;

    const originalAppendChild = Node.prototype.appendChild;
    const queue = [];
    const knownSources = new Set();
    let running = false;
    let loaded = 0;
    let startTimer = null;

    const normalizeSource = (node) => {
      try { return new URL(node.src, document.baseURI).href; }
      catch { return String(node.src || ''); }
    };

    const isFeatureScript = (node) => {
      if (!(node instanceof HTMLScriptElement) || !node.src) return false;
      const source = normalizeSource(node);
      if (!source.startsWith('file:')) return false;
      return !/(?:\\/|^)(?:app|application-monitor|boot-loader)\\.js(?:$|[?#])/i.test(source);
    };

    const ensureIndicator = () => {
      let indicator = document.getElementById('nexusBootIndicator');
      if (indicator) return indicator;
      indicator = document.createElement('div');
      indicator.id = 'nexusBootIndicator';
      indicator.setAttribute('role', 'status');
      indicator.style.cssText = [
        'position:fixed', 'right:18px', 'bottom:18px', 'z-index:2147483646',
        'display:flex', 'align-items:center', 'gap:10px', 'max-width:340px',
        'padding:10px 14px', 'border:1px solid rgba(227,38,79,.45)',
        'border-radius:12px', 'background:rgba(8,10,14,.94)', 'color:#f3f5f8',
        'font:12px/1.4 Segoe UI,Arial,sans-serif', 'box-shadow:0 14px 34px rgba(0,0,0,.4)'
      ].join(';');
      indicator.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#e3264f;box-shadow:0 0 12px rgba(227,38,79,.8)"></span><span id="nexusBootIndicatorText">Preparing desktop modules…</span>';
      originalAppendChild.call(document.body || document.documentElement, indicator);
      return indicator;
    };

    const updateIndicator = (text) => {
      const indicator = ensureIndicator();
      const label = indicator.querySelector('#nexusBootIndicatorText');
      if (label) label.textContent = text;
    };

    const finishIndicator = () => {
      const indicator = document.getElementById('nexusBootIndicator');
      if (!indicator) return;
      updateIndicator('Desktop modules ready');
      setTimeout(() => indicator.remove(), 900);
    };

    const processNext = () => {
      if (running) return;
      const entry = queue.shift();
      if (!entry) {
        finishIndicator();
        window.dispatchEvent(new CustomEvent('khaos:features-ready', { detail: { loaded } }));
        window.khaos?.reportBootStage?.('features-ready', { loaded });
        return;
      }

      running = true;
      loaded += 1;
      const sourceName = (() => {
        try { return decodeURIComponent(new URL(entry.node.src).pathname.split('/').pop() || 'module'); }
        catch { return 'module'; }
      })();
      updateIndicator('Loading ' + sourceName + ' • ' + loaded + ' of ' + (loaded + queue.length));
      window.khaos?.reportBootStage?.('feature-loading', { source: sourceName, position: loaded, remaining: queue.length });

      const node = entry.node;
      const previousLoad = node.onload;
      const previousError = node.onerror;
      let settled = false;
      const settle = (ok, event) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try {
          if (ok && typeof previousLoad === 'function') previousLoad.call(node, event);
          if (!ok && typeof previousError === 'function') previousError.call(node, event);
        } catch (error) {
          console.error('[Khaos Nexus] Feature script callback failed.', error);
        }
        window.khaos?.reportBootStage?.(ok ? 'feature-ready' : 'feature-failed', { source: sourceName });
        running = false;
        setTimeout(processNext, ${FEATURE_GAP_MS});
      };
      const timeout = setTimeout(() => {
        console.error('[Khaos Nexus] Feature script load timed out:', sourceName);
        settle(false, new Event('timeout'));
      }, ${FEATURE_LOAD_TIMEOUT_MS});

      node.async = false;
      node.defer = false;
      node.onload = (event) => settle(true, event);
      node.onerror = (event) => settle(false, event);
      originalAppendChild.call(entry.parent, node);
    };

    Node.prototype.appendChild = function khaosSerializedAppendChild(node) {
      if (!isFeatureScript(node)) return originalAppendChild.call(this, node);
      const source = normalizeSource(node);
      if (knownSources.has(source)) return node;
      knownSources.add(source);
      queue.push({ parent: this, node });
      updateIndicator('Queued ' + queue.length + ' desktop module' + (queue.length === 1 ? '' : 's'));
      if (!startTimer) {
        startTimer = setTimeout(() => {
          startTimer = null;
          processNext();
        }, ${FEATURE_START_DELAY_MS});
      }
      return node;
    };

    window.khaos?.reportBootStage?.('coordinator-ready');
    window.addEventListener('load', () => {
      window.khaos?.reportBootStage?.('document-loaded');
      if (!startTimer && queue.length) startTimer = setTimeout(processNext, ${FEATURE_START_DELAY_MS});
    }, { once: true });
  })();`;
}

function attach(window) {
  if (!window || window.isDestroyed() || window.__khaosBootCoordinatorAttached) return;
  window.__khaosBootCoordinatorAttached = true;
  window.webContents.on('dom-ready', () => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.executeJavaScript(bootstrapSource()).catch((error) => {
      console.error('[Khaos Nexus] Could not install the renderer boot coordinator.', error);
    });
  });
}

function install() {
  if (installed) return;
  installed = true;
  electron.app.on('browser-window-created', (_event, window) => attach(window));
  electron.app.whenReady().then(() => {
    for (const window of electron.BrowserWindow.getAllWindows()) attach(window);
  }).catch((error) => console.error('[Khaos Nexus] Renderer boot coordinator initialization failed.', error));
}

module.exports = {
  FEATURE_START_DELAY_MS,
  FEATURE_GAP_MS,
  FEATURE_LOAD_TIMEOUT_MS,
  bootstrapSource,
  install,
  attach
};
