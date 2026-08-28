'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { noPlayers, safeRequest } = require('../src/sentinel/ark-controlled-api-restart-test.cjs');

test('controlled API restart only accepts an empty ARK server', () => {
  assert.equal(noPlayers('No Players Connected'), true);
  assert.equal(noPlayers(''), true);
  assert.equal(noPlayers('0. PlayerName, EOSID'), false);
});

test('controlled API restart request token is bounded and safe for paths', () => {
  assert.equal(safeRequest('api-test-20260828'), 'api-test-20260828');
  assert.throws(() => safeRequest('../escape'));
  assert.throws(() => safeRequest('short'));
});
