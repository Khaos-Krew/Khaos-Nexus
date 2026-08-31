'use strict';

function cleanDiscordId(value) {
  return String(value || '').trim();
}

function configuredCacheTokenIssuerId(config = {}, env = process.env) {
  const id = cleanDiscordId(env.NEXUS_CACHE_TOKEN_ISSUER_USER_ID || config.discord?.cacheTokenIssuerUserId);
  return /^\d{5,25}$/.test(id) ? id : '';
}

function isCacheTokenIssuer(userId, config = {}, env = process.env) {
  const issuerId = configuredCacheTokenIssuerId(config, env);
  return Boolean(issuerId && cleanDiscordId(userId) === issuerId);
}

function assertCacheTokenIssuer(userId, config = {}, env = process.env) {
  const issuerId = configuredCacheTokenIssuerId(config, env);
  if (!issuerId) {
    const error = new Error('Nexus Cache Token issuance is locked because the single issuer Discord ID is not configured.');
    error.code = 'CACHE_TOKEN_ISSUER_NOT_CONFIGURED';
    throw error;
  }
  if (cleanDiscordId(userId) !== issuerId) {
    const error = new Error('Only the configured Nexus Cache Token issuer can perform this action.');
    error.code = 'CACHE_TOKEN_ISSUER_REQUIRED';
    throw error;
  }
  return true;
}

module.exports = {
  cleanDiscordId,
  configuredCacheTokenIssuerId,
  isCacheTokenIssuer,
  assertCacheTokenIssuer
};
