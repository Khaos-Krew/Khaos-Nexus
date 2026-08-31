'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  configuredCacheTokenIssuerId,
  isCacheTokenIssuer,
  assertCacheTokenIssuer
} = require('../src/sentinel/ark-cache-token-auth.cjs');

const issuer = '123456789012345678';
const otherOwner = '223456789012345678';

test('cache token issuer accepts only the dedicated single Discord id', () => {
  const config = { discord: { cacheTokenIssuerUserId: issuer, ownerUserIds: [issuer, otherOwner], operatorRoleIds: ['999'] } };
  assert.equal(configuredCacheTokenIssuerId(config, {}), issuer);
  assert.equal(isCacheTokenIssuer(issuer, config, {}), true);
  assert.equal(isCacheTokenIssuer(otherOwner, config, {}), false);
  assert.equal(isCacheTokenIssuer('999999999999999999', config, {}), false);
});

test('environment issuer overrides file config without broad owner fallback', () => {
  const config = { discord: { cacheTokenIssuerUserId: otherOwner, ownerUserIds: [issuer, otherOwner] } };
  const env = { NEXUS_CACHE_TOKEN_ISSUER_USER_ID: issuer };
  assert.equal(configuredCacheTokenIssuerId(config, env), issuer);
  assert.equal(isCacheTokenIssuer(issuer, config, env), true);
  assert.equal(isCacheTokenIssuer(otherOwner, config, env), false);
});

test('missing dedicated issuer fails closed even when owner ids exist', () => {
  const config = { discord: { ownerUserIds: [issuer], operatorRoleIds: ['999'] } };
  assert.equal(configuredCacheTokenIssuerId(config, {}), '');
  assert.equal(isCacheTokenIssuer(issuer, config, {}), false);
  assert.throws(() => assertCacheTokenIssuer(issuer, config, {}), (error) => error.code === 'CACHE_TOKEN_ISSUER_NOT_CONFIGURED');
});

test('unauthorized user is rejected regardless of other roles', () => {
  const config = { discord: { cacheTokenIssuerUserId: issuer, ownerUserIds: [issuer, otherOwner], operatorRoleIds: ['999'] } };
  assert.throws(() => assertCacheTokenIssuer(otherOwner, config, {}), (error) => error.code === 'CACHE_TOKEN_ISSUER_REQUIRED');
  assert.equal(assertCacheTokenIssuer(issuer, config, {}), true);
});
