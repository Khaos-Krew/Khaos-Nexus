'use strict';

const { listenEconomyServer } = require('./server.cjs');
const { NexusEconomyWorker } = require('../sentinel/nexus-economy-worker.cjs');
const { createConfiguredClusterShop } = require('../sentinel/cluster-shop-production-service.cjs');

// Keep the economy worker on its dedicated internal port even when Railway
// injects PORT for the composite Sentinel service.
const economyPort = Number(process.env.NEXUS_ECONOMY_PORT || 3240);
const worker = new NexusEconomyWorker();
const shop = createConfiguredClusterShop({ economy: worker });
const runtime = listenEconomyServer({ port: economyPort, worker, shop });

function shutdown(signal) {
  console.log(`[Nexus Economy Worker] ${signal} received; shutting down.`);
  runtime.server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref?.();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
