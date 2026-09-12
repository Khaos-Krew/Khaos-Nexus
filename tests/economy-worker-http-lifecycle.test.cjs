'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  ECONOMY_REQUEST_TIMEOUT_MS,
  ECONOMY_HEADERS_TIMEOUT_MS,
  ECONOMY_KEEP_ALIVE_TIMEOUT_MS,
  configureEconomyHttpServer,
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
