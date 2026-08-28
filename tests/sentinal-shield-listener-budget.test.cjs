'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  MIN_CLIENT_LISTENER_BUDGET,
  ensureListenerBudget
} = require('../src/sentinel/community-intents-extension.cjs');

test('Sentinal Shield reserves listener headroom above the current modular ready-hook count', () => {
  const client = new EventEmitter();
  client.setMaxListeners(20);
  const resolved = ensureListenerBudget(client);
  assert.ok(MIN_CLIENT_LISTENER_BUDGET >= 50);
  assert.equal(resolved, MIN_CLIENT_LISTENER_BUDGET);
  assert.equal(client.getMaxListeners(), resolved);
});

test('listener budget never lowers an explicitly larger operator value', () => {
  const client = new EventEmitter();
  client.setMaxListeners(64);
  const resolved = ensureListenerBudget(client);
  assert.equal(resolved, 64);
  assert.equal(client.getMaxListeners(), 64);
});
