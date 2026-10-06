'use strict';

const { flagOn } = require('./ark-np-flags.cjs');

// Real ARN token credits require all three:
//   ARN_TOKENS_ENABLED=true
//   ARN_DRY_RUN=false
//   NEXUS_ECONOMY_WRITES_ENABLED=true
// Defaults record a no-payout trial and write no ledger rows.
function arnFlags(env = process.env) {
  const dryRaw = env.ARN_DRY_RUN;
  const dryRun = dryRaw == null || String(dryRaw).trim() === '' ? true : flagOn(dryRaw);
  const tokensEnabled = flagOn(env.ARN_TOKENS_ENABLED);
  const economyWritesEnabled = flagOn(env.NEXUS_ECONOMY_WRITES_ENABLED);
  return Object.freeze({
    dryRun,
    tokensEnabled,
    economyWritesEnabled,
    creditsEnabled: tokensEnabled === true && dryRun === false && economyWritesEnabled === true
  });
}

module.exports = { arnFlags };
