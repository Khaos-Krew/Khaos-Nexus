'use strict';

function errorText(value) {
  if (value instanceof Error) return `${value.code || ''} ${value.message || ''} ${value.stack || ''}`;
  if (value && typeof value === 'object') return `${value.code || ''} ${value.message || ''} ${value.stack || ''}`;
  return String(value || '');
}

function isExpectedAccessDenial(value) {
  const text = errorText(value).toLowerCase();
  if (!text) return false;
  if (/\baccess_denied\b/.test(text)) return true;
  const requiresRole = /requires\s+(viewer|operator|owner)\s+access/.test(text);
  const authorizationReason = /sign in with an authorized discord account|discord account is not approved|configured owner account|desktop access control|access control is enabled/.test(text);
  return requiresRole && authorizationReason;
}

module.exports = { errorText, isExpectedAccessDenial };
