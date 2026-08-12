'use strict';

let installed = false;

const DEFAULT_MINIMUM = Object.freeze({ width: 720, height: 520 });
const DEFAULT_PREFERRED = Object.freeze({ width: 1360, height: 900 });

function integer(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function normalizeWorkArea(workArea = {}) {
  return {
    x: integer(workArea.x, 0),
    y: integer(workArea.y, 0),
    width: Math.max(320, integer(workArea.width, DEFAULT_PREFERRED.width)),
    height: Math.max(240, integer(workArea.height, DEFAULT_PREFERRED.height))
  };
}

function minimumSizeForWorkArea(workArea, requested = DEFAULT_MINIMUM) {
  const area = normalizeWorkArea(workArea);
  return {
    width: Math.max(320, Math.min(integer(requested.width, DEFAULT_MINIMUM.width), area.width)),
    height: Math.max(240, Math.min(integer(requested.height, DEFAULT_MINIMUM.height), area.height))
  };
}

function responsiveBoundsForDisplay(bounds = {}, workArea = {}, preferred = DEFAULT_PREFERRED) {
  const area = normalizeWorkArea(workArea);
  const minimum = minimumSizeForWorkArea(area);
  const currentWidth = Math.max(minimum.width, integer(bounds.width, preferred.width));
  const currentHeight = Math.max(minimum.height, integer(bounds.height, preferred.height));
  const width = Math.min(currentWidth, area.width);
  const height = Math.min(currentHeight, area.height);
  const currentX = integer(bounds.x, area.x + Math.floor((area.width - width) / 2));
  const currentY = integer(bounds.y, area.y + Math.floor((area.height - height) / 2));
  const maxX = area.x + area.width - width;
  const maxY = area.y + area.height - height;
  return {
    x: Math.min(Math.max(currentX, area.x), maxX),
    y: Math.min(Math.max(currentY, area.y), maxY),
    width,
    height,
    minimum
  };
}

function installResponsiveStyles(window) {
  const webContentsId = window.webContents.id;
  window.webContents.once('did-finish-load', () => {
    if (window.isDestroyed() || window.webContents.isDestroyed() || window.webContents.id !== webContentsId) return;
    setTimeout(() => {
      if (window.isDestroyed() || window.webContents.isDestroyed()) return;
      window.webContents.executeJavaScript(`(() => {
        const id = 'khaos-responsive-shell-styles';
        let link = document.getElementById(id);
        if (!link) {
          link = document.createElement('link');
          link.id = id;
          link.rel = 'stylesheet';
          link.href = 'responsive-shell.css';
          document.head.appendChild(link);
        } else if (document.head.lastElementChild !== link) {
          document.head.appendChild(link);
        }
        if (!window.__khaosResponsiveStyleObserver) {
          let scheduled = false;
          const keepLast = () => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
              scheduled = false;
              const current = document.getElementById(id);
              if (current && document.head.lastElementChild !== current) document.head.appendChild(current);
            });
          };
          const observer = new MutationObserver((records) => {
            if (records.some((record) => [...record.addedNodes].some((node) => node !== link && node.nodeType === 1 && ['LINK', 'STYLE'].includes(node.tagName)))) keepLast();
          });
          observer.observe(document.head, { childList: true });
          window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
          window.__khaosResponsiveStyleObserver = observer;
        }
        document.documentElement.dataset.nexusResponsiveShell = 'ready';
      })();`).catch((error) => console.error('[Khaos Nexus] Responsive shell injection failed.', error));
    }, 0);
  });
}

function fitWindowToCurrentDisplay(window, electron) {
  if (!window || window.isDestroyed() || !electron?.screen) return null;
  const bounds = window.getBounds();
  const display = electron.screen.getDisplayMatching(bounds);
  const next = responsiveBoundsForDisplay(bounds, display.workArea, DEFAULT_PREFERRED);
  window.setMinimumSize(next.minimum.width, next.minimum.height);
  if (bounds.width !== next.width || bounds.height !== next.height || bounds.x !== next.x || bounds.y !== next.y) {
    window.setBounds({ x: next.x, y: next.y, width: next.width, height: next.height }, false);
  }
  return next;
}

function attachWindow(window, electron) {
  if (!window || window.isDestroyed() || window.__khaosResponsiveLayoutAttached) return;
  Object.defineProperty(window, '__khaosResponsiveLayoutAttached', { value: true });
  fitWindowToCurrentDisplay(window, electron);
  installResponsiveStyles(window);

  let timer = null;
  const reconcile = () => {
    clearTimeout(timer);
    timer = setTimeout(() => fitWindowToCurrentDisplay(window, electron), 120);
  };
  window.on('move', reconcile);
  window.on('restore', reconcile);
}

function install() {
  if (installed) return;
  installed = true;
  const electron = require('electron');
  electron.app.on('browser-window-created', (_event, window) => attachWindow(window, electron));
  electron.app.whenReady().then(() => {
    for (const window of electron.BrowserWindow.getAllWindows()) attachWindow(window, electron);
    const reconcileAll = () => {
      for (const window of electron.BrowserWindow.getAllWindows()) fitWindowToCurrentDisplay(window, electron);
    };
    electron.screen.on('display-metrics-changed', reconcileAll);
    electron.screen.on('display-removed', reconcileAll);
  });
}

module.exports = {
  DEFAULT_MINIMUM,
  DEFAULT_PREFERRED,
  normalizeWorkArea,
  minimumSizeForWorkArea,
  responsiveBoundsForDisplay,
  fitWindowToCurrentDisplay,
  install
};
