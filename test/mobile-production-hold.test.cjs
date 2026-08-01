'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mobileGatewayPolicyEnabled,
  holdModule,
  holdRuntime,
  ENABLE_VARIABLE
} = require('../main/mobile-production-hold-extension.cjs');

test('Mobile Gateway production policy is off unless the exact value is 1', () => {
  for (const value of [undefined, '', '0', 'false', 'TRUE', 'enabled', ' 1 ']) {
    assert.equal(mobileGatewayPolicyEnabled({ [ENABLE_VARIABLE]: value }), false);
  }
  assert.equal(mobileGatewayPolicyEnabled({ [ENABLE_VARIABLE]: '1' }), true);
});

test('paused Mobile Gateway catalog entry has no launch route', () => {
  const module = holdModule({
    id: 'mobile-gateway',
    stage: 'live',
    availability: 'implemented',
    launchView: 'mobile-companion',
    description: 'active'
  });
  assert.equal(module.availability, 'paused');
  assert.equal(module.launchView, null);
  assert.equal(module.paused, true);
  assert.match(module.description, /Paused and unavailable by Owner directive/);
});

test('paused Mobile Gateway runtime cannot be reactivated by saved state', () => {
  const runtime = holdRuntime({
    id: 'mobile-gateway',
    requestedEnabled: true,
    effectiveEnabled: true,
    reason: 'enabled',
    availability: 'implemented'
  });
  assert.equal(runtime.requestedEnabled, false);
  assert.equal(runtime.effectiveEnabled, false);
  assert.equal(runtime.reason, 'paused-by-owner-directive');
  assert.equal(runtime.availability, 'paused');
});

test('unrelated modules are not changed', () => {
  const module = { id: 'discord-runtime', availability: 'implemented' };
  assert.equal(holdModule(module), module);
});
