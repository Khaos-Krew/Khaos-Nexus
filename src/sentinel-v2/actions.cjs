'use strict';

class ActionGate {
  constructor({ mutationEnabled = false, dryRun = true, allow = [] } = {}) {
    this.mutationEnabled = Boolean(mutationEnabled);
    this.dryRun = Boolean(dryRun);
    this.allow = new Set(allow);
  }

  authorize({ capability, destructive = false } = {}) {
    const name = String(capability || '').trim();
    if (!name) return { allowed: false, reason: 'missing-capability' };
    if (!this.mutationEnabled) return { allowed: false, reason: 'mutations-disabled' };
    if (this.dryRun) return { allowed: false, reason: 'dry-run' };
    if (this.allow.size && !this.allow.has(name)) return { allowed: false, reason: 'not-allowlisted' };
    if (destructive) return { allowed: false, reason: 'approval-required' };
    return { allowed: true, reason: 'authorized' };
  }
}

module.exports = { ActionGate };
