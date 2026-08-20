'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mobileOwnerTestEnabled, DISABLE_VARIABLE } = require('../shared/mobile-owner-test-policy.cjs');

test('mobile owner-test track is enabled by default on its isolated branch', () => {
  assert.equal(mobileOwnerTestEnabled({}), true);
  assert.equal(mobileOwnerTestEnabled({ [DISABLE_VARIABLE]: '' }), true);
  assert.equal(mobileOwnerTestEnabled({ [DISABLE_VARIABLE]: '0' }), true);
});

test('mobile owner-test track retains an explicit emergency kill switch', () => {
  for (const value of ['1', 'true', 'TRUE', 'yes', 'on']) {
    assert.equal(mobileOwnerTestEnabled({ [DISABLE_VARIABLE]: value }), false);
  }
});
