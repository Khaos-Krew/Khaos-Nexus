'use strict';

const { readConfig } = require('./ark-config-manager.cjs');

function lines(text, re) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line, index) => ({ index: index + 1, line: line.trim() }))
    .filter(({ line }) => line && re.test(line));
}

function emit(label, items) {
  console.log(`[Nexus Sentinal] ARK player stat probe ${label}: count=${items.length}`);
  for (const item of items.slice(0, 80)) {
    console.log(`[Nexus Sentinal] ARK player stat probe ${label}: L${item.index} ${item.line}`);
  }
}

async function run() {
  try {
    const [gus, game] = await Promise.all([
      readConfig('ARK_GEN1', 'gus'),
      readConfig('ARK_GEN1', 'game')
    ]);

    emit('GUS', lines(gus.text, /^(PlayerResistanceMultiplier|PlayerDamageMultiplier|PlayerCharacterHealthRecoveryMultiplier|PlayerCharacterStaminaDrainMultiplier|MaxFallSpeedMultiplier)\s*=/i));
    emit('GAME', lines(game.text, /^(PerLevelStatsMultiplier_Player\[[0-9]+\]|PlayerBaseStatMultipliers\[[0-9]+\]|bAllowSpeedLeveling|bUseSingleplayerSettings)\s*=/i));
  } catch (error) {
    console.warn(`[Nexus Sentinal] ARK player stat probe failed: ${String(error?.message || error).slice(0, 400)}`);
  }
}

setTimeout(() => void run(), 6000).unref?.();
