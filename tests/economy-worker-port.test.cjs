'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_ECONOMY_PORT,
  resolveEconomyPort,
} = require('../src/economy-worker/port.cjs');

test('explicit Nexus economy port wins over Railway PORT for co-located Sentinel', () => {
  assert.equal(
    resolveEconomyPort({ NEXUS_ECONOMY_PORT: '3240', PORT: '8080' }),
    3240,
  );
});

test('dedicated worker uses Railway PORT when Nexus override is absent', () => {
  assert.equal(resolveEconomyPort({ PORT: '8080' }), 8080);
});

test('worker keeps the local default when neither runtime port is present', () => {
  assert.equal(resolveEconomyPort({}), DEFAULT_ECONOMY_PORT);
  assert.equal(DEFAULT_ECONOMY_PORT, 3240);
});

test('blank overrides are ignored in favor of the next valid source', () => {
  assert.equal(
    resolveEconomyPort({ NEXUS_ECONOMY_PORT: '  ', PORT: '9000' }),
    9000,
  );
});

test('malformed explicit ports fail closed instead of silently changing topology', () => {
  assert.throws(
    () => resolveEconomyPort({ NEXUS_ECONOMY_PORT: 'abc', PORT: '8080' }),
    /NEXUS_ECONOMY_PORT must be an integer TCP port/,
  );
  assert.throws(() => resolveEconomyPort({ PORT: '0' }), /PORT must be between 1 and 65535/);
  assert.throws(() => resolveEconomyPort({ PORT: '65536' }), /PORT must be between 1 and 65535/);
});
