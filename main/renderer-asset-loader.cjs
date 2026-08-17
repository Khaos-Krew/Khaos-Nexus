'use strict';

const fs = require('node:fs');
const electron = require('electron');

const bundles = new Map();
const windowState = new WeakMap();
let installed = false;

function cleanId(value) {
  return String(value || '').trim().replace(/[^a-z0-9._-]+/gi, '-').slice(0, 120);
}

function readAsset(filePath, kind) {
  const pathValue = String(filePath || '');
  if (!pathValue) throw new Error(`Renderer ${kind} path is required.`);
  return { path: pathValue, content: fs.readFileSync(pathValue, 'utf8') };
}

function normalizeBundle(input = {}) {
  const id = cleanId(input.id);
  if (!id) throw new Error('Renderer bundle id is required.');
  return Object.freeze({
    id,
    styles: Object.freeze((input.styles || []).filter(Boolean).map((value) => readAsset(value, 'style'))),
    scripts: Object.freeze((input.scripts || []).filter(Boolean).map((value) => readAsset(value, 'script'))),
    source: String(input.source || id).slice(0, 160)
  });
}

function stateFor(window) {
  let state = windowState.get(window);
  if (!state) {
    state = { generation: 0, applied: new Set(), applying: Promise.resolve() };
    windowState.set(window, state);
  }
  return state;
}

function isMainRendererWindow(window) {
  try {
    const url = String(window?.webContents?.getURL?.() || '').replace(/\\/g, '/');
    return /\/renderer\/index\.html(?:[?#]|$)/i.test(url);
  } catch {
    return false;
  }
}

async function applyBundle(window, bundle, expectedGeneration) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false;
  const state = stateFor(window);
  if (state.generation !== expectedGeneration || state.applied.has(bundle.id)) return false;

  for (const style of bundle.styles) {
    if (state.generation !== expectedGeneration || window.isDestroyed() || window.webContents.isDestroyed()) return false;
    await window.webContents.insertCSS(style.content);
  }
  for (const script of bundle.scripts) {
    if (state.generation !== expectedGeneration || window.isDestroyed() || window.webContents.isDestroyed()) return false;
    await window.webContents.executeJavaScript(script.content, true);
  }
  if (state.generation === expectedGeneration) state.applied.add(bundle.id);
  return true;
}

function reportFeaturesReady(window, selected, generation) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed() || !isMainRendererWindow(window)) return false;
  const state = stateFor(window);
  if (state.generation !== generation) return false;
  const scripts = selected.reduce((total, bundle) => total + bundle.scripts.length, 0);
  electron.ipcMain.emit('renderer-boot:stage', { sender: window.webContents }, {
    stage: 'features-ready',
    detail: {
      loaded: scripts,
      bundles: selected.length,
      source: 'renderer-asset-loader'
    },
    time: new Date().toISOString()
  });
  return true;
}

function queueApply(window, onlyId = '') {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return Promise.resolve(false);
  const state = stateFor(window);
  const generation = state.generation;
  const selected = onlyId ? [bundles.get(onlyId)].filter(Boolean) : [...bundles.values()];
  state.applying = state.applying.then(async () => {
    for (const bundle of selected) {
      try {
        await applyBundle(window, bundle, generation);
      } catch (error) {
        console.error(`[Khaos Nexus] Renderer bundle ${bundle.id} failed to load.`, error);
      }
    }
    if (!onlyId) reportFeaturesReady(window, selected, generation);
    return true;
  });
  return state.applying;
}

function attachWindow(window) {
  if (!window || window.isDestroyed() || window.__khaosRendererAssetLoaderAttached) return;
  Object.defineProperty(window, '__khaosRendererAssetLoaderAttached', { value: true, configurable: true });
  const state = stateFor(window);
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
    if (!isMainFrame) return;
    state.generation += 1;
    state.applied.clear();
  });
  window.webContents.on('did-finish-load', () => { void queueApply(window); });
  window.on('closed', () => windowState.delete(window));
}

function install() {
  if (installed) return;
  installed = true;
  electron.app.on('browser-window-created', (_event, window) => attachWindow(window));
  electron.app.whenReady().then(() => {
    for (const window of electron.BrowserWindow.getAllWindows()) attachWindow(window);
  }).catch((error) => console.error('[Khaos Nexus] Renderer asset loader initialization failed.', error));
}

function registerRendererBundle(input) {
  install();
  const bundle = normalizeBundle(input);
  const existing = bundles.get(bundle.id);
  if (existing) {
    const same = JSON.stringify(existing) === JSON.stringify(bundle);
    if (!same) throw new Error(`Renderer bundle ${bundle.id} is already registered with different assets.`);
    return bundle;
  }
  bundles.set(bundle.id, bundle);
  if (electron.app.isReady()) {
    for (const window of electron.BrowserWindow.getAllWindows()) {
      attachWindow(window);
      void queueApply(window, bundle.id);
    }
  }
  return bundle;
}

function status() {
  return { installed, bundles: [...bundles.values()].map((bundle) => ({ id: bundle.id, styles: bundle.styles.length, scripts: bundle.scripts.length, source: bundle.source })) };
}

module.exports = { install, registerRendererBundle, status, isMainRendererWindow, reportFeaturesReady };