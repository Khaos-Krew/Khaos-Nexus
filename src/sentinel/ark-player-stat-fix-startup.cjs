'use strict';

// One-time Gen 1 survivor stat correction. Safe to rerun; writes are idempotent and backed up.
const { setIniValue } = require('./ark-config-manager.cjs');

const CHANGES = [
  { fileKey: 'game', section: '/Script/ShooterGame.ShooterGameMode', key: 'PerLevelStatsMultiplier_Player[0]', value: '2.50000' },
  { fileKey: 'game', section: '/Script/ShooterGame.ShooterGameMode', key: 'PerLevelStatsMultiplier_Player[1]', value: '2.00000' },
  { fileKey: 'game', section: '/Script/ShooterGame.ShooterGameMode', key: 'PlayerBaseStatMultipliers[0]', value: '1.50000' },
  { fileKey: 'gus', section: 'ServerSettings', key: 'MaxFallSpeedMultiplier', value: '3.00000' },
  { fileKey: 'gus', section: 'ServerSettings', key: 'PlayerCharacterHealthRecoveryMultiplier', value: '2.00000' },
  { fileKey: 'gus', section: 'ServerSettings', key: 'PlayerResistanceMultiplier', value: '1.00000' }
];

async function run() {
  for (const change of CHANGES) {
    try {
      const result = await setIniValue({ prefix: 'ARK_GEN1', ...change });
      console.log(`[Nexus Sentinal] ARK player stat fix: file=${change.fileKey} key=${change.key} value=${change.value} changed=${result.changed} backup=${result.backup || 'none'} restartRequired=${result.restartRequired}`);
    } catch (error) {
      console.warn(`[Nexus Sentinal] ARK player stat fix failed: file=${change.fileKey} key=${change.key} error=${String(error?.message || error).slice(0, 300)}`);
      return;
    }
  }
  console.log('[Nexus Sentinal] ARK player stat fix staged successfully; ARK restart required for full effect.');
}

setTimeout(() => void run(), 6000).unref?.();
