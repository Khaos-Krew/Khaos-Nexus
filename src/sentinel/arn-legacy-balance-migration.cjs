'use strict';

// Owner decision is still open. This does not read MySQL, does not write the
// main ledger, and is not called from worker boot or the SQL migration runner.
function migrateLegacyArnBalances() {
  return { ok: false, reason: 'pending-owner-decision', applied: false };
}

module.exports = { migrateLegacyArnBalances };
