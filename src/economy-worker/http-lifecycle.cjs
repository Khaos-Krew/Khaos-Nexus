'use strict';

const ECONOMY_REQUEST_TIMEOUT_MS = 8_000;
const ECONOMY_HEADERS_TIMEOUT_MS = 5_000;
const ECONOMY_KEEP_ALIVE_TIMEOUT_MS = 5_000;

function configureEconomyHttpServer(server) {
  if (!server || typeof server !== 'object') {
    throw new TypeError('Economy HTTP server is required.');
  }

  server.requestTimeout = ECONOMY_REQUEST_TIMEOUT_MS;
  server.headersTimeout = ECONOMY_HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = ECONOMY_KEEP_ALIVE_TIMEOUT_MS;
  return server;
}

function beginEconomyHttpDrain(server, onClosed) {
  if (!server || typeof server.close !== 'function') {
    throw new TypeError('Economy HTTP server with close() is required.');
  }

  server.close(onClosed);
  if (typeof server.closeIdleConnections === 'function') {
    server.closeIdleConnections();
  }
  return server;
}

module.exports = {
  ECONOMY_REQUEST_TIMEOUT_MS,
  ECONOMY_HEADERS_TIMEOUT_MS,
  ECONOMY_KEEP_ALIVE_TIMEOUT_MS,
  configureEconomyHttpServer,
  beginEconomyHttpDrain,
};
