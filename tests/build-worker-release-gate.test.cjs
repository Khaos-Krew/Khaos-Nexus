'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateSentinalRelease } = require('../src/build-worker/release-gate.cjs');
const { normalizeCommands } = require('../src/build-worker/executor.cjs');
const { loadConfig } = require('../src/build-worker/config.cjs');

const healthyRelease = {
  target: 'KNX-SENTINAL-CORE-PROD', artifact_type: 'SENTINAL_RUNTIME',
  build_status: 'passed', test_status: 'passed', validation_status: 'passed', approval_status: 'approved'
};

test('Sentinal deployment requires an approved fully validated runtime release', () => {
  assert.deepEqual(evaluateSentinalRelease(healthyRelease), { allowed: true, reasons: [] });
  assert.equal(evaluateSentinalRelease({ ...healthyRelease, artifact_type: 'ARK_CONFIG' }).allowed, false);
  assert.ok(evaluateSentinalRelease({ ...healthyRelease, validation_status: 'failed' }).reasons.includes('validation_not_passed'));
});

test('worker command payload is structured and allowlisted', () => {
  assert.deepEqual(normalizeCommands({ commands: [{ command: 'npm', args: ['test'] }] }), [{ command: 'npm', args: ['test'] }]);
  assert.throws(() => normalizeCommands({ commands: [{ command: 'sh', args: ['-c', 'anything'] }] }), /not permitted/);
});

test('node identity and lane are validated', () => {
  const config = loadConfig({ NODE_ID: 'KNX-BUILD-NODE-01', NODE_LANE: 'forge', DATABASE_URL: 'postgres://localhost/nexus' });
  assert.equal(config.nodeId, 'KNX-BUILD-NODE-01');
  assert.equal(config.lane, 'forge');
  assert.throws(() => loadConfig({ NODE_ID: 'node-one', DATABASE_URL: 'postgres://localhost/nexus' }), /NODE_ID/);
});
