'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sentinalArnLegacyEnabled } = require('../src/sentinel/arn-legacy-mode.cjs');

test('Sentinal ARN legacy tracking defaults enabled for rollback safety', () => {
  assert.equal(sentinalArnLegacyEnabled(undefined), true);
  assert.equal(sentinalArnLegacyEnabled(''), true);
  assert.equal(sentinalArnLegacyEnabled('true'), true);
  assert.equal(sentinalArnLegacyEnabled('1'), true);
});

test('Sentinal ARN legacy tracking disables on explicit false values', () => {
  for (const value of ['false', '0', 'off', 'no', ' FALSE ']) {
    assert.equal(sentinalArnLegacyEnabled(value), false);
  }
});
