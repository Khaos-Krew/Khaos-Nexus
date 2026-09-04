'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_DINO_LIFETIME_MAX_MS,
  DEFAULT_EXPIRY_GRACE_MS,
  parseDurationMs,
  resolveLifecyclePolicy,
  pruneStaleActive
} = require('../src/sentinel/arn-lifecycle-policy.cjs');

test('parses Shiny-style duration values', () => {
  assert.equal(parseDurationMs('30m'), 30 * 60 * 1000);
  assert.equal(parseDurationMs('8h'), 8 * 60 * 60 * 1000);
  assert.equal(parseDurationMs('1d'), 24 * 60 * 60 * 1000);
});

test('defaults to Shiny max lifetime plus small expiry grace', () => {
  const policy = resolveLifecyclePolicy({});
  assert.equal(policy.maxLifetimeMs, DEFAULT_DINO_LIFETIME_MAX_MS);
  assert.equal(policy.graceMs, DEFAULT_EXPIRY_GRACE_MS);
  assert.equal(policy.hardExpiryMs, DEFAULT_DINO_LIFETIME_MAX_MS + DEFAULT_EXPIRY_GRACE_MS);
});

test('custom lifetime mirrors configured Shiny maximum', () => {
  const policy = resolveLifecyclePolicy({
    ARN_SHINY_DINO_LIFETIME_MAX: '12h',
    ARN_SHINY_EXPIRY_GRACE: '10m'
  });
  assert.equal(policy.hardExpiryMs, (12 * 60 + 10) * 60 * 1000);
});

test('zero lifetime disables forced expiry to match never-despawn Shiny config', () => {
  const policy = resolveLifecyclePolicy({ ARN_SHINY_DINO_LIFETIME_MAX: '0' });
  assert.equal(policy.hardExpiryMs, 0);
});

test('removes only stale ACTIVE anomalies', () => {
  const now = 2_000_000_000_000;
  const anomalies = new Map([
    ['stale', { status: 'ACTIVE', dinoName: 'Rainbow Manta', mapName: 'Astraeos', detectedAt: now - (9 * 60 * 60 * 1000) }],
    ['fresh', { status: 'ACTIVE', dinoName: 'Enraged Rex', mapName: 'Genesis 1', detectedAt: now - (2 * 60 * 60 * 1000) }],
    ['resolved', { status: 'CAPTURED', dinoName: 'Luna Sabertooth', mapName: 'Genesis 1', detectedAt: now - (20 * 60 * 60 * 1000) }]
  ]);
  const removed = pruneStaleActive(anomalies, now, resolveLifecyclePolicy({}));
  assert.equal(removed.length, 1);
  assert.equal(removed[0].key, 'stale');
  assert.equal(anomalies.has('stale'), false);
  assert.equal(anomalies.has('fresh'), true);
  assert.equal(anomalies.has('resolved'), true);
});
