'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const startupHealth = require('./startup-health-extension.cjs');
const interfaceWatchdog = require('./interface-watchdog-extension.cjs');
const { appendLog, writeDiagnostic } = require('./portable-runtime.cjs');
const {
  REQUIRED_CHECKS,
  readiness
} = require('../shared/startup-core-readiness.cjs');

const POLL_INTERVAL_MS = 250;
const READY_STABILITY_MS = 1500;

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

function compactInterfaceState() {
  try {
    const current = interfaceWatchdog.publicState();
    return {
      installed: Boolean(current.installed),
      attached: Boolean(current.attached),
      windowId: current.windowId || null,
      stage: current.stage || null,
      stable: Boolean(current.stable),
      stableSince: current.stableSince || null,
      inspectionCount: Number(current.inspectionCount || 0),
      lastInspectionAt: current.lastInspectionAt || null,
      lastReason: current.lastReason || null,
      lastSnapshot: current.lastSnapshot || null,
      lastVisual: current.lastVisual || null,
      failureReported: Boolean(current.failureReported),
      failureId: current.failureId || null
    };
  } catch (error) {
    return { installed: false, attached: false, stable: false, error: error.message || String(error) };
  }
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
      formatVersion: 2,
      stage,
      detail,
      controller: {
        installed,
        emitted,
        readySince: readySince ? new Date(readySince).toISOString() : null,
        pollIntervalMs: POLL_INTERVAL_MS,
        readyStabilityMs: READY_STABILITY_MS,
        visibleInterfaceRequired: true
      },
      interface: compactInterfaceState(),
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
    const line = `[${payload.health.time}] ${stage} ${JSON.stringify(detail)}`;
    fs.appendFileSync(textLogFile, `${line}\n`, 'utf8');
    try {
      writeDiagnostic('startup-core-release-diagnostics.json', payload);
      appendLog('startup-core-release.log', line);
    } catch {}
  } catch (error) {
    console.error('[Khaos Nexus] Could not retain core startup release diagnostics.', error);
  }
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

function emitCoreReady(health, interfaceState) {
  if (emitted || electron.app.isQuitting) return;
  emitted = true;
  const detail = {
    loaded: 0,
    fallback: true,
    coreStartupController: true,
    baseInterfaceVerified: true,
    visibleInterfaceStable: true,
    visibleInterfaceStableSince: interfaceState.stableSince || null,
    optionalModulesContinuing: !health.rendererModulesReady,
    reason: 'Profile, configuration, protected storage, local write access, renderer bridge, and a continuously visible main interface passed in the core startup process.'
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
  const interfaceState = compactInterfaceState();
  if (!interfaceState.installed || !interfaceState.attached || !interfaceState.stable) {
    result.ready = false;
    result.blockers.push(!interfaceState.installed
      ? 'the continuous interface watchdog is not installed'
      : !interfaceState.attached
        ? 'the continuous interface watchdog has not attached to the main window'
        : `the main interface is not stably visible (${interfaceState.stage || 'unknown state'})`);
  }
  if (interfaceState.failureReported) {
    result.ready = false;
    result.blockers.push(`the interface watchdog reported failure ${interfaceState.failureId || ''}`.trim());
  }

  if (!result.ready) {
    readySince = 0;
    recordChanged('waiting-for-core-health', {
      blockers: result.blockers,
      interfaceStage: interfaceState.stage || null,
      interfaceStable: Boolean(interfaceState.stable),
      interfaceAttached: Boolean(interfaceState.attached),
      discordDesktopSignInRequired: result.discordDesktopSignInRequired,
      optionalModuleCompletionRequired: result.optionalModuleCompletionRequired
    }, health);
    return;
  }

  if (!readySince) {
    readySince = Date.now();
    writeRecord('core-health-ready', {
      stabilizingForMs: READY_STABILITY_MS,
      visibleInterfaceRequired: true,
      interfaceStableSince: interfaceState.stableSince || null,
      discordDesktopSignInRequired: false,
      optionalModuleCompletionRequired: false
    }, health);
    return;
  }

  const stableForMs = Date.now() - readySince;
  if (stableForMs < READY_STABILITY_MS) {
    recordChanged('core-health-stabilizing', {
      stableForMs,
      requiredMs: READY_STABILITY_MS,
      interfaceStableSince: interfaceState.stableSince || null
    }, health);
    return;
  }

  emitCoreReady(health, interfaceState);
}

function install() {
  if (installed) return;
  installed = true;

  electron.app.whenReady().then(() => {
    writeRecord('controller-installed', {
      userData: electron.app.getPath('userData'),
      visibleInterfaceRequired: true,
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
  compactInterfaceState,
  readiness,
  install
};
