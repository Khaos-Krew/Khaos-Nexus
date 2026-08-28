'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { clusterRuntimeSignature } = require('../src/sentinel/ark-cluster-extension.cjs');

test('ARK runtime signature changes only when tracked public runtime state changes', () => {
  const online = [{ id: 'gen1', runtime: { state: 'online', playerCount: 1, lastError: '' } }];
  const sameStateDifferentPlayers = [{ id: 'gen1', runtime: { state: 'online', playerCount: 8, lastError: '' } }];
  const offline = [{ id: 'gen1', runtime: { state: 'offline', playerCount: 0, lastError: 'RCON timed out' } }];
  assert.equal(clusterRuntimeSignature(online), clusterRuntimeSignature(sameStateDifferentPlayers));
  assert.notEqual(clusterRuntimeSignature(online), clusterRuntimeSignature(offline));
});
