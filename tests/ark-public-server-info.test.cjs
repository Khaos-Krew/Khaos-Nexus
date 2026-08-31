'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseIni,
  parseActiveModIds,
  extractPublicServerConfig,
  curseForgeLookupUrl,
  resolveCurseForgeMods,
  loadedModIdsFromDiagnostic,
  loadedModNameHintsFromDiagnostic,
  loadLiveArkPublicInfo
} = require('../src/sentinel/ark-public-server-info.cjs');
const {
  buildLiveModListPayload,
  buildServerStatsPayload
} = require('../src/sentinel/ark-cluster-public-actions.cjs');

const GUS = `[ServerSettings]
XPMultiplier=5.0
TamingSpeedMultiplier=10.0
HarvestAmountMultiplier=5.0
DinoCountMultiplier=1.0
OverrideOfficialDifficulty=5.0
SupplyCrateLootQualityMultiplier=2.5
FishingLootQualityMultiplier=2.0
CropGrowthSpeedMultiplier=8.0
ResourcesRespawnPeriodMultiplier=0.5
PlayerCharacterFoodDrainMultiplier=0.75
PlayerCharacterWaterDrainMultiplier=0.75
PlayerCharacterStaminaDrainMultiplier=0.85
AllowThirdPersonPlayer=True
ServerCrosshair=True
AllowHitMarkers=True
ShowMapPlayerLocation=True
ActiveMods=111111,222222
`;

const GAME = `[/Script/ShooterGame.ShooterGameMode]
bAllowSpeedLeveling=True
bAllowFlyerSpeedLeveling=True
MatingIntervalMultiplier=0.10
EggHatchSpeedMultiplier=20.0
BabyMatureSpeedMultiplier=15.0
BabyCuddleIntervalMultiplier=0.10
BabyImprintAmountMultiplier=2.0
PerLevelStatsMultiplier_Player[0]=2.0
PerLevelStatsMultiplier_Player[1]=3.0
PerLevelStatsMultiplier_Player[3]=3.0
PerLevelStatsMultiplier_Player[4]=2.0
PerLevelStatsMultiplier_Player[5]=2.0
PerLevelStatsMultiplier_Player[7]=30.0
PerLevelStatsMultiplier_Player[8]=1.5
PerLevelStatsMultiplier_Player[9]=1.5
PerLevelStatsMultiplier_Player[10]=5.0
PerLevelStatsMultiplier_Player[11]=5.0
PerLevelStatsMultiplier_DinoTamed[0]=0.40
PerLevelStatsMultiplier_DinoTamed[1]=3.0
PerLevelStatsMultiplier_DinoTamed[3]=3.0
PerLevelStatsMultiplier_DinoTamed[4]=2.0
PerLevelStatsMultiplier_DinoTamed[7]=15.0
PerLevelStatsMultiplier_DinoTamed[8]=0.34
PerLevelStatsMultiplier_DinoTamed[9]=1.5
`;

test('ARK public INI parser reads sections and keys case-insensitively', () => {
  const doc = parseIni(GUS);
  assert.equal(doc.serversettings.xpmultiplier, '5.0');
  assert.equal(doc.serversettings.allowthirdpersonplayer, 'True');
});

test('ARK mod fallback extracts configured mod ids without inventing names', () => {
  assert.deepEqual(parseActiveModIds(GUS), ['111111', '222222']);
  assert.deepEqual(parseActiveModIds('launch -mods=333333,444444'), ['333333', '444444']);
});

test('ARK player-facing stats reflect configured boosted Nexus rates', () => {
  const info = extractPublicServerConfig(GUS, GAME);
  assert.equal(info.coreRates.XP, '5×');
  assert.equal(info.coreRates.Taming, '10×');
  assert.equal(info.coreRates.Harvest, '5×');
  assert.equal(info.coreRates.Difficulty, '5 (150 standard max wild)');
  assert.equal(info.playerStats.Weight, '30×');
  assert.equal(info.playerStats.Fortitude, '5×');
  assert.equal(info.dinoStats.Weight, '15×');
  assert.match(info.dinoStats.Health, /^2× vanilla level gain/);
  assert.match(info.dinoStats.Melee, /^2× vanilla level gain/);
  assert.equal(info.breeding['Egg Hatch Speed'], '20×');
  assert.equal(info.breeding['Baby Mature Speed'], '15×');
  assert.equal(info.qualityOfLife['Third Person'], 'Enabled');
  assert.equal(info.qualityOfLife['Player Speed Leveling'], 'Enabled');
  assert.equal(info.qualityOfLife['Flyer Speed Leveling'], 'Enabled');
});

