'use strict';

function sentinalArnLegacyEnabled(value = process.env.SENTINAL_ARN_LEGACY_ENABLED) {
  if (value === undefined || value === null || String(value).trim() === '') return true;
  return !/^(0|false|no|off)$/i.test(String(value).trim());
}

module.exports = { sentinalArnLegacyEnabled };
