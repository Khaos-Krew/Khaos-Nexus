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
  assert.ok(resolved >= 40);
  assert.equal(client.getMaxListeners(), resolved);
  assert.equal(MIN_CLIENT_LISTENER_BUDGET, 40);
});

test('listener budget never lowers an explicitly larger operator value', () => {
  const client = new EventEmitter();
  client.setMaxListeners(64);
  const resolved = ensureListenerBudget(client);
  assert.equal(resolved, 64);
  assert.equal(client.getMaxListeners(), 64);
});
