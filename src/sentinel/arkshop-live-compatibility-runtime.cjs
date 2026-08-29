'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { probeLivePluginCompatibility } = require('./arkshop-live-compatibility-probe.cjs');

const ENV_KEY = 'ARK_GEN1_ARKSHOP_COMPATIBILITY_PROBE_ONCE';

function token() {
  return String(process.env[ENV_KEY] || '').trim();
}

function dataDir() {
  return process.env.NEXUS_DATA_DIR || '/app/data';
}

function safeToken(value) {
  return String(value || '').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) || 'probe';
}

function stampFile(value) {
  return path.join(dataDir(), `arkshop-compatibility-${safeToken(value)}.done.json`);
}

async function runOnce(value = token()) {
  if (!value) return { skipped: 'not-requested' };
  const stamp = stampFile(value);
  if (fs.existsSync(stamp)) return { skipped: 'already-applied', stamp };
  const result = await probeLivePluginCompatibility('ARK_GEN1');
  const safe = {
    completedAt: new Date().toISOString(),
    arkshop: result.arkshop,
    arkshopui: result.arkshopui,
    compatibility: result.compatibility
  };
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(stamp, JSON.stringify(safe, null, 2), { mode: 0o600 });
  console.log(`[Nexus Sentinal] ArkShop compatibility probe COMPLETE: arkshop=${safe.compatibility.arkshopVersion || 'missing'} arkshopui=${safe.compatibility.arkshopUiVersion || 'missing'} compatible=${safe.compatibility.compatibleWithPlannedShopUi} blockers=${safe.compatibility.blockers.join(',') || 'none'}`);
  return { ...safe, stamp };
}

function installArkShopCompatibilityProbeRuntime({ delayMs = 35000 } = {}) {
  const value = token();
  if (!value) return { enabled: false };
  const timer = setTimeout(() => {
    void runOnce(value).catch((error) => {
      console.error(`[Nexus Sentinal] ArkShop compatibility probe FAILED CLOSED: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 400)}`);
    });
  }, Math.max(5000, Number(delayMs) || 35000));
  timer.unref?.();
  console.log(`[Nexus Sentinal] ArkShop compatibility probe armed via ${ENV_KEY}; read-only PluginInfo inspection only.`);
  return { enabled: true };
}

module.exports = {
  ENV_KEY,
  token,
  runOnce,
  installArkShopCompatibilityProbeRuntime
};