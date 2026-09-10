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
    config: {
      mutationEnabled: false,
      dryRun: true,
      deploymentCommit: 'candidate-sha',
      rollbackCommit: 'known-good-sha',
      rollbackDeploymentId: 'railway-deployment-id',
      rollbackServiceId: 'railway-service-id',
      rollbackEnvironmentId: 'railway-environment-id',
      rollbackRailwayCommit: 'known-good-sha',
      rollbackVerified: true,
    },
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
    deploymentRollbackEvidence: true,
  });
  assert.equal(result.deadLetters.inspectionAvailable, true);
  assert.equal(result.deadLetters.quarantinedCount, 0);
  assert.deepEqual(result.dependencyFailures, []);
  assert.equal(result.deploymentEvidence.safe, true);
  assert.equal(result.deploymentEvidence.distinctRollbackTarget, true);
  assert.equal(result.deploymentEvidence.railwayRollbackIdentityRecorded, true);
  assert.equal(result.deploymentEvidence.railwayRollbackCommitRecorded, true);
  assert.equal(result.deploymentEvidence.railwayCommitMatchesRollback, true);
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
    'deployment-commit-unrecorded',
    'rollback-commit-unrecorded',
    'railway-rollback-identity-unrecorded',
    'railway-rollback-commit-unrecorded',
    'rollback-unverified',
  ]);
  assert.equal(result.arkHealthEquivalence.eligible, false);
  assert.equal(result.deadLetters.inspectionAvailable, true);
  assert.equal(result.deadLetters.quarantinedCount, 1);
  assert.equal(result.mutationSafety.safeForAdvisoryObservation, false);
  assert.equal(result.deploymentEvidence.safe, false);
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
    'deployment-commit-unrecorded',
    'rollback-commit-unrecorded',
    'railway-rollback-identity-unrecorded',
    'railway-rollback-commit-unrecorded',
    'rollback-unverified',
  ]);
  assert.equal(result.deadLetters.inspectionAvailable, false);
});

test('cutover readiness rejects a rollback target that is the deployment candidate itself', async () => {
  const readiness = new CutoverReadiness({
    database: { async ping() { return { ok: true, enabled: true }; } },
    deadLetters: { async list() { return []; } },
    arkHealthReadiness: { async snapshot() { return { eligible: true }; } },
    arkRconReadiness: { async snapshot() { return { eligible: true }; } },
    config: {
      mutationEnabled: false,
      dryRun: true,
      deploymentCommit: 'same-sha',
      rollbackCommit: 'same-sha',
      rollbackDeploymentId: 'railway-deployment-id',
      rollbackServiceId: 'railway-service-id',
      rollbackEnvironmentId: 'railway-environment-id',
      rollbackRailwayCommit: 'same-sha',
      rollbackVerified: true,
    },
  });

  const result = await readiness.snapshot();

  assert.equal(result.ready, false);
  assert.equal(result.gates.deploymentRollbackEvidence, false);
  assert.equal(result.deploymentEvidence.distinctRollbackTarget, false);
  assert.deepEqual(result.reasons, ['rollback-target-not-distinct']);
});

test('cutover readiness requires a complete Railway rollback deployment identity', async () => {
  const readiness = new CutoverReadiness({
    database: { async ping() { return { ok: true, enabled: true }; } },
    deadLetters: { async list() { return []; } },
    arkHealthReadiness: { async snapshot() { return { eligible: true }; } },
    arkRconReadiness: { async snapshot() { return { eligible: true }; } },
    config: {
      mutationEnabled: false,
      dryRun: true,
      deploymentCommit: 'candidate-sha',
      rollbackCommit: 'known-good-sha',
      rollbackDeploymentId: 'railway-deployment-id',
      rollbackServiceId: 'railway-service-id',
      rollbackRailwayCommit: 'known-good-sha',
      rollbackVerified: true,
    },
  });

  const result = await readiness.snapshot();

  assert.equal(result.ready, false);
  assert.equal(result.deploymentEvidence.railwayRollbackIdentityRecorded, false);
  assert.equal(result.deploymentEvidence.safe, false);
  assert.deepEqual(result.reasons, ['railway-rollback-identity-unrecorded']);
});

test('cutover readiness rejects Railway rollback evidence whose observed commit does not match the rollback target', async () => {
  const readiness = new CutoverReadiness({
    database: { async ping() { return { ok: true, enabled: true }; } },
    deadLetters: { async list() { return []; } },
    arkHealthReadiness: { async snapshot() { return { eligible: true }; } },
    arkRconReadiness: { async snapshot() { return { eligible: true }; } },
    config: {
      mutationEnabled: false,
      dryRun: true,
      deploymentCommit: 'candidate-sha',
      rollbackCommit: 'known-good-sha',
      rollbackDeploymentId: 'railway-deployment-id',
      rollbackServiceId: 'railway-service-id',
      rollbackEnvironmentId: 'railway-environment-id',
      rollbackRailwayCommit: 'different-sha',
      rollbackVerified: true,
    },
  });

  const result = await readiness.snapshot();

  assert.equal(result.ready, false);
  assert.equal(result.deploymentEvidence.railwayCommitMatchesRollback, false);
  assert.equal(result.deploymentEvidence.safe, false);
  assert.deepEqual(result.reasons, ['railway-rollback-commit-mismatch']);
});

test('cutover readiness fails closed when dependency probes throw', async () => {
  const readiness = new CutoverReadiness({
    database: { async ping() { const error = new Error('database secret detail'); error.code = 'ETIMEDOUT'; throw error; } },
    deadLetters: { async list() { throw new Error('dead-letter connection detail'); } },
    arkHealthReadiness: { async snapshot() { throw new Error('health evidence detail'); } },
    arkRconReadiness: { async snapshot() { throw new Error('rcon evidence detail'); } },
    config: {
      mutationEnabled: false,
      dryRun: true,
      deploymentCommit: 'candidate-sha',
      rollbackCommit: 'known-good-sha',
      rollbackDeploymentId: 'railway-deployment-id',
      rollbackServiceId: 'railway-service-id',
      rollbackEnvironmentId: 'railway-environment-id',
      rollbackRailwayCommit: 'known-good-sha',
      rollbackVerified: true,
    },
  });

  const result = await readiness.snapshot();

  assert.equal(result.ready, false);
  assert.equal(result.productionDeploymentAuthorized, false);
  assert.deepEqual(result.reasons, [
    'database-unhealthy',
    'ark-health-equivalence-proof-incomplete',
    'ark-rcon-proof-incomplete',
    'dead-letter-store-unavailable',
  ]);
  assert.deepEqual(result.gates, {
    database: false,
    arkHealthEquivalence: false,
    arkRcon: false,
    deadLettersClear: false,
    mutationSafety: true,
    deploymentRollbackEvidence: true,
  });
  assert.equal(result.deadLetters.inspectionAvailable, false);
  assert.equal(result.dependencyFailures.length, 4);
  assert.deepEqual(result.dependencyFailures.map((failure) => failure.reason), [
    'database-probe-failed',
    'ark-health-readiness-probe-failed',
    'ark-rcon-readiness-probe-failed',
    'dead-letter-store-probe-failed',
  ]);
  assert.equal(result.dependencyFailures[0].errorCode, 'ETIMEDOUT');
  assert.equal(JSON.stringify(result).includes('secret detail'), false);
  assert.equal(JSON.stringify(result).includes('connection detail'), false);
  assert.equal(JSON.stringify(result).includes('evidence detail'), false);
});
