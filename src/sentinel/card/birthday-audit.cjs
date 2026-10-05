'use strict';

const FORBIDDEN_KEYS = new Set([
  'month',
  'day',
  'timezone',
  'tz',
  'timeZone',
  'age',
  'birthYear',
  'birthDay',
  'date',
  'birthday',
  'scheduledAt',
  'revealExpiresAt',
  'readyAt'
]);

function harvestSecrets(value, bucket) {
  if (Array.isArray(value)) {
    for (const item of value) harvestSecrets(item, bucket);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key) && typeof item === 'string' && item.length >= 3) bucket.push(item);
    harvestSecrets(item, bucket);
  }
}

function sanitizeBirthdayAudit(row, secrets = []) {
  const harvested = [];
  harvestSecrets(row, harvested);
  const hidden = [...secrets, ...harvested]
    .map((secret) => String(secret || ''))
    .filter((secret) => secret.length >= 3);
  function walk(value) {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object') {
      if (typeof value !== 'string' || !hidden.length) return value;
      let next = value;
      for (const secret of hidden) next = next.split(secret).join('');
      return next;
    }
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      out[key] = walk(item);
    }
    return out;
  }
  return walk(row);
}

async function writeBirthdayAudit(audit, row, secrets = []) {
  if (!audit || typeof audit.append !== 'function') return null;
  const clean = sanitizeBirthdayAudit(row, secrets);
  return audit.append(clean);
}

module.exports = {
  FORBIDDEN_KEYS,
  sanitizeBirthdayAudit,
  writeBirthdayAudit
};
