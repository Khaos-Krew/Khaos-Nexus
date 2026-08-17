'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');

let installed = false;
let timer = null;

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
  return writePayload({ phase, detail });
}

function writeEvidence() {
  if (process.env.KHAOS_PACKAGED_STARTUP_SMOKE !== '1') return null;
  const startupHealth = require('./startup-health-extension.cjs');
  return writePayload({ phase: 'health-state', state: startupHealth.publicState() });
}

function install() {
  if (installed || process.env.KHAOS_PACKAGED_STARTUP_SMOKE !== '1') return;
  installed = true;
  try { writePhase('extension-installed', { appReady: electron.app.isReady() }); }
  catch (error) { console.error('[Khaos Nexus] Could not write packaged startup install marker.', error); }

  electron.app.whenReady().then(() => {
    try { writePhase('electron-ready', { appVersion: electron.app.getVersion() }); } catch {}
    writeEvidence();
    timer = setInterval(() => {
      try { writeEvidence(); }
      catch (error) { console.error('[Khaos Nexus] Could not write packaged startup evidence.', error); }
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

module.exports = { evidencePath, writePayload, writePhase, writeEvidence, install };