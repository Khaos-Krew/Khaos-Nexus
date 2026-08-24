'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SENTINAL_CLIENT_LISTENER_BUDGET,
  ensureSentinalListenerBudget
} = require('../src/sentinel/nexus-status-extension.cjs');

test('Sentinal raises the Discord client listener budget before modular ready hooks attach', () => {
  let max = 10;
  const client = {
    getMaxListeners: () => max,
    setMaxListeners: (value) => { max = Number(value); }
  };
  assert.equal(ensureSentinalListenerBudget(client), SENTINAL_CLIENT_LISTENER_BUDGET);
  assert.equal(max, 20);
});

test('Sentinal never lowers a preconfigured higher listener budget', () => {
  let max = 30;
  const client = {
    getMaxListeners: () => max,
    setMaxListeners: (value) => { max = Number(value); }
  };
  assert.equal(ensureSentinalListenerBudget(client), 30);
  assert.equal(max, 30);
});
