'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FIXED_LAUNCH_LEVEL,
  CACHE_IDS,
  cacheEntry,
  cacheShopId,
  validateCatalog
} = require('../src/sentinel/arkshop-nexus-launch-v11-inshop-caches-startup.cjs');
const configRuntime = require('../src/sentinel/dinodepot-nexus-cache-config-runtime.cjs');
const shopRuntime = require('../src/sentinel/arkshop-nexus-launch-v11-inshop-caches-runtime.cjs');

test('V11 defines six non-Apex in-shop caches with Dino Depot category commands', () => {
  assert.equal(validateCatalog(), true);
  assert.equal(CACHE_IDS.length, 6);
  assert.equal(CACHE_IDS.includes('apex'), false);
  for (const cacheId of CACHE_IDS) {
    const entry = cacheEntry(cacheId);
    assert.equal(entry.Type, 'command');
    assert.match(cacheShopId(cacheId), /^dino_cache_/);
    assert.match(entry.Items[0].Command, new RegExp(`-t=nexus_${cacheId}`));
    assert.match(entry.Items[0].Command, new RegExp(`-l=${FIXED_LAUNCH_LEVEL}`));
    assert.equal(entry.Items[0].ExecuteAsAdmin, true);
  }
});

test('Dino Depot and V11 cache deployment runtimes remain opt-in', () => {
  for (const runtime of [configRuntime, shopRuntime]) {
    const previous = process.env[runtime.ENV_KEY];
    try {
      delete process.env[runtime.ENV_KEY];
      assert.equal(runtime.requested(), false);
      process.env[runtime.ENV_KEY] = 'true';
      assert.equal(runtime.requested(), true);
      process.env[runtime.ENV_KEY] = 'false';
      assert.equal(runtime.requested(), false);
    } finally {
      if (previous === undefined) delete process.env[runtime.ENV_KEY];
      else process.env[runtime.ENV_KEY] = previous;
    }
  }
});
