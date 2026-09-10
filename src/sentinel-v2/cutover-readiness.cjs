'use strict';

class CutoverReadiness {
  constructor({ database, deadLetters, arkRconReadiness, config } = {}) {
    this.database = database;
    this.deadLetters = deadLetters;
    this.arkRconReadiness = arkRconReadiness;
    this.config = config || {};
  }

  async snapshot({ since, deadLetterLimit = 100 } = {}) {
    const reasons = [];
    const database = this.database?.ping
      ? await this.database.ping()
      : { ok: false, enabled: false, reason: 'database-unavailable' };
    if (!database.ok) reasons.push('database-unhealthy');

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

    const gates = {
      database: Boolean(database.ok),
      arkRcon: Boolean(rcon?.eligible),
      deadLettersClear: quarantinedDeadLetters.length === 0,
      mutationSafety: mutationSafety.safeForAdvisoryObservation,
    };

    return Object.freeze({
      advisory: true,
      productionDeploymentAuthorized: false,
      ready: Object.values(gates).every(Boolean),
      reasons: [...new Set(reasons)],
      gates,
      database,
      arkRcon: rcon,
      deadLetters: {
        quarantinedCount: quarantinedDeadLetters.length,
        truncated: quarantinedDeadLetters.length >= Math.min(500, Math.max(1, Number(deadLetterLimit) || 100)),
      },
      mutationSafety,
    });
  }
}

module.exports = { CutoverReadiness };
