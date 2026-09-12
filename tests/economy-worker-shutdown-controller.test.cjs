'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ECONOMY_FORCE_SHUTDOWN_MS,
  createEconomyShutdownController,
} = require('../src/economy-worker/shutdown-controller.cjs');

test('economy shutdown starts drain only once across multiple signals', () => {
  const calls = [];
  const timer = { unref() { calls.push(['unref']); } };
  let onClosed;

  const shutdown = createEconomyShutdownController({
    runtime: {
      beginDrain(signal) {
        calls.push(['beginDrain', signal]);
      },
    },
    server: { close() {} },
    beginHttpDrain(server, callback) {
      calls.push(['beginHttpDrain', server]);
      onClosed = callback;
    },
    setTimer(callback, delay) {
      calls.push(['setTimer', delay]);
      timer.callback = callback;
      return timer;
    },
    clearTimer(value) {
      calls.push(['clearTimer', value]);
    },
    exit(code) {
      calls.push(['exit', code]);
    },
    log(message) {
      calls.push(['log', message]);
    },
  });

  assert.equal(shutdown('SIGTERM'), true);
  assert.equal(shutdown('SIGINT'), false);

  assert.equal(calls.filter(([name]) => name === 'beginDrain').length, 1);
  assert.equal(calls.filter(([name]) => name === 'beginHttpDrain').length, 1);
  assert.equal(calls.filter(([name]) => name === 'setTimer').length, 1);
  assert.equal(calls.filter(([name]) => name === 'log').length, 1);
  assert.deepEqual(calls.find(([name]) => name === 'beginDrain'), ['beginDrain', 'SIGTERM']);
  assert.deepEqual(calls.find(([name]) => name === 'setTimer'), ['setTimer', ECONOMY_FORCE_SHUTDOWN_MS]);

  onClosed();
  assert.ok(calls.some(([name, value]) => name === 'clearTimer' && value === timer));
  assert.ok(calls.some(([name, code]) => name === 'exit' && code === 0));
});

test('economy shutdown retains a bounded forced-exit fallback', () => {
  const exits = [];
  let forceExit;

  const shutdown = createEconomyShutdownController({
    runtime: { beginDrain() {} },
    server: { close() {} },
    beginHttpDrain() {},
    setTimer(callback, delay) {
      assert.equal(delay, ECONOMY_FORCE_SHUTDOWN_MS);
      forceExit = callback;
      return { unref() {} };
    },
    exit(code) {
      exits.push(code);
    },
    log() {},
  });

  shutdown('SIGTERM');
  forceExit();
  assert.deepEqual(exits, [1]);
});

test('economy shutdown controller fails closed on incomplete dependencies', () => {
  assert.throws(
    () => createEconomyShutdownController({}),
    /Economy runtime with beginDrain\(\) is required\./,
  );
  assert.throws(
    () => createEconomyShutdownController({ runtime: { beginDrain() {} } }),
    /Economy HTTP server with close\(\) is required\./,
  );
  assert.throws(
    () => createEconomyShutdownController({
      runtime: { beginDrain() {} },
      server: { close() {} },
    }),
    /Economy HTTP drain function is required\./,
  );
});
