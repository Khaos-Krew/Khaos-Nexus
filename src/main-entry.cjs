'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { ciSmokeConfig, writeCiSmokeResult } = require('./desktop/ci-smoke.cjs');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForBackendHealth(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:3210/health', { signal: AbortSignal.timeout(1500) });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body?.ok !== false) return { ok: true, status: response.status };
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = String(error?.message || error);
    }
    await delay(150);
  }
  throw new Error(`Embedded backend health did not become ready: ${lastError || 'timeout'}`);
}

function transactionFromArgs(args = process.argv) {
  const index = args.indexOf('--nexus-post-update');
  if (index < 0 || !args[index + 1]) return null;
  const transactionPath = path.resolve(String(args[index + 1]));
  const transaction = JSON.parse(fs.readFileSync(transactionPath, 'utf8'));
  return { transactionPath, transaction };
}

async function waitForPostUpdateConfirmation(transactionInfo, timeoutMs = 20000) {
  if (!transactionInfo) return { required: false, confirmed: false };
  const markerPath = path.resolve(String(transactionInfo.transaction?.markerPath || ''));
  const targetVersion = String(transactionInfo.transaction?.targetVersion || '');
  if (!markerPath || !targetVersion) throw new Error('Post-update smoke transaction is missing marker/version metadata.');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (marker?.ok === true && String(marker.version || '') === targetVersion) {
        return { required: true, confirmed: true, version: targetVersion };
      }
    } catch {}
    await delay(150);
  }
  throw new Error('Updated Nexus did not produce the expected post-update health marker.');
}

function installCiSmokeHarness() {
  let smoke;
  try {
    smoke = ciSmokeConfig();
  } catch (error) {
    console.error('[Khaos Nexus CI Smoke] invalid configuration:', error.message);
    return { enabled: false, invalid: true };
  }
  if (!smoke.enabled) return smoke;

  app.setPath('userData', smoke.userDataPath);
  let finished = false;
  const finish = async (payload, exitCode = 0) => {
    if (finished) return;
    finished = true;
    try { writeCiSmokeResult(smoke, payload); }
    catch (error) { console.error('[Khaos Nexus CI Smoke] result write failed:', error.message); }
    setTimeout(() => app.exit(exitCode), 50);
  };

  const watchdog = setTimeout(() => {
    void finish({ ok: false, error: 'Packaged Nexus smoke test timed out before renderer/backend readiness.' }, 1);
  }, 45000);
  watchdog.unref?.();

  app.on('browser-window-created', (_event, win) => {
    win.on('show', () => win.hide());
    win.webContents.once('did-finish-load', async () => {
      try {
        const backend = await waitForBackendHealth();
        const postUpdate = await waitForPostUpdateConfirmation(transactionFromArgs());
        clearTimeout(watchdog);
        await finish({
          ok: true,
          packaged: app.isPackaged,
          version: app.getVersion(),
          backend,
          postUpdate
        }, 0);
      } catch (error) {
        clearTimeout(watchdog);
        await finish({
          ok: false,
          packaged: app.isPackaged,
          version: app.getVersion(),
          error: String(error?.message || error)
        }, 1);
      }
    });
  });

  return smoke;
}

installCiSmokeHarness();
require('./main.cjs');

module.exports = {
  delay,
  waitForBackendHealth,
  transactionFromArgs,
  waitForPostUpdateConfirmation,
  installCiSmokeHarness
};
