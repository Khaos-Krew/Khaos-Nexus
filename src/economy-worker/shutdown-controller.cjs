'use strict';

const ECONOMY_FORCE_SHUTDOWN_MS = 10_000;

function createEconomyShutdownController({
  runtime,
  server,
  beginHttpDrain,
  exit = (code) => process.exit(code),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  log = (message) => console.log(message),
} = {}) {
  if (!runtime || typeof runtime.beginDrain !== 'function') {
    throw new TypeError('Economy runtime with beginDrain() is required.');
  }
  if (!server || typeof server.close !== 'function') {
    throw new TypeError('Economy HTTP server with close() is required.');
  }
  if (typeof beginHttpDrain !== 'function') {
    throw new TypeError('Economy HTTP drain function is required.');
  }

  let started = false;
  let forceTimer = null;

  return function shutdown(signal) {
    if (started) {
      return false;
    }
    started = true;

    runtime.beginDrain(signal);
    log(`[Nexus Economy Worker] ${signal} received; draining before shutdown.`);

    forceTimer = setTimer(() => exit(1), ECONOMY_FORCE_SHUTDOWN_MS);
    forceTimer?.unref?.();

    try {
      beginHttpDrain(server, () => {
        if (forceTimer) {
          clearTimer(forceTimer);
          forceTimer = null;
        }
        exit(0);
      });
    } catch {
      // Do not let a synchronous HTTP-drain setup failure escape the signal handler.
      // The bounded forced-exit timer remains armed so shutdown still fails closed.
      log('[Nexus Economy Worker] HTTP drain setup failed; forced shutdown fallback remains armed.');
    }

    return true;
  };
}

module.exports = {
  ECONOMY_FORCE_SHUTDOWN_MS,
  createEconomyShutdownController,
};
