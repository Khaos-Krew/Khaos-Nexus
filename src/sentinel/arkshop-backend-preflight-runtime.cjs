'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { runArkShopBackendPreflight, safeLogSummary } = require('./arkshop-backend-preflight.cjs');

const ENV_KEY = 'ARK_GEN1_ARKSHOP_BACKEND_PREFLIGHT_ONCE';

function requestToken() {
  return String(process.env[ENV_KEY] || '').trim();
}

function safeToken(value) {
  return String(value || '').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 100) || 'preflight';
}

function dataDir() {
  return process.env.NEXUS_DATA_DIR || '/app/data';
}

function stampFile(token) {
  return path.join(dataDir(), `arkshop-backend-preflight-${safeToken(token)}.done.json`);
}

function sanitizedResult(result) {
  const take = (stats = {}) => ({
    rows: Number(stats.rows || 0),
    rowsWithPoints: Number(stats.rowsWithPoints || 0),
    rowsWithKits: Number(stats.rowsWithKits || 0),
    duplicateIds: Boolean(stats.duplicateIds),
    identityDigest: String(stats.identityDigest || ''),
    stateDigest: String(stats.stateDigest || '')
  });
  return {
    completedAt: new Date().toISOString(),
    comparison: {
      mode: String(result?.comparison?.mode || 'unknown'),
      safeToSwitch: Boolean(result?.comparison?.safeToSwitch)
    },
    sqlite: take(result?.sqlite),
    mysql: take(result?.mysql)
  };
}

async function runOnce(token = requestToken()) {
  if (!token) return { skipped: 'not-requested' };
  const stamp = stampFile(token);
  if (fs.existsSync(stamp)) return { skipped: 'already-applied', stamp };
  const result = await runArkShopBackendPreflight({ prefix: 'ARK_GEN1' });
  const safe = sanitizedResult(result);
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(stamp, JSON.stringify(safe, null, 2), { mode: 0o600 });
  console.log(`[Nexus Sentinal] ArkShop backend preflight COMPLETE: ${safeLogSummary(result)}`);
  return { ...safe, stamp };
}

function installArkShopBackendPreflightRuntime({ delayMs = 30000 } = {}) {
  const token = requestToken();
  if (!token) return { enabled: false };
  const timer = setTimeout(() => {
    void runOnce(token).then((result) => {
      if (result?.skipped) console.log(`[Nexus Sentinal] ArkShop backend preflight skipped: ${result.skipped}`);
    }).catch((error) => {
      console.error(`[Nexus Sentinal] ArkShop backend preflight FAILED CLOSED: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 400)}`);
    });
  }, Math.max(5000, Number(delayMs) || 30000));
  timer.unref?.();
  console.log(`[Nexus Sentinal] ArkShop backend preflight armed via ${ENV_KEY}; read-only database comparison only.`);
  return { enabled: true };
}

module.exports = {
  ENV_KEY,
  requestToken,
  sanitizedResult,
  runOnce,
  installArkShopBackendPreflightRuntime
};
