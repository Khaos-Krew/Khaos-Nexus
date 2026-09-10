'use strict';

function dependencyFailure(name, error) {
  return Object.freeze({
    ok: false,
    unavailable: true,
    dependency: name,
    reason: `${name}-probe-failed`,
    errorCode: typeof error?.code === 'string' ? error.code.slice(0, 64) : null,
  });
}

async function safeProbe(name, probe, fallback) {
  try { return await probe(); } catch (error) { return fallback(dependencyFailure(name, error)); }
}

function isCommitSha(value) {
  return /^[0-9a-f]{40}$/i.test(String(value || '').trim());
}

function isRailwayId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

class CutoverReadiness {
  constructor({ database, deadLetters, arkHealthReadiness, arkRconReadiness, config, now = () => Date.now() } = {}) {
    this.database = database;
    this.deadLetters = deadLetters;
    this.arkHealthReadiness = arkHealthReadiness;
    this.arkRconReadiness = arkRconReadiness;
    this.config = config || {};
    this.now = now;
  }

  async snapshot({ since, deadLetterLimit = 100 } = {}) {
    const reasons = [];
    const dependencyFailures = [];

    const database = this.database?.ping
      ? await safeProbe('database', () => this.database.ping(), (failure) => {
        dependencyFailures.push(failure);
        return { ok: false, enabled: true, reason: failure.reason };
      })
      : { ok: false, enabled: false, reason: 'database-unavailable' };
    if (!database.ok) reasons.push('database-unhealthy');

    let arkHealth = null;
    if (this.arkHealthReadiness?.snapshot) {
      arkHealth = await safeProbe('ark-health-readiness', () => this.arkHealthReadiness.snapshot({ since, limit: 500 }), (failure) => {
        dependencyFailures.push(failure);
        return { advisory: true, writeCapable: false, eligible: false, reasons: [failure.reason] };
      });
      if (!arkHealth?.eligible) reasons.push('ark-health-equivalence-proof-incomplete');
    } else reasons.push('ark-health-readiness-unavailable');

    let rcon = null;
    if (this.arkRconReadiness?.snapshot) {
      rcon = await safeProbe('ark-rcon-readiness', () => this.arkRconReadiness.snapshot({ since, limit: 500 }), (failure) => {
        dependencyFailures.push(failure);
        return { advisory: true, writeCapable: false, eligible: false, reasons: [failure.reason] };
      });
      if (!rcon?.eligible) reasons.push('ark-rcon-proof-incomplete');
    } else reasons.push('ark-rcon-readiness-unavailable');

    let quarantinedDeadLetters = [];
    let deadLetterInspectionAvailable = Boolean(this.deadLetters?.list);
    if (this.deadLetters?.list) {
      const deadLetterResult = await safeProbe('dead-letter-store', () => this.deadLetters.list({ status: 'quarantined', limit: deadLetterLimit }), (failure) => {
        dependencyFailures.push(failure);
        deadLetterInspectionAvailable = false;
        return [];
      });
      quarantinedDeadLetters = Array.isArray(deadLetterResult) ? deadLetterResult : [];
      if (!deadLetterInspectionAvailable) reasons.push('dead-letter-store-unavailable');
      else if (quarantinedDeadLetters.length > 0) reasons.push('quarantined-dead-letters-present');
    } else reasons.push('dead-letter-store-unavailable');

    const mutationSafety = {
      mutationEnabled: Boolean(this.config.mutationEnabled),
      dryRun: this.config.dryRun !== false,
      safeForAdvisoryObservation: !this.config.mutationEnabled || this.config.dryRun !== false,
    };
    if (!mutationSafety.safeForAdvisoryObservation) reasons.push('mutation-safety-disabled');

    const deploymentEvidence = {
      deploymentCommit: String(this.config.deploymentCommit || '').trim() || null,
      rollbackCommit: String(this.config.rollbackCommit || '').trim() || null,
      rollbackDeploymentId: String(this.config.rollbackDeploymentId || '').trim() || null,
      rollbackServiceId: String(this.config.rollbackServiceId || '').trim() || null,
      rollbackEnvironmentId: String(this.config.rollbackEnvironmentId || '').trim() || null,
      rollbackRailwayCommit: String(this.config.rollbackRailwayCommit || '').trim() || null,
      rollbackVerified: this.config.rollbackVerified === true,
      rollbackVerifiedAt: String(this.config.rollbackVerifiedAt || '').trim() || null,
      rollbackVerificationMaxAgeHours: Math.min(168, Math.max(1, Number(this.config.rollbackVerificationMaxAgeHours) || 24)),
    };
    deploymentEvidence.deploymentCommitRecorded = Boolean(deploymentEvidence.deploymentCommit);
    deploymentEvidence.rollbackCommitRecorded = Boolean(deploymentEvidence.rollbackCommit);
    deploymentEvidence.deploymentCommitValid = isCommitSha(deploymentEvidence.deploymentCommit);
    deploymentEvidence.rollbackCommitValid = isCommitSha(deploymentEvidence.rollbackCommit);
    deploymentEvidence.railwayRollbackIdentityRecorded = Boolean(deploymentEvidence.rollbackDeploymentId && deploymentEvidence.rollbackServiceId && deploymentEvidence.rollbackEnvironmentId);
    deploymentEvidence.railwayRollbackIdentityValid = isRailwayId(deploymentEvidence.rollbackDeploymentId)
      && isRailwayId(deploymentEvidence.rollbackServiceId)
      && isRailwayId(deploymentEvidence.rollbackEnvironmentId);
    deploymentEvidence.railwayRollbackCommitRecorded = Boolean(deploymentEvidence.rollbackRailwayCommit);
    deploymentEvidence.railwayRollbackCommitValid = isCommitSha(deploymentEvidence.rollbackRailwayCommit);
    deploymentEvidence.distinctRollbackTarget = deploymentEvidence.deploymentCommitValid
      && deploymentEvidence.rollbackCommitValid
      && deploymentEvidence.deploymentCommit.toLowerCase() !== deploymentEvidence.rollbackCommit.toLowerCase();
    deploymentEvidence.railwayCommitMatchesRollback = deploymentEvidence.rollbackCommitValid
      && deploymentEvidence.railwayRollbackCommitValid
      && deploymentEvidence.rollbackCommit.toLowerCase() === deploymentEvidence.rollbackRailwayCommit.toLowerCase();

    const verifiedAtMs = deploymentEvidence.rollbackVerifiedAt ? Date.parse(deploymentEvidence.rollbackVerifiedAt) : Number.NaN;
    const verificationAgeMs = Number.isFinite(verifiedAtMs) ? this.now() - verifiedAtMs : null;
    deploymentEvidence.rollbackVerificationTimeRecorded = Boolean(deploymentEvidence.rollbackVerifiedAt);
    deploymentEvidence.rollbackVerificationTimeValid = Number.isFinite(verifiedAtMs);
    deploymentEvidence.rollbackVerificationFutureDated = Number.isFinite(verificationAgeMs) && verificationAgeMs < 0;
    deploymentEvidence.rollbackVerificationAgeSeconds = Number.isFinite(verificationAgeMs) && verificationAgeMs >= 0
      ? Math.floor(verificationAgeMs / 1000)
      : null;
    deploymentEvidence.rollbackVerificationFresh = deploymentEvidence.rollbackVerified
      && deploymentEvidence.rollbackVerificationTimeValid
      && !deploymentEvidence.rollbackVerificationFutureDated
      && verificationAgeMs <= deploymentEvidence.rollbackVerificationMaxAgeHours * 60 * 60 * 1000;

    deploymentEvidence.safe = deploymentEvidence.deploymentCommitValid
      && deploymentEvidence.rollbackCommitValid
      && deploymentEvidence.railwayRollbackIdentityValid
      && deploymentEvidence.railwayRollbackCommitValid
      && deploymentEvidence.distinctRollbackTarget
      && deploymentEvidence.railwayCommitMatchesRollback
      && deploymentEvidence.rollbackVerificationFresh;

    if (!deploymentEvidence.deploymentCommitRecorded) reasons.push('deployment-commit-unrecorded');
    else if (!deploymentEvidence.deploymentCommitValid) reasons.push('deployment-commit-invalid');
    if (!deploymentEvidence.rollbackCommitRecorded) reasons.push('rollback-commit-unrecorded');
    else if (!deploymentEvidence.rollbackCommitValid) reasons.push('rollback-commit-invalid');
    if (!deploymentEvidence.railwayRollbackIdentityRecorded) reasons.push('railway-rollback-identity-unrecorded');
    else if (!deploymentEvidence.railwayRollbackIdentityValid) reasons.push('railway-rollback-identity-invalid');
    if (!deploymentEvidence.railwayRollbackCommitRecorded) reasons.push('railway-rollback-commit-unrecorded');
    else if (!deploymentEvidence.railwayRollbackCommitValid) reasons.push('railway-rollback-commit-invalid');
    if (deploymentEvidence.deploymentCommitValid && deploymentEvidence.rollbackCommitValid && !deploymentEvidence.distinctRollbackTarget) reasons.push('rollback-target-not-distinct');
    if (deploymentEvidence.rollbackCommitValid && deploymentEvidence.railwayRollbackCommitValid && !deploymentEvidence.railwayCommitMatchesRollback) reasons.push('railway-rollback-commit-mismatch');
    if (!deploymentEvidence.rollbackVerified) reasons.push('rollback-unverified');
    else if (!deploymentEvidence.rollbackVerificationTimeRecorded) reasons.push('rollback-verification-time-unrecorded');
    else if (!deploymentEvidence.rollbackVerificationTimeValid) reasons.push('rollback-verification-time-invalid');
    else if (deploymentEvidence.rollbackVerificationFutureDated) reasons.push('rollback-verification-future-dated');
    else if (!deploymentEvidence.rollbackVerificationFresh) reasons.push('rollback-verification-stale');

    const gates = {
      database: Boolean(database.ok),
      arkHealthEquivalence: Boolean(arkHealth?.eligible),
      arkRcon: Boolean(rcon?.eligible),
      deadLettersClear: deadLetterInspectionAvailable && quarantinedDeadLetters.length === 0,
      mutationSafety: mutationSafety.safeForAdvisoryObservation,
      deploymentRollbackEvidence: deploymentEvidence.safe,
    };

    return Object.freeze({
      advisory: true,
      productionDeploymentAuthorized: false,
      ready: Object.values(gates).every(Boolean),
      reasons: [...new Set(reasons)],
      gates,
      database,
      arkHealthEquivalence: arkHealth,
      arkRcon: rcon,
      deadLetters: {
        inspectionAvailable: deadLetterInspectionAvailable,
        quarantinedCount: quarantinedDeadLetters.length,
        truncated: deadLetterInspectionAvailable && quarantinedDeadLetters.length >= Math.min(500, Math.max(1, Number(deadLetterLimit) || 100)),
      },
      dependencyFailures: Object.freeze(dependencyFailures),
      mutationSafety,
      deploymentEvidence,
    });
  }
}

module.exports = { CutoverReadiness, isCommitSha, isRailwayId };
