'use strict';

const { runIfRequested } = require('./arkshop-points-recovery.cjs');

const timer = setTimeout(() => {
  void runIfRequested({ stampDirectory: process.env.NEXUS_DATA_DIR || '/app/data' })
    .then((result) => {
      if (result.skipped) {
        console.log(`[Nexus Sentinal] ArkShop points recovery skipped: ${result.skipped}`);
        return;
      }
      console.log(`[Nexus Sentinal] ArkShop points recovery COMPLETE: sqliteRows=${result.sqliteRows} mysqlRowsBefore=${result.mysqlRowsBefore} mysqlRowsAfter=${result.mysqlRowsAfter} inserted=${result.inserted} raised=${result.raised} unchanged=${result.unchanged} mysqlHigherPreserved=${result.mysqlHigherPreserved} pointsAdded=${result.pointsAdded} totalPointsBefore=${result.totalPointsBefore} totalPointsAfter=${result.totalPointsAfter} backupTable=${result.backupTable}`);
    })
    .catch((error) => {
      console.error(`[Nexus Sentinal] ArkShop points recovery BLOCKED: ${String(error?.code || error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 700)}`);
    });
}, 20_000);

timer.unref?.();
