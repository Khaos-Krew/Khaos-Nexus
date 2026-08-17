'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CAPABILITIES,
  capabilitiesForRole,
  evaluateCapabilities,
  assertCapabilities
} = require('../shared/nexus-core/capability-registry.cjs');

test('viewer policy remains read-only for privileged operations', () => {
  const decision = evaluateCapabilities({ role: 'viewer' }, ['game.server.read', 'game.server.restart']);
  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.denied, ['game.server.restart']);
  assert.equal(decision.reason, 'missing-capability');
});

test('operator policy permits guarded operations but not owner-only authority', () => {
  assert.equal(evaluateCapabilities({ role: 'operator' }, [
    'game.server.save',
    'game.server.broadcast',
    'game.server.restart',
    'scheduler.manage'
  ]).allowed, true);

  const ownerOnly = evaluateCapabilities({ role: 'operator' }, ['secrets.manage', 'updates.install', 'release.manage']);
  assert.equal(ownerOnly.allowed, false);
  assert.deepEqual(ownerOnly.denied, ['release.manage', 'secrets.manage', 'updates.install']);
});

test('community manager policy is Discord-focused and cannot inherit server or secret authority', () => {
  assert.equal(evaluateCapabilities({ role: 'community-manager' }, [
    'discord.content.manage',
    'discord.roles.manage',
    'discord.structure.manage',
    'discord.members.moderate'
  ]).allowed, true);

  const decision = evaluateCapabilities({ role: 'community-manager' }, [
    'game.server.restart',
    'scheduler.manage',
    'secrets.manage'
  ]);
  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.denied, ['game.server.restart', 'scheduler.manage', 'secrets.manage']);
});

test('explicit runtime denial overrides even owner capability grants', () => {
  const decision = evaluateCapabilities({
    role: 'owner',
    deniedCapabilities: ['game.console.raw', 'release.manage']
  }, ['game.console.raw', 'game.server.restart']);

  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.denied, ['game.console.raw']);
  assert.equal(decision.granted.includes('release.manage'), false);
});

test('unknown required capabilities fail closed', () => {
  const decision = evaluateCapabilities({ role: 'owner' }, ['future.unregistered.action']);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'unknown-capability');
  assert.deepEqual(decision.unknown, ['future.unregistered.action']);
});

test('AI-like subjects can be narrowed to explicit proposal/read grants without role escalation', () => {
  const decision = evaluateCapabilities({
    role: 'locked',
    grantedCapabilities: ['nexus.view', 'game.server.read', 'ai.use']
  }, ['game.server.read']);
  assert.equal(decision.allowed, true);
  assert.equal(decision.granted.includes('game.server.restart'), false);
  assert.equal(decision.granted.includes('secrets.manage'), false);
});

test('assertCapabilities returns the decision or throws a structured denial', () => {
  const allowed = assertCapabilities({ role: 'operator' }, ['backup.create'], 'Create backup');
  assert.equal(allowed.allowed, true);

  assert.throws(() => assertCapabilities({ role: 'viewer' }, ['backup.restore'], 'Restore backup'), (error) => {
    assert.equal(error.code, 'NEXUS_CAPABILITY_DENIED');
    assert.equal(error.decision.allowed, false);
    return true;
  });
});

test('role capability lists reference only registered capabilities', () => {
  for (const role of ['locked', 'viewer', 'operator', 'community-manager', 'owner', 'local-admin']) {
    for (const capability of capabilitiesForRole(role)) assert.ok(CAPABILITIES[capability], `${role} references ${capability}`);
  }
});
