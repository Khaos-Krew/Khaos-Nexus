'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CutoverReadiness, isCommitSha, isRailwayId } = require('../src/sentinel-v2/cutover-readiness.cjs');

const CANDIDATE = '1111111111111111111111111111111111111111';
const ROLLBACK = '2222222222222222222222222222222222222222';
const DEPLOYMENT_ID = 'f0716d0d-ccda-4c3f-b5c2-778a1d8ffe61';
const SERVICE_ID = 'a89ba9d3-e5e7-4e20-b1c8-1fad1ece331b';
const ENVIRONMENT_ID = '668aaf1d-a98c-4873-9e29-8c02aebb1ddb';
const NOW = Date.parse('2026-09-10T15:00:00.000Z');

function healthyDependencies() {
  return {
    database: { async ping() { return { ok: true, enabled: true }; } },
    deadLetters: { async list() { return []; } },
    arkHealthReadiness: { async snapshot() { return { advisory: true, writeCapable: false, eligible: true, reasons: [] }; } },
    arkRconReadiness: { async snapshot() { return { advisory: true, writeCapable: false, eligible: true, reasons: [] }; } },
  };
}

function validConfig(overrides = {}) {
  return {
    mutationEnabled: false,
    dryRun: true,
    deploymentCommit: CANDIDATE,
    rollbackCommit: ROLLBACK,
    rollbackDeploymentId: DEPLOYMENT_ID,
    rollbackServiceId: SERVICE_ID,
    rollbackEnvironmentId: ENVIRONMENT_ID,
    rollbackRailwayCommit: ROLLBACK,
    rollbackVerified: true,
    rollbackVerifiedAt: '2026-09-10T14:30:00.000Z',
    rollbackVerificationMaxAgeHours: 24,
    ...overrides,
  };
}

function readinessWith(config = validConfig()) {
  return new CutoverReadiness({ ...healthyDependencies(), config, now: () => NOW });
}

test('cutover readiness is green only when every advisory gate is satisfied', async () => {
  const result = await readinessWith().snapshot();

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
  assert.equal(result.deploymentEvidence.safe, true);
  assert.equal(result.deploymentEvidence.deploymentCommitValid, true);
  assert.equal(result.deploymentEvidence.rollbackCommitValid, true);
  assert.equal(result.deploymentEvidence.railwayRollbackIdentityValid, true);
  assert.equal(result.deploymentEvidence.railwayRollbackCommitValid, true);
  assert.equal(result.deploymentEvidence.rollbackVerificationFresh, true);
  assert.equal(result.deploymentEvidence.rollbackVerificationAgeSeconds, 1800);
});

