'use strict';

const { listenEconomyServer } = require('./server.cjs');

const runtime = listenEconomyServer();

function shutdown(signal) {
  console.log(`[Nexus Economy Worker] ${signal} received; shutting down.`);
  runtime.server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref?.();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
