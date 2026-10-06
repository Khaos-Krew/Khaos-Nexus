'use strict';

const { flagOn } = require('./ark-np-flags.cjs');

function oddsBp(raw, fallback) {
  if (raw == null || String(raw).trim() === '') return fallback;
  const value = Number(String(raw).trim());
  if (!Number.isInteger(value) || value < 0 || value > 10000) return fallback;
  return value;
}

// Live ledger writes require the economy-writes gate (or the narrow ARN gate)
// and a per-type drop flag. Presence writes never open this gate.
// ARN_DRY_RUN defaults on, so the trial records rolls and writes no ledger rows.
function arnFlags(env = process.env) {
  const dryRaw = env.ARN_DRY_RUN;
  const dryRun = dryRaw == null || String(dryRaw).trim() === '' ? true : flagOn(dryRaw);
  const economyWritesEnabled = flagOn(env.NEXUS_ECONOMY_WRITES_ENABLED);
  const arnEconomyWritesEnabled = flagOn(env.ARN_ECONOMY_WRITES_ENABLED);
  const writesEnabled = economyWritesEnabled === true || arnEconomyWritesEnabled === true;
  const tameDropsEnabled = flagOn(env.ARN_TAME_DROPS_ENABLED);
  const killDropsEnabled = flagOn(env.ARN_KILL_DROPS_ENABLED);
  return Object.freeze({
    dryRun,
    writesEnabled,
    economyWritesEnabled,
    arnEconomyWritesEnabled,
    tameDropsEnabled,
    killDropsEnabled,
    tameOddsBp: oddsBp(env.ARN_TAME_ODDS_BP, 2500),
    killOddsBp: oddsBp(env.ARN_KILL_ODDS_BP, 1000),
    dropsEnabled(kind) {
      return kind === 'kill' ? killDropsEnabled === true : tameDropsEnabled === true;
    },
    creditsEnabled: writesEnabled === true && dryRun === false
  });
}

module.exports = { arnFlags };
