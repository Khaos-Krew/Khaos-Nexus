'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const entry = fs.readFileSync(path.resolve(__dirname, '../src/sentinel/entry.cjs'), 'utf8');
const runtime = require('../src/sentinel/arkshop-backend-preflight-runtime.cjs');

test('Sentinal entry installs the ArkShop backend preflight runtime', () => {
  assert.match(entry, /arkshop-backend-preflight-runtime\.cjs'\)\.installArkShopBackendPreflightRuntime\(\)/);
});

test('backend preflight remains dormant without an explicit one-time token', () => {
  const previous = process.env[runtime.ENV_KEY];
  delete process.env[runtime.ENV_KEY];
  try {
    assert.equal(runtime.requestToken(), '');
    assert.deepEqual(runtime.installArkShopBackendPreflightRuntime({ delayMs: 5000 }), { enabled: false });
  } finally {
    if (previous === undefined) delete process.env[runtime.ENV_KEY];
    else process.env[runtime.ENV_KEY] = previous;
  }
});
