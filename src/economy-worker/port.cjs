'use strict';

const DEFAULT_ECONOMY_PORT = 3240;

function parsePort(name, value) {
  if (value == null || String(value).trim() === '') return null;

  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) {
    throw new TypeError(`${name} must be an integer TCP port`);
  }

  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new RangeError(`${name} must be between 1 and 65535`);
  }

  return port;
}

function resolveEconomyPort(env = process.env) {
  const dedicatedPort = parsePort('NEXUS_ECONOMY_PORT', env.NEXUS_ECONOMY_PORT);
  if (dedicatedPort != null) return dedicatedPort;

  const railwayPort = parsePort('PORT', env.PORT);
  if (railwayPort != null) return railwayPort;

  return DEFAULT_ECONOMY_PORT;
}

module.exports = {
  DEFAULT_ECONOMY_PORT,
  resolveEconomyPort,
};
