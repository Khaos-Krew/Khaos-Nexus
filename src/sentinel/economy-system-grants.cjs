'use strict';

const { normalizeCurrency } = require('./nexus-economy-postgres-repository.cjs');

const SYSTEM_GRANT_SOURCES = Object.freeze(['community-level-up', 'birthday-gift']);

function systemGrantsEnabled(env = process.env) {
  return ['1', 'true', 'yes', 'on'].includes(String(env?.NEXUS_ECONOMY_SYSTEM_GRANTS_ENABLED || '').trim().toLowerCase());
}

function evaluateSystemGrant(input = {}, env = process.env) {
  const source = String(input.source || '').trim();
  if (!SYSTEM_GRANT_SOURCES.includes(source)) return { applies: false, ok: true };
  if (!systemGrantsEnabled(env)) {
    return { applies: true, ok: false, skipped: 'system-grants-disabled', source };
  }
  const type = String(input.type || 'credit').trim();
  if (type !== 'credit') return { applies: true, ok: false, skipped: 'credit-only', source };
  if (input.currency != null && input.currency !== '') {
    let currency = null;
    try { currency = normalizeCurrency(input.currency); } catch { currency = null; }
    if (currency !== 'NEXUS_COINS') return { applies: true, ok: false, skipped: 'coins-only', source };
  }
  return { applies: true, ok: true, source };
}

module.exports = {
  SYSTEM_GRANT_SOURCES,
  systemGrantsEnabled,
  evaluateSystemGrant
};
