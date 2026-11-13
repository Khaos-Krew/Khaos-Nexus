'use strict';

// One switch for Sentinal's ARK runtime (monitors, probes, pollers, HTTP hooks,
// ARN). Default ON so nothing changes unless NEXUS_ARK_ENABLED is set to a
// false value. ARK code stays in the repo; flipping the switch back to true
// restores it. ARN (ARK notifications) follows the ARK switch, and can also be
// turned off on its own with NEXUS_ARN_ENABLED=false.
const FALSE_VALUES = /^(0|false|no|off)$/i;

function flagOn(value) {
  if (value === undefined || value === null || String(value).trim() === '') return true;
  return !FALSE_VALUES.test(String(value).trim());
}

function arkEnabled(env = process.env) {
  return flagOn(env.NEXUS_ARK_ENABLED);
}

function arnEnabled(env = process.env) {
  return arkEnabled(env) && flagOn(env.NEXUS_ARN_ENABLED);
}

module.exports = { arkEnabled, arnEnabled };
