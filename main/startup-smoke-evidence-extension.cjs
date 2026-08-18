'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');

let installed = false;
let timer = null;
let captureInFlight = false;
let latestState = null;

function evidencePath() {
  const explicit = String(process.env.KHAOS_PACKAGED_STARTUP_SMOKE_FILE || '').trim();
  if (explicit) return path.resolve(explicit);
  return path.join(process.env.TEMP || electron.app.getPath('temp'), 'nexus-dnd-packaged-startup-smoke.json');
}

function mainRendererWindow() {
  return electron.BrowserWindow.getAllWindows().find((window) => {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false;
    const preload = path.basename(String(window.webContents.getLastWebPreferences?.().preload || '')).toLowerCase();
    const url = String(window.webContents.getURL?.() || '').replace(/\\/g, '/');
    return preload === 'preload.cjs' || /\/renderer\/index\.html(?:[?#]|$)/i.test(url);
  }) || null;
}

function writePayload(state) {
  if (process.env.KHAOS_PACKAGED_STARTUP_SMOKE !== '1') return null;
  const target = evidencePath();
  const temporary = `${target}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify({
    capturedAt: new Date().toISOString(),
    processId: process.pid,
    state
  }, null, 2), 'utf8');
  try { fs.renameSync(temporary, target); }
  catch {
    fs.rmSync(target, { force: true });
    fs.renameSync(temporary, target);
  }
  return target;
}

async function captureState() {
  if (captureInFlight) return latestState;
  captureInFlight = true;
  try {
    const window = mainRendererWindow();
    const base = {
      appReady: electron.app.isReady(),
      appName: electron.app.getName(),
      appVersion: electron.app.getVersion(),
      userDataPath: electron.app.getPath('userData'),
      mainWindowFound: Boolean(window),
      mainWindowVisible: Boolean(window && !window.isDestroyed() && window.isVisible()),
      rendererReady: false,
      ready: false,
      error: null
    };

    if (!window || window.webContents.isLoadingMainFrame()) {
      latestState = base;
      return latestState;
    }

    let renderer;
    try {
      renderer = await window.webContents.executeJavaScript(`(() => {
        const keep = new Set(['dnd','setup','ai-services','logs','settings']);
        const visible = (node) => {
          if (!node || node.hidden) return false;
          const style = getComputedStyle(node);
          return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
        };
        const visibleNavViews = [...document.querySelectorAll('.nav-item[data-view]')]
          .filter(visible)
          .map((node) => String(node.dataset.view || ''))
          .filter(Boolean);
        const forbiddenVisible = [...new Set(visibleNavViews.filter((view) => !keep.has(view)))];
        return {
          documentReadyState: document.readyState,
          product: String(document.documentElement.dataset.nexusProduct || ''),
          title: document.title || '',
          brand: String(document.querySelector('.brand strong')?.textContent || '').trim(),
          brandSubtitle: String(document.querySelector('.brand span')?.textContent || '').trim(),
          activeView: String(document.querySelector('.view.active')?.id || ''),
          visibleNavViews: [...new Set(visibleNavViews)],
          forbiddenVisible,
          bodyTextLength: String(document.body?.innerText || '').trim().length,
          hasShell: Boolean(document.querySelector('.app-shell')),
          hasDndView: Boolean(document.getElementById('view-dnd'))
        };
      })();`, true);
    } catch (error) {
      latestState = { ...base, error: String(error?.message || error).slice(0, 500) };
      return latestState;
    }

    const isolatedProfile = /Nexus D&D Standalone[\\/]?$/i.test(String(base.userDataPath || '').replace(/\//g, '\\'));
    const rendererReady = renderer.documentReadyState === 'complete'
      && renderer.product === 'dnd-standalone'
      && renderer.brand === 'Nexus D&D'
      && renderer.activeView === 'view-dnd'
      && renderer.hasShell
      && renderer.hasDndView
      && renderer.bodyTextLength > 100
      && renderer.forbiddenVisible.length === 0;

    latestState = {
      ...base,
      ...renderer,
      isolatedProfile,
      rendererReady,
      ready: Boolean(base.mainWindowVisible && rendererReady && isolatedProfile)
    };
    return latestState;
  } finally {
    captureInFlight = false;
  }
}

async function captureAndWrite() {
  try {
    const state = await captureState();
    writePayload(state);
    return state;
  } catch (error) {
    const state = {
      appReady: electron.app.isReady(),
      appName: electron.app.getName(),
      appVersion: electron.app.getVersion(),
      userDataPath: electron.app.isReady() ? electron.app.getPath('userData') : null,
      ready: false,
      error: String(error?.message || error).slice(0, 500)
    };
    latestState = state;
    try { writePayload(state); } catch {}
    return state;
  }
}

function install() {
  if (installed || process.env.KHAOS_PACKAGED_STARTUP_SMOKE !== '1') return;
  installed = true;
  electron.app.whenReady().then(() => {
    void captureAndWrite();
    timer = setInterval(() => { void captureAndWrite(); }, 250);
    timer.unref?.();
  }).catch((error) => {
    latestState = { ready: false, error: String(error?.message || error).slice(0, 500) };
    try { writePayload(latestState); } catch {}
  });

  electron.app.on('before-quit', () => {
    if (timer) clearInterval(timer);
    timer = null;
    try { writePayload(latestState || { ready: false, error: 'Application quit before startup evidence was captured.' }); } catch {}
  });
}

module.exports = { evidencePath, mainRendererWindow, captureState, captureAndWrite, install };
