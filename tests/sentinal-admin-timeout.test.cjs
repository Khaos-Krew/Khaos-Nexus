'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ADMIN_REQUEST_TIMEOUTS,
  SentinalAdminClient,
  isTimeoutError,
  timeoutFailure
} = require('../src/desktop/sentinal-admin-client.cjs');

test('hosted Discord operations use deadlines sized for real guild work', () => {
  assert.equal(ADMIN_REQUEST_TIMEOUTS.default, 15000);
  assert.equal(ADMIN_REQUEST_TIMEOUTS.health, 5000);
  assert.equal(ADMIN_REQUEST_TIMEOUTS.scan, 60000);
  assert.equal(ADMIN_REQUEST_TIMEOUTS.roleReconcile, 60000);
  assert.equal(ADMIN_REQUEST_TIMEOUTS.channelReconcile, 90000);
  assert.equal(ADMIN_REQUEST_TIMEOUTS.consoleRefresh, 90000);
  assert.equal(ADMIN_REQUEST_TIMEOUTS.repair, 120000);
});

test('timeout errors are reported as a Nexus timeout instead of raw AbortSignal text', async () => {
  const previous = process.env.NEXUS_TEST_SENTINAL_TIMEOUT_TOKEN;
  process.env.NEXUS_TEST_SENTINAL_TIMEOUT_TOKEN = 't'.repeat(64);
  const error = new Error('The operation was aborted due to timeout');
  error.name = 'TimeoutError';
  const client = new SentinalAdminClient({
    discord: {
      sentinalAdminUrl: 'https://sentinal.example.test',
      sentinalAdminTokenEnv: 'NEXUS_TEST_SENTINAL_TIMEOUT_TOKEN'
    }
  }, {
    fetchImpl: async () => { throw error; }
  });
  try {
    const result = await client.request('/v1/scan', { timeoutMs: ADMIN_REQUEST_TIMEOUTS.scan });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'SENTINAL_ADMIN_TIMEOUT');
    assert.match(result.message, /Discord scan did not finish within 60 seconds/i);
    assert.doesNotMatch(result.message, /aborted due to timeout/i);
  } finally {
    if (previous === undefined) delete process.env.NEXUS_TEST_SENTINAL_TIMEOUT_TOKEN;
    else process.env.NEXUS_TEST_SENTINAL_TIMEOUT_TOKEN = previous;
  }
});

test('timeout helper recognizes Node fetch timeout variants', () => {
  const timeout = new Error('The operation was aborted due to timeout');
  timeout.name = 'TimeoutError';
  assert.equal(isTimeoutError(timeout), true);
  assert.equal(isTimeoutError(Object.assign(new Error('request timeout'), { name: 'AbortError' })), true);
  assert.equal(isTimeoutError(new Error('connection refused')), false);
  assert.equal(timeoutFailure('/v1/repair', ADMIN_REQUEST_TIMEOUTS.repair).code, 'SENTINAL_ADMIN_TIMEOUT');
});
