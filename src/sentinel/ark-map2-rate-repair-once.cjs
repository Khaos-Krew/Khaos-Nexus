'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { updateIniConfig } = require('./ark-config-manager.cjs');
const { patchIniSection } = require('./ark-sftp-config.cjs');

const REQUEST = String(process.env.ARK_MAP2_RATE_REPAIR_ONCE || '').trim();
const STAMP_DIR = process.env.NEXUS_DATA_DIR ? path.resolve(process.env.NEXUS_DATA_DIR) : '/app/data';
const SAFE = REQUEST.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) || 'repair';
const STAMP = path.join(STAMP_DIR, `ark-map2-rate-repair-${SAFE}.done.json`);

const GUS_UPDATES = Object.freeze({
  XPMultiplier: '5.0',
  TamingSpeedMultiplier: '10.0',
  HarvestAmountMultiplier: '5.0',
  HarvestHealthMultiplier: '2.0',
  ResourcesRespawnPeriodMultiplier: '0.5'
});

const GAME_UPDATES = Object.freeze({
  GlobalSpoilingTimeMultiplier: '1.50000',
  GlobalItemDecompositionTimeMultiplier: '1.50000',
  GlobalCorpseDecompositionTimeMultiplier: '1.50000',
  ResourceNoReplenishRadiusPlayers: '0.50000',
  ResourceNoReplenishRadiusStructures: '0.75000',
  bFlyerPlatformAllowUnalignedDinoBasing: 'True',
  bUseCorpseLocator: 'True',
  MatingIntervalMultiplier: '0.05000',
  MatingSpeedMultiplier: '5.00000',
  EggHatchSpeedMultiplier: '25.00000',
  BabyMatureSpeedMultiplier: '20.00000',
  BabyFoodConsumptionSpeedMultiplier: '0.75000',
  CropGrowthSpeedMultiplier: '10.00000',
  LayEggIntervalMultiplier: '0.50000',
  CropDecaySpeedMultiplier: '0.50000',
  HairGrowthSpeedMultiplier: '2.00000',
  StructureDamageRepairCooldown: '120',
  bPvEAllowTribeWarCancel: 'True',
  CustomRecipeEffectivenessMultiplier: '1.50000',
  CustomRecipeSkillMultiplier: '1.50000',
  DinoHarvestingDamageMultiplier: '2.00000',
  PlayerHarvestingDamageMultiplier: '1.50000',
  SupplyCrateLootQualityMultiplier: '3.00000',
  FishingLootQualityMultiplier: '2.00000',
  BabyImprintingStatScaleMultiplier: '1.00000',
  BabyImprintAmountMultiplier: '2.00000',
  BabyCuddleIntervalMultiplier: '0.05000',
  BabyCuddleGracePeriodMultiplier: '3.00000',
  BabyCuddleLoseImprintQualitySpeedMultiplier: '0.50000',
  bAllowCustomRecipes: 'True',
  bUseSingleplayerSettings: 'False',
  TamedDinoCharacterFoodDrainMultiplier: '0.75000',
  WildDinoCharacterFoodDrainMultiplier: '1.00000',
  WildDinoTorporDrainMultiplier: '0.75000',
  PassiveTameIntervalMultiplier: '0.50000',
  TamedDinoTorporDrainMultiplier: '0.75000',
  KillXPMultiplier: '1.50000',
  HarvestXPMultiplier: '1.50000',
  CraftXPMultiplier: '1.25000',
  GenericXPMultiplier: '1.50000',
  SpecialXPMultiplier: '1.50000',
  UseCorpseLifeSpanMultiplier: '1.50000',
  FuelConsumptionIntervalMultiplier: '1.50000',
  DisableDefaultMapItemSets: 'False',
  bAllowFlyerSpeedLeveling: 'True',
  bAllowSpeedLeveling: 'True',
  'PerLevelStatsMultiplier_DinoTamed[0]': '0.30000',
  'PerLevelStatsMultiplier_DinoTamed[1]': '1.50000',
  'PerLevelStatsMultiplier_DinoTamed[2]': '1.00000',
  'PerLevelStatsMultiplier_DinoTamed[3]': '1.50000',
  'PerLevelStatsMultiplier_DinoTamed[4]': '1.50000',
  'PerLevelStatsMultiplier_DinoTamed[5]': '1.00000',
  'PerLevelStatsMultiplier_DinoTamed[6]': '1.00000',
  'PerLevelStatsMultiplier_DinoTamed[7]': '3.00000',
  'PerLevelStatsMultiplier_DinoTamed[8]': '0.25000',
  'PerLevelStatsMultiplier_DinoTamed[9]': '1.25000',
  'PerLevelStatsMultiplier_DinoTamed[10]': '1.00000',
  'PerLevelStatsMultiplier_DinoTamed[11]': '1.00000'
});

async function run() {
  if (!REQUEST) {
    console.log('[Nexus Sentinal] Astraeos one-time rate repair skipped: not-requested');
    return;
  }
  if (fs.existsSync(STAMP)) {
    console.log(`[Nexus Sentinal] Astraeos one-time rate repair skipped: already-applied stamp=${STAMP}`);
    return;
  }

  const gus = await updateIniConfig({
    prefix: 'ARK_MAP2',
    fileKey: 'gus',
    transform: (current) => patchIniSection(current, 'ServerSettings', GUS_UPDATES)
  });
  const game = await updateIniConfig({
    prefix: 'ARK_MAP2',
    fileKey: 'game',
    transform: (current) => patchIniSection(current, '/Script/ShooterGame.ShooterGameMode', GAME_UPDATES)
  });

  fs.mkdirSync(STAMP_DIR, { recursive: true });
  fs.writeFileSync(STAMP, JSON.stringify({
    request: REQUEST,
    appliedAt: new Date().toISOString(),
    playerStatsTouched: false,
    gus: { changed: gus.changed, backup: gus.backup, remoteFile: gus.remoteFile },
    game: { changed: game.changed, backup: game.backup, remoteFile: game.remoteFile }
  }, null, 2));

  console.log(`[Nexus Sentinal] Astraeos one-time rate repair complete: gusChanged=${gus.changed} gameChanged=${game.changed} playerStatsTouched=false restartRequired=${Boolean(gus.restartRequired || game.restartRequired)} gusBackup=${gus.backup || 'none'} gameBackup=${game.backup || 'none'}`);
}

run().catch((error) => {
  console.error(`[Nexus Sentinal] Astraeos one-time rate repair FAILED: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 700)}`);
  process.exitCode = 1;
});
