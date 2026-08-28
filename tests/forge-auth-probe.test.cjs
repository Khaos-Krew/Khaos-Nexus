'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { probeForgeAuthentication } = require('../src/sentinel/forge-auth-probe-extension.cjs');

test('Forge startup auth probe skips when bridge is disabled', async () => {
  let called = false;
  const forge = {
    configuration() {
      return {
        enabled: false,
        baseUrlConfigured: true,
        tokenConfigured: true,
        defaultBaseRef: 'rebuild/nexus-0.1'
      };
    },
    async ciStatus() {
      called = true;
      throw new Error('should not be called');
    }
  };

  const result = await probeForgeAuthentication(forge, { log() {}, warn() {} });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'disabled');
  assert.equal(called, false);
});

test('Forge startup auth probe uses authenticated zero-model CI request', async () => {
  const calls = [];
  const logs = [];
  const forge = {
    configuration() {
      return {
        enabled: true,
        baseUrlConfigured: true,
        tokenConfigured: true,
        defaultBaseRef: 'rebuild/nexus-0.1'
      };
    },
    async ciStatus(ref) {
      calls.push(ref);
      return {
        ref,
        state: 'success',
        checkRuns: [{ name: 'test', status: 'completed', conclusion: 'success' }]
      };
    }
  };

  const result = await probeForgeAuthentication(forge, {
    log(message) { logs.push(message); },
    warn() {}
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.ref, 'rebuild/nexus-0.1');
  assert.equal(result.state, 'success');
  assert.deepEqual(calls, ['rebuild/nexus-0.1']);
  assert.match(logs.join('\n'), /authenticated bridge probe: ok=true/);
  assert.match(logs.join('\n'), /tokens=0/);
});

test('Forge startup auth probe reports token/auth failures without throwing', async () => {
  const warnings = [];
  const forge = {
    configuration() {
      return {
        enabled: true,
        baseUrlConfigured: true,
        tokenConfigured: true,
        defaultBaseRef: 'rebuild/nexus-0.1'
      };
    },
    async ciStatus() {
      throw new Error('Forge request failed (401): invalid service token');
    }
  };

  const result = await probeForgeAuthentication(forge, {
    log() {},
    warn(message) { warnings.push(message); }
  });

  assert.equal(result.ok, false);
  assert.equal(result.skipped, false);
  assert.match(result.error, /401/);
  assert.match(warnings.join('\n'), /authenticated bridge probe failed/);
});
