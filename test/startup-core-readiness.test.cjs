'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  readiness
} = require('../shared/startup-core-readiness.cjs');

function check(id, status, critical = true, detail = '') {
  return { id, status, critical, detail, label: id };
}

function healthyState(overrides = {}) {
  return {
    configStoreReady: true,
    rendererBridgeReady: true,
    rendererModulesReady: false,
    authObserved: true,
    checks: [
      check('profile-location', 'pass'),
      check('config-file', 'pass'),
      check('data-integrity', 'pass'),
      check('data-write', 'pass'),
      check('secure-storage', 'pass'),
      check('config-store', 'pass'),
      check('renderer-bridge', 'pass'),
      check('logger', 'pass', false),
      check('discord-restore', 'warn', false, 'Discord is signed out.'),
      check('renderer-modules', 'running', true, 'Optional modules are still loading.')
    ],
    ...overrides
  };
}

test('the exact live 94 percent state is releasable', () => {
  const result = readiness(healthyState());
  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.discordDesktopSignInRequired, false);
  assert.equal(result.optionalModuleCompletionRequired, false);
});

test('signed-out Discord never blocks local startup even when marked critical by stale data', () => {
  const state = healthyState();
  state.checks = state.checks.map((entry) => entry.id === 'discord-restore'
    ? check('discord-restore', 'fail', true, 'Signed out')
    : entry);
  const result = readiness(state);
  assert.equal(result.ready, true);
});

test('optional renderer module completion never blocks the core interface', () => {
  const state = healthyState();
  state.checks = state.checks.map((entry) => entry.id === 'renderer-modules'
    ? check('renderer-modules', 'fail', true, 'One optional module timed out')
    : entry);
  const result = readiness(state);
  assert.equal(result.ready, true);
});

test('a missing protected renderer bridge remains blocking', () => {
  const result = readiness(healthyState({ rendererBridgeReady: false }));
  assert.equal(result.ready, false);
  assert.match(result.blockers.join(' | '), /protected renderer bridge is not ready/);
});

test('configuration, data integrity, and write failures remain blocking', () => {
  for (const id of ['config-store', 'data-integrity', 'data-write']) {
    const state = healthyState();
    state.checks = state.checks.map((entry) => entry.id === id
      ? check(id, 'fail', true, `${id} failed`)
      : entry);
    const result = readiness(state);
    assert.equal(result.ready, false, `${id} should block startup`);
    assert.match(result.blockers.join(' | '), new RegExp(id));
  }
});

test('a new profile warning and secure-storage warning are allowed when core services work', () => {
  const state = healthyState();
  state.checks = state.checks.map((entry) => {
    if (entry.id === 'config-file') return check('config-file', 'warn', false, 'New profile');
    if (entry.id === 'secure-storage') return check('secure-storage', 'warn', false, 'No saved credentials');
    return entry;
  });
  const result = readiness(state);
  assert.equal(result.ready, true);
});
