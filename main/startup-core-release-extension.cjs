'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const startupHealth = require('./startup-health-extension.cjs');

const POLL_INTERVAL_MS = 250;
const READY_STABILITY_MS = 1500;
const REQUIRED_CHECKS = Object.freeze({
  'profile-location': new Set(['pass']),
  'config-file': new Set(['pass', 'warn']),
  'data-integrity': new Set(['pass']),
  'data-write': new Set(['pass']),
  'secure-storage': new Set(['pass', 'warn']),
  'config-store': new Set(['pass']),
  'renderer-bridge': new Set(['pass'])
});

let installed = false;
let pollTimer = null;
let readySince = 0;
let emitted = false;
let lastFingerprint = '';
let diagnosticsFile = null;
let textLogFile = null;

function compactState(health) {
  return {
    version: electron.app.getVersion?.() || null,
    time: new Date().toISOString(),
    elapsedMs: Number(health?.elapsedMs || 0),
    phase: health?.phase || null,
    overall: health?.overall || null,
    completed: Boolean(health?.completed),
    releaseAllowed: Boolean(health?.releaseAllowed),
    released: Boolean(health?.released),
    configStoreReady: Boolean(health?.configStoreReady),
    rendererBridgeReady: Boolean(health?.rendererBridgeReady),
    rendererModulesReady: Boolean(health?.rendererModulesReady),
    authObserved: Boolean(health?.authObserved),
    checks: (health?.checks || []).map((check) => ({
      id: check.id,
      label: check.label,
      status: check.status,
      critical: Boolean(check.critical),
      detail: check.detail || ''
    }))
  };
}

function initializePaths() {
  if (diagnosticsFile) return;
  const userData = electron.app.getPath('userData');
  diagnosticsFile = path.join(userData, 'startup-core-release-diagnostics.json');
  textLogFile = path.join(userData, 'logs', 'startup-core-release.log');
}

function writeRecord(stage, detail = {}, health = null) {
  try {
    initializePaths();
    const payload = {
      format: 'khaos-nexus-startup-core-release',
      formatVersion: 1,
      stage,
      detail,
      controller: {
        installed,
        emitted,
        readySince: readySince ? new Date(readySince).toISOString() : null,
        pollIntervalMs: POLL_INTERVAL_MS,
        readyStabilityMs: READY_STABILITY_MS
      },
      health: compactState(health || startupHealth.publicState())
    };
    fs.mkdirSync(path.dirname(diagnosticsFile), { recursive: true });
    const temporary = `${diagnosticsFile}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), 'utf8');
    try { fs.renameSync(temporary, diagnosticsFile); }
    catch {
      fs.rmSync(diagnosticsFile, { force: true });
      fs.renameSync(temporary, diagnosticsFile);
    }
    fs.mkdirSync(path.dirname(textLogFile), { recursive: true });
    fs.appendFileSync(textLogFile, `[${payload.health.time}] ${stage} ${JSON.stringify(detail)}\n`, 'utf8');
  } catch (error) {
    console.error('[Khaos Nexus] Could not retain core startup release diagnostics.', error);
  }
}

function checkMap(health) {
  return new Map((health?.checks || []).map((check) => [String(check.id || ''), check]));
}

function readiness(health) {
  const checks = checkMap(health);
  const blockers = [];

  if (!health?.configStoreReady) blockers.push('configuration services are not ready');
  if (!health?.rendererBridgeReady) blockers.push('the protected renderer bridge is not ready');

  for (const [id, allowed] of Object.entries(REQUIRED_CHECKS)) {
    const check = checks.get(id);
    if (!check) {
      blockers.push(`${id} has not reported`);
      continue;
    }
    if (!allowed.has(String(check.status || ''))) blockers.push(`${id} is ${check.status || 'unknown'}`);
  }

  const unrelatedCriticalFailures = (health?.checks || []).filter((check) =>
    check.critical && check.status === 'fail' && !['renderer-modules', 'startup-timeout'].includes(check.id)
  );
  for (const check of unrelatedCriticalFailures) blockers.push(`${check.id} failed: ${check.detail || check.label}`);

  return { ready: blockers.length === 0, blockers };
}

function fingerprint(stage, detail) {
  return JSON.stringify([stage, detail]);
}

function recordChanged(stage, detail, health) {
  const next = fingerprint(stage, detail);
  if (next === lastFingerprint) return;
  lastFingerprint = next;
  writeRecord(stage, detail, health);
}

function emitCoreReady(health) {
  if (emitted || electron.app.isQuitting) return;
  emitted = true;
  const detail = {
    loaded: 0,
    fallback: true,
    coreStartupController: true,
    baseInterfaceVerified: true,
    optionalModulesContinuing: !health.rendererModulesReady,
    reason: 'Profile, configuration, protected storage, local write access, and the main renderer bridge passed in the core startup process.'
  };
  writeRecord('core-ready-emitted', detail, health);
  electron.ipcMain.emit('renderer-boot:stage', { sender: startupHealth.refs.mainWindow?.webContents || null }, {
    stage: 'features-ready',
    detail,
    time: new Date().toISOString()
  });
}

function tick() {
  let health;
  try { health = startupHealth.publicState(); }
  catch (error) {
    recordChanged('health-state-unavailable', { message: error.message || String(error) }, null);
    return;
  }

  if (health.released) {
    recordChanged('startup-released', { limitedMode: Boolean(health.limitedMode) }, health);
    clearInterval(pollTimer);
    pollTimer = null;
    return;
  }

  const result = readiness(health);
  if (!result.ready) {
    readySince = 0;
    recordChanged('waiting-for-core-health', { blockers: result.blockers }, health);
    return;
  }

  if (!readySince) {
    readySince = Date.now();
    writeRecord('core-health-ready', { stabilizingForMs: READY_STABILITY_MS }, health);
    return;
  }

  const stableForMs = Date.now() - readySince;
  if (stableForMs < READY_STABILITY_MS) {
    recordChanged('core-health-stabilizing', { stableForMs, requiredMs: READY_STABILITY_MS }, health);
    return;
  }

  emitCoreReady(health);
}

function install() {
  if (installed) return;
  installed = true;

  electron.app.whenReady().then(() => {
    writeRecord('controller-installed', {
      userData: electron.app.getPath('userData'),
      discordDesktopSignInRequired: false,
      optionalModuleCompletionRequired: false
    });
    tick();
    pollTimer = setInterval(tick, POLL_INTERVAL_MS);
    pollTimer.unref?.();
  }).catch((error) => {
    console.error('[Khaos Nexus] Core startup release controller failed to initialize.', error);
  });

  electron.app.on('before-quit', () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  });
}

module.exports = {
  POLL_INTERVAL_MS,
  READY_STABILITY_MS,
  REQUIRED_CHECKS,
  compactState,
  readiness,
  install
};
