'use strict';

class CutoverReadiness {
  constructor({ database, deadLetters, arkHealthReadiness, arkRconReadiness, config } = {}) {
    this.database = database;
    this.deadLetters = deadLetters;
    this.arkHealthReadiness = arkHealthReadiness;
    this.arkRconReadiness = arkRconReadiness;
    this.config = config || {};
  }

  async snapshot({ since, deadLetterLimit = 100 } = {}) {
    const reasons = [];
    const database = this.database?.ping
      ? await this.database.ping()
      : { ok: false, enabled: false, reason: 'database-unavailable' };
    if (!database.ok) reasons.push('database-unhealthy');

    let arkHealth = null;
    if (this.arkHealthReadiness?.snapshot) {
      arkHealth = await this.arkHealthReadiness.snapshot({ since, limit: 500 });
      if (!arkHealth?.eligible) reasons.push('ark-health-equivalence-proof-incomplete');
    } else {
      reasons.push('ark-health-readiness-unavailable');
    }

    let rcon = null;
    if (this.arkRconReadiness?.snapshot) {
      rcon = await this.arkRconReadiness.snapshot({ since, limit: 500 });
      if (!rcon?.eligible) reasons.push('ark-rcon-proof-incomplete');
    } else {
      reasons.push('ark-rcon-readiness-unavailable');
    }

    let quarantinedDeadLetters = [];
    if (this.deadLetters?.list) {
      quarantinedDeadLetters = await this.deadLetters.list({ status: 'quarantined', limit: deadLetterLimit });
      if (quarantinedDeadLetters.length > 0) reasons.push('quarantined-dead-letters-present');
    } else {
      reasons.push('dead-letter-store-unavailable');
    }

    const mutationSafety = {
      mutationEnabled: Boolean(this.config.mutationEnabled),
      dryRun: this.config.dryRun !== false,
      safeForAdvisoryObservation: !this.config.mutationEnabled || this.config.dryRun !== false,
    };
    if (!mutationSafety.safeForAdvisoryObservation) reasons.push('mutation-safety-disabled');

    const deploymentEvidence = {
      deploymentCommit: String(this.config.deploymentCommit || '').trim() || null,
      rollbackCommit: String(this.config.rollbackCommit || '').trim() || null,
      rollbackVerified: this.config.rollbackVerified === true,
    };
    deploymentEvidence.deploymentCommitRecorded = Boolean(deploymentEvidence.deploymentCommit);
    deploymentEvidence.rollbackCommitRecorded = Boolean(deploymentEvidence.rollbackCommit);
    deploymentEvidence.distinctRollbackTarget = deploymentEvidence.deploymentCommitRecorded
      && deploymentEvidence.rollbackCommitRecorded
      && deploymentEvidence.deploymentCommit !== deploymentEvidence.rollbackCommit;
    deploymentEvidence.safe = deploymentEvidence.deploymentCommitRecorded
      && deploymentEvidence.rollbackCommitRecorded
      && deploymentEvidence.distinctRollbackTarget
      && deploymentEvidence.rollbackVerified;

    if (!deploymentEvidence.deploymentCommitRecorded) reasons.push('deployment-commit-unrecorded');
    if (!deploymentEvidence.rollbackCommitRecorded) reasons.push('rollback-commit-unrecorded');
    if (deploymentEvidence.deploymentCommitRecorded && deploymentEvidence.rollbackCommitRecorded && !deploymentEvidence.distinctRollbackTarget) {
      reasons.push('rollback-target-not-distinct');
    }
    if (!deploymentEvidence.rollbackVerified) reasons.push('rollback-unverified');

    const gates = {
      database: Boolean(database.ok),
      arkHealthEquivalence: Boolean(arkHealth?.eligible),
      arkRcon: Boolean(rcon?.eligible),
      deadLettersClear: quarantinedDeadLetters.length === 0,
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
        quarantinedCount: quarantinedDeadLetters.length,
        truncated: quarantinedDeadLetters.length >= Math.min(500, Math.max(1, Number(deadLetterLimit) || 100)),
      },
      mutationSafety,
      deploymentEvidence,
    });
  }
}

module.exports = { CutoverReadiness };
