'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');

let installed = false;
let timer = null;
let uiCaptureInFlight = false;
let latestUiState = null;

function evidencePath() {
  const explicit = String(process.env.KHAOS_PACKAGED_STARTUP_SMOKE_FILE || '').trim();
  if (explicit) return path.resolve(explicit);
  return path.join(process.env.TEMP || electron.app.getPath('temp'), 'khaos-packaged-startup-smoke.json');
}

function writePayload(payload) {
  if (process.env.KHAOS_PACKAGED_STARTUP_SMOKE !== '1') return null;
  const target = evidencePath();
  const temporary = `${target}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify({
    capturedAt: new Date().toISOString(),
    processId: process.pid,
    ...payload
  }, null, 2), 'utf8');
  try { fs.renameSync(temporary, target); }
  catch {
    fs.rmSync(target, { force: true });
    fs.renameSync(temporary, target);
  }
  return target;
}

function writePhase(phase, detail = {}) {
  return writePayload({ phase, detail, ui: latestUiState });
}

function writeEvidence() {
  if (process.env.KHAOS_PACKAGED_STARTUP_SMOKE !== '1') return null;
  const startupHealth = require('./startup-health-extension.cjs');
  return writePayload({ phase: 'health-state', state: startupHealth.publicState(), ui: latestUiState });
}

function mainRendererWindow() {
  return electron.BrowserWindow.getAllWindows().find((window) => {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false;
    const url = String(window.webContents.getURL?.() || '').replace(/\\/g, '/');
    return /\/renderer\/index\.html(?:[?#]|$)/i.test(url);
  }) || null;
}

async function captureUiState() {
  if (process.env.KHAOS_PACKAGED_STARTUP_SMOKE !== '1' || uiCaptureInFlight) return latestUiState;
  const window = mainRendererWindow();
  if (!window) return latestUiState;
  uiCaptureInFlight = true;
  try {
    latestUiState = await window.webContents.executeJavaScript(`(() => {
      const forbidden = new Set(['dnd','ai','ai-services','nexus-ai','scheduler','hosted-servers','mobile','mobile-companion','rust','satisfactory']);
      const selectors = ['[data-view]','[data-view-link]','[data-view-proxy]','[data-command-view]','[data-khaos-open]'];
      const visible = (node) => {
        if (!node || node.hidden) return false;
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
      };
      const valueFor = (node) => node?.dataset?.view || node?.dataset?.viewLink || node?.dataset?.viewProxy || node?.dataset?.commandView || node?.dataset?.khaosOpen || '';
      const forbiddenVisible = [];
      document.querySelectorAll(selectors.join(',')).forEach((node) => {
        const view = String(valueFor(node));
        if (forbidden.has(view) && visible(node)) forbiddenVisible.push(view);
      });
      const serverGame = document.getElementById('serverGame');
      const serverOptions = serverGame ? [...serverGame.options].map((option) => option.value) : [];
      const brandSubtitle = String(document.querySelector('.brand span')?.textContent || '').trim();
      const product = String(document.documentElement.dataset.nexusProduct || '');
      const guard = String(document.documentElement.dataset.sentinelUiGuard || '');
      const scopeReady = String(document.documentElement.dataset.sentinelUiReady || '');
      const dashboardRoadmap = Boolean(document.getElementById('sentinelTestRoadmap'));
      const moduleCenter = Boolean(document.getElementById('sentinelModuleCenter'));
      const legacyModuleCenter = document.getElementById('nexusModuleCenter');
      const legacyModuleCenterHidden = !legacyModuleCenter || !visible(legacyModuleCenter);
      const roadmapLabels = [...document.querySelectorAll('#sentinelModuleCenter .sentinel-module-status')].map((node) => String(node.textContent || '').trim());
      const validRoadmapLabels = roadmapLabels.every((label) => ['Operational','Migrate in progress','Disabled','Blocked'].includes(label));
      const uniqueForbidden = [...new Set(forbiddenVisible)];
      const ready = product === 'sentinel'
        && guard === 'active'
        && scopeReady === 'true'
        && uniqueForbidden.length === 0
        && brandSubtitle === 'Discord + Palworld Control Center'
        && dashboardRoadmap
        && moduleCenter
        && legacyModuleCenterHidden
        && validRoadmapLabels
        && (serverOptions.length === 0 || (serverOptions.length === 1 && serverOptions[0] === 'palworld'));
      return {
        ready,
        product,
        guard,
        scopeReady,
        brandSubtitle,
        forbiddenVisible: uniqueForbidden,
        serverOptions,
        dashboardRoadmap,
        moduleCenter,
        legacyModuleCenterHidden,
        roadmapLabels,
        validRoadmapLabels,
        title: document.title
      };
    })();`, true);
  } catch (error) {
    latestUiState = {
      ready: false,
      error: String(error?.message || error).slice(0, 500)
    };
  } finally {
    uiCaptureInFlight = false;
  }
  return latestUiState;
}

function install() {
  if (installed || process.env.KHAOS_PACKAGED_STARTUP_SMOKE !== '1') return;
  installed = true;
  try { writePhase('extension-installed', { appReady: electron.app.isReady() }); }
  catch (error) { console.error('[Khaos Nexus] Could not write packaged startup install marker.', error); }

  electron.app.whenReady().then(() => {
    try { writePhase('electron-ready', { appVersion: electron.app.getVersion() }); } catch {}
    void captureUiState().finally(() => { try { writeEvidence(); } catch {} });
    timer = setInterval(() => {
      void captureUiState().finally(() => {
        try { writeEvidence(); }
        catch (error) { console.error('[Khaos Nexus] Could not write packaged startup evidence.', error); }
      });
    }, 250);
    timer.unref?.();
  }).catch((error) => {
    try { writePhase('electron-ready-failed', { message: error.message || String(error) }); } catch {}
    console.error('[Khaos Nexus] Packaged startup evidence initialization failed.', error);
  });

  electron.app.on('before-quit', () => {
    if (timer) clearInterval(timer);
    timer = null;
    try { writeEvidence(); } catch {}
  });
}

module.exports = { evidencePath, writePayload, writePhase, writeEvidence, mainRendererWindow, captureUiState, install };