test('CurseForge fallback gives every numeric mod id a CurseForge link', () => {
  const url = curseForgeLookupUrl('955333');
  assert.match(url, /^https:\/\/www\.curseforge\.com\/ark-survival-ascended\/search\?/);
  assert.match(url, /955333/);
});

test('CurseForge-free resolver uses safe names derived from the running server log', async () => {
  const mods = await resolveCurseForgeMods(['928548'], { apiKey: '', nameHints: { 928548: 'Shiny' } });
  assert.equal(mods[0].name, 'Shiny');
  assert.equal(mods[0].nameSource, 'server-log');
  assert.equal(mods[0].metadata, false);
});

test('CurseForge metadata resolver uses batch API response when a key is configured', async () => {
  const mods = await resolveCurseForgeMods(['955333'], {
    apiKey: 'test-key',
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { data: [{ id: 955333, name: 'ASA Api Utils', links: { websiteUrl: 'https://www.curseforge.com/ark-survival-ascended/mods/asa-api-utils' } }] };
      }
    })
  });
  assert.equal(mods[0].name, 'ASA Api Utils');
  assert.equal(mods[0].metadata, true);
  assert.match(mods[0].url, /asa-api-utils/);
});

test('runtime log mod ids take authority over config fallback', () => {
  assert.deepEqual(loadedModIdsFromDiagnostic({ newest: { modIds: ['955333', '942249'] }, modIds: ['111111'] }), ['955333', '942249']);
  assert.deepEqual(loadedModNameHintsFromDiagnostic({ newest: { mods: [{ id: '928548', nameHint: 'Shiny' }] } }), { 928548: 'Shiny' });
});

test('live ARK public snapshot combines runtime mods with live INI stats', async () => {
  const snapshot = await loadLiveArkPublicInfo({ id: 'gen1', mapName: 'Genesis Part 1', envPrefix: 'ARK_GEN1' }, {
    readConfigFn: async (_prefix, key) => ({ text: key === 'gus' ? GUS : GAME }),
    inspectArkApiLogFn: async () => ({ found: true, newest: { modIds: ['955333', '942249'], mods: [{ id: '955333', nameHint: 'ASA Api Utils' }], version: '93.7' } }),
    inspectInstalledArkModsFn: async () => ({ accessible: true, modIds: ['928548'], mods: [{ projectId: '928548', fileId: '5507937' }] }),
    resolveCurseForgeModsFn: async (ids, options) => ids.map((id) => ({ id, name: options.nameHints[id] || `Resolved ${id}`, url: curseForgeLookupUrl(id), metadata: true }))
  });
  assert.equal(snapshot.modSource, 'running server log + server disk');
  assert.deepEqual(snapshot.activeModIds, ['955333', '942249']);
  assert.deepEqual(snapshot.installedModIds, ['928548']);
  assert.deepEqual(snapshot.modIds, ['955333', '942249', '928548']);
  assert.equal(snapshot.mods.length, 3);
  assert.equal(snapshot.mods[0].name, 'ASA Api Utils');
  assert.equal(snapshot.playerStats.Weight, '30×');
  assert.equal(snapshot.qualityOfLife['Third Person'], 'Enabled');
  assert.equal(snapshot.version, '93.7');
});

test('public Discord payloads expose all mod links and common server-stat groups', () => {
  const snapshot = {
    serverName: 'Genesis Part 1',
    version: '93.7',
    checkedAt: '2026-08-28T20:00:00Z',
    mods: [
      { id: '955333', name: 'ASA Api Utils', url: curseForgeLookupUrl('955333') },
      { id: '942249', name: 'ArkShop UI', url: curseForgeLookupUrl('942249') }
    ],
    coreRates: { XP: '5×', Harvest: '5×', Taming: '10×' },
    playerStats: { Weight: '30×', Fortitude: '5×' },
    dinoStats: { Weight: '15×' },
    breeding: { 'Egg Hatch Speed': '20×', 'Baby Mature Speed': '15×' },
    qualityOfLife: { 'Third Person': 'Enabled' }
  };
  const mods = JSON.stringify(buildLiveModListPayload([snapshot]));
  assert.match(mods, /ASA Api Utils/);
  assert.match(mods, /955333/);
  assert.match(mods, /curseforge\.com/);
  const stats = JSON.stringify(buildServerStatsPayload([snapshot]));
  assert.match(stats, /Core Rates/);
  assert.match(stats, /Player Level Stats/);
  assert.match(stats, /Tamed Dino Level Stats/);
  assert.match(stats, /Breeding/);
  assert.match(stats, /Quality of Life/);
  assert.match(stats, /Third Person/);
});
