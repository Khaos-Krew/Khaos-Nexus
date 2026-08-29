'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizePluginInfo, compatibilitySummary } = require('../src/sentinel/arkshop-live-compatibility-probe.cjs');
const runtime = require('../src/sentinel/arkshop-live-compatibility-runtime.cjs');

test('plugin metadata is reduced to non-secret compatibility fields', () => {
  const safe = sanitizePluginInfo({
    FullName: 'Ark:SA ArkShop', Version: 1.8, MinApiVersion: 2.0,
    PreventUnloading: false, Dependencies: ['Permissions'], Secret: 'do-not-log'
  });
  assert.deepEqual(safe, {
    fullName: 'Ark:SA ArkShop', version: '1.8', minApiVersion: '2', preventUnloading: false, dependencies: ['Permissions']
  });
  assert.equal(JSON.stringify(safe).includes('do-not-log'), false);
});

test('planned MX-E UI requires confirmed ArkShop 1.8 and ArkShopUI 1.8 family', () => {
  const good = compatibilitySummary({
    arkshop: { present: true, info: { version: '1.8' } },
    arkshopui: { present: true, info: { version: '1.8A' } }
  });
  assert.equal(good.compatibleWithPlannedShopUi, true);
  assert.deepEqual(good.blockers, []);

  const bad = compatibilitySummary({
    arkshop: { present: true, info: { version: '1.7' } },
    arkshopui: { present: false, info: null }
  });
  assert.equal(bad.compatibleWithPlannedShopUi, false);
  assert.ok(bad.blockers.includes('arkshop-version-not-1.8'));
  assert.ok(bad.blockers.includes('arkshopui-plugininfo-missing'));
});

test('runtime compatibility probe remains dormant without explicit one-time token', () => {
  const previous = process.env[runtime.ENV_KEY];
  delete process.env[runtime.ENV_KEY];
  try {
    assert.equal(runtime.token(), '');
    assert.deepEqual(runtime.installArkShopCompatibilityProbeRuntime({ delayMs: 5000 }), { enabled: false });
  } finally {
    if (previous === undefined) delete process.env[runtime.ENV_KEY];
    else process.env[runtime.ENV_KEY] = previous;
  }
});