'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseListPlayersCount, occupiedOrUnknown } = require('./ark-restart-safety.cjs');

test('parseListPlayersCount recognizes empty server responses', () => {
  assert.equal(parseListPlayersCount('No Players Connected'), 0);
  assert.equal(parseListPlayersCount(''), 0);
});

test('parseListPlayersCount counts standard ARK ListPlayers rows', () => {
  assert.equal(parseListPlayersCount('1. PlayerOne, 123\n2. PlayerTwo, 456'), 2);
});

test('unknown ListPlayers output fails closed', () => {
  assert.equal(parseListPlayersCount('unexpected response'), null);
  assert.equal(occupiedOrUnknown(null), true);
  assert.equal(occupiedOrUnknown(1), true);
  assert.equal(occupiedOrUnknown(0), false);
});
