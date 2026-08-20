'use strict';

const DISABLE_VARIABLE = 'KHAOS_NEXUS_MOBILE_OWNER_TEST_DISABLED';

function mobileOwnerTestEnabled(env = process.env) {
  const value = String(env?.[DISABLE_VARIABLE] ?? '').trim().toLowerCase();
  return !['1', 'true', 'yes', 'on'].includes(value);
}

module.exports = { DISABLE_VARIABLE, mobileOwnerTestEnabled };
