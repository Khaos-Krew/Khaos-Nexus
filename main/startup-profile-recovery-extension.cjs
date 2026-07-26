'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const { recoverProfileSafely } = require('./profile-recovery.cjs');

let installed = false;
let recoveryResult = null;

function install() {
  if (installed) return;
  installed = true;
  electron.app.whenReady().then(() => {
    const destination = electron.app.getPath('userData');
    recoveryResult = recoverProfileSafely(destination);
    if (recoveryResult.recovered) {
      const marker = {
        format: 'khaos-nexus-startup-profile-recovery',
        formatVersion: 1,
        completedAt: new Date().toISOString(),
        source: recoveryResult.source,
        sourceReason: recoveryResult.sourceReason,
        backup: recoveryResult.backup,
        destination,
        restoredScore: recoveryResult.current?.score || 0,
        restoredFiles: recoveryResult.restoredFiles || 0,
        backupFiles: recoveryResult.backupFiles || 0
      };
      fs.writeFileSync(path.join(destination, 'startup-profile-recovery.json'), JSON.stringify(marker, null, 2), 'utf8');
      console.info('[Khaos Nexus] Recovered the v0.17-compatible profile before window creation.', marker);
    } else if (recoveryResult.error) {
      console.error('[Khaos Nexus] Pre-window profile recovery failed.', recoveryResult.error);
    }
  }).catch((error) => {
    recoveryResult = { recovered: false, error: error.message };
    console.error('[Khaos Nexus] Startup profile recovery initialization failed.', error);
  });
}

function getRecoveryResult() {
  return recoveryResult ? JSON.parse(JSON.stringify(recoveryResult)) : null;
}

module.exports = { install, getRecoveryResult };
