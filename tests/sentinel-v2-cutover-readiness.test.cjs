'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CutoverReadiness } = require('../src/sentinel-v2/cutover-readiness.cjs');

test('cutover readiness is green only when every advisory gate is satisfied', async () => {
  const readiness = new CutoverReadiness({
    database: { async ping() { return { ok: true, enabled: true }; } },
    deadLetters: { async list() { return []; } },
    arkHealthReadiness: { async snapshot() { return { advisory: true, writeCapable: false, eligible: true, reasons: [] }; } },
    arkRconReadiness: { async snapshot() { return { advisory: true, writeCapable: false, eligible: true, reasons: [] }; } },
    config: { mutationEnabled: false, dryRun: true },
  });

  const result = await readiness.snapshot();

  assert.equal(result.advisory, true);
  assert.equal(result.productionDeploymentAuthorized, false);
  assert.equal(result.ready, true);
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(result.gates, {
    database: true,
    arkHealthEquivalence: true,
    arkRcon: true,
    deadLettersClear: true,
    mutationSafety: true,
  });
  assert.equal(result.deadLetters.quarantinedCount, 0);
});

test('cutover readiness reports concrete blockers without granting production authority', async () => {
  const readiness = new CutoverReadiness({
    database: { async ping() { return { ok: false, enabled: true, reason: 'timeout' }; } },
    deadLetters: { async list() { return [{ deadLetterId: 1 }]; } },
    arkHealthReadiness: { async snapshot() { return { advisory: true, writeCapable: false, eligible: false, reasons: ['drift-detected'] }; } },
    arkRconReadiness: { async snapshot() { return { advisory: true, writeCapable: false, eligible: false, reasons: ['insufficient-samples'] }; } },
    config: { mutationEnabled: true, dryRun: false },
  });

  const result = await readiness.snapshot();

  assert.equal(result.ready, false);
  assert.equal(result.productionDeploymentAuthorized, false);
  assert.deepEqual(result.reasons, [
    'database-unhealthy',
    'ark-health-equivalence-proof-incomplete',
    'ark-rcon-proof-incomplete',
    'quarantined-dead-letters-present',
    'mutation-safety-disabled',
  ]);
  assert.equal(result.arkHealthEquivalence.eligible, false);
  assert.equal(result.deadLetters.quarantinedCount, 1);
  assert.equal(result.mutationSafety.safeForAdvisoryObservation, false);
});

test('cutover readiness treats unavailable dependencies as blockers', async () => {
  const readiness = new CutoverReadiness({ config: { mutationEnabled: false, dryRun: true } });
  const result = await readiness.snapshot();

  assert.equal(result.ready, false);
  assert.equal(result.productionDeploymentAuthorized, false);
  assert.deepEqual(result.reasons, [
    'database-unhealthy',
    'ark-health-readiness-unavailable',
    'ark-rcon-readiness-unavailable',
    'dead-letter-store-unavailable',
  ]);
});
