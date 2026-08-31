'use strict';

const { ENV_KEY, runIfRequested } = require('./arkshop-gen1-mysql-import.cjs');

function installGen1MysqlImportRuntime({ delayMs = 45000 } = {}) {
  if (!String(process.env[ENV_KEY] || '').trim()) return { enabled: false };
  const timer = setTimeout(() => {
    void runIfRequested().then((result) => {
      if (result.skipped) console.log(`[Nexus Sentinal] MAP1 ArkShop MySQL import skipped: ${result.skipped}`);
      else console.log(`[Nexus Sentinal] MAP1 ArkShop MySQL import COMPLETE: applied=${result.applied} sourceRows=${result.sourceRows} targetRowsBefore=${result.targetRowsBefore} inserted=${result.inserted} matching=${result.matching} verified=${result.verified} backup=${result.backupTable || 'not-needed'}`);
    }).catch((error) => console.error(`[Nexus Sentinal] MAP1 ArkShop MySQL import FAILED CLOSED: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 400)}`));
  }, Math.max(5000, Number(delayMs) || 45000));
  timer.unref?.();
  console.log(`[Nexus Sentinal] MAP1 ArkShop MySQL import armed via ${ENV_KEY}; live ArkShop remains on SQLite.`);
  return { enabled: true };
}

module.exports = { installGen1MysqlImportRuntime };
