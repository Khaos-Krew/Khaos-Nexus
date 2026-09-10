'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { backendMode, fallbackEnabled, classifyReloadResult, classifyRewardResult } = require('../src/sentinel/rewards-ascended-delivery.cjs');

test('RewardsAscended is the default and Dino Depot fallback requires explicit opt-in', () => {
  assert.equal(backendMode({}), 'rewardsascended');
  assert.equal(backendMode({ NEXUS_DINO_CACHE_DELIVERY_BACKEND: 'dinodepot' }), 'dinodepot');
  assert.throws(() => backendMode({ NEXUS_DINO_CACHE_DELIVERY_BACKEND: 'unknown' }));
  for (const value of [undefined, '', 'false', '0', 'yes', 'typo']) {
    assert.equal(fallbackEnabled({ NEXUS_DINO_CACHE_DINODEPOT_FALLBACK: value }), false);
  }
  assert.equal(fallbackEnabled({ NEXUS_DINO_CACHE_DINODEPOT_FALLBACK: 'true' }), true);
});

test('reload readiness requires the exact acknowledgement, not transport success', () => {
  assert.equal(classifyReloadResult({ response: 'Reloaded config' }).ok, true);
  for (const response of ['', 'Success', 'Unknown command', 'Failed to reload config', 'Reloaded config with error']) {
    assert.equal(classifyReloadResult({ status: 'success', response }).ok, false);
  }
  assert.equal(classifyReloadResult({ status: 'sent_no_reply' }).ok, false);
});

test('only the reward acknowledgement proves delivery; ambiguous replies remain held', () => {
  assert.equal(classifyRewardResult({ response: 'Player rewarded!' }).state, 'DELIVERED');
  for (const response of ['', 'Success', 'Server received', 'Player rewarded! extra']) {
    assert.equal(classifyRewardResult({ status: 'success', response }).state, 'SENT_UNCONFIRMED');
  }
  assert.equal(classifyRewardResult({ status: 'sent_no_reply' }).state, 'SENT_UNCONFIRMED');
  assert.equal(classifyRewardResult({ response: 'Failed to give reward to player' }).state, 'DELIVERY_FAILED');
});