test('cutover readiness reports concrete blockers without granting production authority', async () => {
  const readiness = new CutoverReadiness({
    database: { async ping() { return { ok: false, enabled: true, reason: 'timeout' }; } },
    deadLetters: { async list() { return [{ deadLetterId: 1 }]; } },
    arkHealthReadiness: { async snapshot() { return { eligible: false }; } },
    arkRconReadiness: { async snapshot() { return { eligible: false }; } },
    config: { mutationEnabled: true, dryRun: false },
    now: () => NOW,
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
});

test('cutover readiness treats unavailable dependencies as blockers', async () => {
  const result = await new CutoverReadiness({ config: { mutationEnabled: false, dryRun: true }, now: () => NOW }).snapshot();
  assert.equal(result.ready, false);
  assert.equal(result.deadLetters.inspectionAvailable, false);
  assert.equal(result.productionDeploymentAuthorized, false);
});

test('cutover readiness rejects a rollback target that is the deployment candidate itself', async () => {
  const result = await readinessWith(validConfig({ rollbackCommit: CANDIDATE, rollbackRailwayCommit: CANDIDATE })).snapshot();
  assert.equal(result.ready, false);
  assert.equal(result.deploymentEvidence.distinctRollbackTarget, false);
  assert.deepEqual(result.reasons, ['rollback-target-not-distinct']);
});

test('cutover readiness rejects malformed commit and Railway identities', async () => {
  const result = await readinessWith(validConfig({
    deploymentCommit: 'candidate-sha',
    rollbackCommit: 'known-good-sha',
    rollbackDeploymentId: 'railway-deployment-id',
    rollbackServiceId: 'railway-service-id',
    rollbackEnvironmentId: 'railway-environment-id',
    rollbackRailwayCommit: 'known-good-sha',
  })).snapshot();

  assert.equal(result.ready, false);
  assert.equal(result.deploymentEvidence.safe, false);
  assert.equal(result.deploymentEvidence.deploymentCommitValid, false);
  assert.equal(result.deploymentEvidence.rollbackCommitValid, false);
  assert.equal(result.deploymentEvidence.railwayRollbackIdentityValid, false);
  assert.equal(result.deploymentEvidence.railwayRollbackCommitValid, false);
  assert.deepEqual(result.reasons, [
    'deployment-commit-invalid',
    'rollback-commit-invalid',
    'railway-rollback-identity-invalid',
    'railway-rollback-commit-invalid',
  ]);
});

test('cutover readiness rejects Railway rollback evidence whose observed commit does not match the rollback target', async () => {
  const different = '3333333333333333333333333333333333333333';
  const result = await readinessWith(validConfig({ rollbackRailwayCommit: different })).snapshot();
  assert.equal(result.ready, false);
  assert.equal(result.deploymentEvidence.railwayCommitMatchesRollback, false);
  assert.deepEqual(result.reasons, ['railway-rollback-commit-mismatch']);
});

test('cutover readiness rejects stale rollback verification evidence', async () => {
  const result = await readinessWith(validConfig({ rollbackVerifiedAt: '2026-09-09T14:59:59.000Z' })).snapshot();
  assert.equal(result.ready, false);
  assert.equal(result.deploymentEvidence.rollbackVerificationFresh, false);
  assert.deepEqual(result.reasons, ['rollback-verification-stale']);
});

test('cutover readiness rejects missing, invalid, and future-dated rollback verification timestamps', async () => {
  const missing = await readinessWith(validConfig({ rollbackVerifiedAt: '' })).snapshot();
  assert.deepEqual(missing.reasons, ['rollback-verification-time-unrecorded']);

  const invalid = await readinessWith(validConfig({ rollbackVerifiedAt: 'not-a-timestamp' })).snapshot();
  assert.deepEqual(invalid.reasons, ['rollback-verification-time-invalid']);

  const future = await readinessWith(validConfig({ rollbackVerifiedAt: '2026-09-10T15:00:01.000Z' })).snapshot();
  assert.deepEqual(future.reasons, ['rollback-verification-future-dated']);
});

test('cutover readiness fails closed when dependency probes throw', async () => {
  const readiness = new CutoverReadiness({
    database: { async ping() { const error = new Error('database secret detail'); error.code = 'ETIMEDOUT'; throw error; } },
    deadLetters: { async list() { throw new Error('dead-letter connection detail'); } },
    arkHealthReadiness: { async snapshot() { throw new Error('health evidence detail'); } },
    arkRconReadiness: { async snapshot() { throw new Error('rcon evidence detail'); } },
    config: validConfig(),
    now: () => NOW,
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
  assert.equal(result.dependencyFailures.length, 4);
  assert.equal(JSON.stringify(result).includes('secret detail'), false);
  assert.equal(JSON.stringify(result).includes('connection detail'), false);
  assert.equal(JSON.stringify(result).includes('evidence detail'), false);
});

test('identity validators accept full commit SHAs and Railway UUIDs only', () => {
  assert.equal(isCommitSha(CANDIDATE), true);
  assert.equal(isCommitSha('abc123'), false);
  assert.equal(isRailwayId(DEPLOYMENT_ID), true);
  assert.equal(isRailwayId('not-a-railway-id'), false);
});
