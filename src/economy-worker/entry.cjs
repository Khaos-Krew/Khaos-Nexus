'use strict';

const { listenEconomyServer } = require('./server.cjs');

// Keep the economy worker on its dedicated internal port even when Railway
// injects PORT for the composite Sentinel service.
const economyPort = Number(process.env.NEXUS_ECONOMY_PORT || 3240);
const runtime = listenEconomyServer({ port: economyPort });

function shutdown(signal) {
  console.log(`[Nexus Economy Worker] ${signal} received; shutting down.`);
  runtime.server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref?.();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
