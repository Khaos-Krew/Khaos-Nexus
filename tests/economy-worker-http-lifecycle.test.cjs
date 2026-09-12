'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  ECONOMY_REQUEST_TIMEOUT_MS,
  ECONOMY_HEADERS_TIMEOUT_MS,
  ECONOMY_KEEP_ALIVE_TIMEOUT_MS,
  configureEconomyHttpServer,
  beginEconomyHttpDrain,
} = require('../src/economy-worker/http-lifecycle.cjs');

test('economy worker HTTP lifecycle stays inside the graceful shutdown budget', () => {
  assert.ok(ECONOMY_REQUEST_TIMEOUT_MS < 10_000);
  assert.ok(ECONOMY_HEADERS_TIMEOUT_MS <= ECONOMY_REQUEST_TIMEOUT_MS);
  assert.ok(ECONOMY_KEEP_ALIVE_TIMEOUT_MS < 10_000);
});

test('economy worker applies bounded request, header, and keep-alive deadlines', () => {
  const server = http.createServer();

  assert.equal(configureEconomyHttpServer(server), server);
  assert.equal(server.requestTimeout, ECONOMY_REQUEST_TIMEOUT_MS);
  assert.equal(server.headersTimeout, ECONOMY_HEADERS_TIMEOUT_MS);
  assert.equal(server.keepAliveTimeout, ECONOMY_KEEP_ALIVE_TIMEOUT_MS);
});

test('economy worker HTTP lifecycle configuration fails closed without a server', () => {
  assert.throws(() => configureEconomyHttpServer(null), /Economy HTTP server is required\./);
});

test('economy worker drain stops accepts before evicting idle keep-alive connections', () => {
  const calls = [];
  const onClosed = () => {};
  const server = {
    close(callback) {
      calls.push(['close', callback]);
    },
    closeIdleConnections() {
      calls.push(['closeIdleConnections']);
    },
  };

  assert.equal(beginEconomyHttpDrain(server, onClosed), server);
  assert.deepEqual(calls, [
    ['close', onClosed],
    ['closeIdleConnections'],
  ]);
});

test('economy worker drain remains compatible when explicit idle-close support is unavailable', () => {
  const calls = [];
  const server = {
    close(callback) {
      calls.push(['close', callback]);
    },
  };

  assert.equal(beginEconomyHttpDrain(server, null), server);
  assert.deepEqual(calls, [['close', null]]);
});

test('economy worker HTTP drain fails closed without a close-capable server', () => {
  assert.throws(() => beginEconomyHttpDrain({}), /Economy HTTP server with close\(\) is required\./);
});
