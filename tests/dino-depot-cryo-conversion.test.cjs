'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  KEY,
  readConversionSetting,
  planCryopodAutoConversion,
  configureCryopodAutoConversion,
  restoreCryopodConversionBackup
} = require('../src/sentinel/dino-depot-cryo-conversion.cjs');

test('conversion planning defaults to disabled and preserves unrelated Dino Depot settings', () => {
  const current = '[ServerSettings]\nServerCrosshair=True\n\n[DinoDepot]\nAllowTerminalPassiveProduction=True\nDinoballTooltipUpdateIntervalSeconds=2\n';
  const plan = planCryopodAutoConversion(current);
  assert.equal(plan.desired, false);
  assert.equal(plan.previous, null);
  assert.equal(plan.safety.automaticConversionEnabled, false);
  assert.match(plan.next, /AllowTerminalPassiveProduction=True/);
  assert.match(plan.next, /DinoballTooltipUpdateIntervalSeconds=2/);
  assert.match(plan.next, new RegExp(`${KEY}=False`));
  assert.equal(plan.next.includes('ServerCrosshair=True'), true);
});

test('enabling conversion changes only the managed key when it already exists', () => {
  const current = '[DinoDepot]\nCryosAutoConvertToDinoballs=False\nAllowTerminalProduceUnfertilizedEggs=True\n\n[OtherMod]\nEnabled=True\n';
  const plan = planCryopodAutoConversion(current, { enabled: true });
  assert.equal(plan.previous, false);
  assert.equal(plan.desired, true);
  assert.equal(plan.changed, true);
  assert.match(plan.next, /CryosAutoConvertToDinoballs=True/);
  assert.match(plan.next, /AllowTerminalProduceUnfertilizedEggs=True/);
  assert.match(plan.next, /\[OtherMod\]\nEnabled=True/);
  assert.equal(plan.next.replace('CryosAutoConvertToDinoballs=True', 'CryosAutoConvertToDinoballs=False'), current);
});

test('existing enabled configuration is idempotent', () => {
  const current = '[DinoDepot]\nCryosAutoConvertToDinoballs=True\n';
  const plan = planCryopodAutoConversion(current, { enabled: true });
  assert.equal(plan.previous, true);
  assert.equal(plan.changed, false);
  assert.equal(plan.next, current);
});

test('ambiguous duplicate conversion settings fail closed instead of being silently overwritten', () => {
  const current = '[DinoDepot]\nCryosAutoConvertToDinoballs=True\nCryosAutoConvertToDinoballs=False\n';
  assert.throws(() => readConversionSetting(current), /Conflicting CryosAutoConvertToDinoballs values/);
  assert.throws(() => planCryopodAutoConversion(current, { enabled: true }), /Conflicting CryosAutoConvertToDinoballs values/);
});

test('invalid existing conversion values fail closed', () => {
  const current = '[DinoDepot]\nCryosAutoConvertToDinoballs=maybe\n';
  assert.throws(() => planCryopodAutoConversion(current, { enabled: false }), /must be True or False/);
});

test('live writes and backup restores require an explicit confirmation token', async () => {
  await assert.rejects(
    configureCryopodAutoConversion({ prefix: 'ARK_GEN1', enabled: true, dryRun: false }),
    /confirmLive=true/
  );
  await assert.rejects(
    restoreCryopodConversionBackup({ prefix: 'ARK_GEN1', backup: '/tmp/not-used' }),
    /confirmLive=true/
  );
});
