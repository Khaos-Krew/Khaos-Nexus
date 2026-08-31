'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ArkClusterRegistry } = require('../src/sentinel/ark-cluster-registry.cjs');
const {
  configuredAdditionalPrefixes,
  defaultsForPrefix,
  bootstrapAdditionalArkServers,
  formatBootstrapResult
} = require('../src/sentinel/ark-additional-registry-bootstrap-extension.cjs');

function withEnv(values, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value == null) delete process.env[key]; else process.env[key] = String(value);
  }
  try { return fn(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test('default secondary discovery includes configured MAP2 but ignores stale GEN2', () => {
  const env = {
    ARK_MAP2_ENABLED: 'true',
    ARK_MAP2_HOST: 'map2.example.invalid',
    ARK_GEN2_ENABLED: 'true',
    ARK_GEN2_HOST: 'stale.example.invalid'
  };
  assert.deepEqual(configuredAdditionalPrefixes(env), ['ARK_MAP2']);
});

test('explicit ARK_SERVER_PREFIXES is sanitized, deduplicated, and excludes GEN1', () => {
  const env = {
    ARK_SERVER_PREFIXES: 'ARK_GEN1, ARK_MAP2,ARK_MAP2,not valid!,ARK_EVENT1',
    ARK_MAP2_ENABLED: 'true',
    ARK_EVENT1_SFTP_HOST: 'event.example.invalid'
  };
  assert.deepEqual(configuredAdditionalPrefixes(env), ['ARK_MAP2', 'ARK_EVENT1']);
});

test('MAP2 defaults use MAP naming and preserve configured public name', () => {
  const defaults = defaultsForPrefix('ARK_MAP2', { ARK_MAP2_NAME: 'Khaos Nexus Astraeos' });
  assert.equal(defaults.id, 'map2');
  assert.equal(defaults.name, 'Khaos Nexus Astraeos');
  assert.equal(defaults.mapName, 'Khaos Nexus Astraeos');
  assert.equal(defaults.configProfile, 'map2-live');
});

test('configured MAP2 is bootstrapped idempotently into the persistent registry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-map2-registry-'));
  const registry = new ArkClusterRegistry(dir);
  withEnv({
    ARK_SERVER_PREFIXES: '',
    ARK_MAP2_ENABLED: 'true',
    ARK_MAP2_HOST: '127.0.0.2',
    ARK_MAP2_SFTP_HOST: '127.0.0.2',
    ARK_MAP2_RCON_PORT: '27020',
    ARK_MAP2_NAME: 'MAP2',
    ARK_GEN2_ENABLED: 'true',
    ARK_GEN2_HOST: 'stale.example.invalid'
  }, () => {
    const first = bootstrapAdditionalArkServers(registry);
    assert.equal(first.length, 1);
    assert.equal(first[0].prefix, 'ARK_MAP2');
    assert.equal(first[0].created, true);
    assert.equal(first[0].record.id, 'map2');
    assert.equal(first[0].record.envPrefix, 'ARK_MAP2');
    assert.equal(first[0].record.enabled, true);
    assert.match(formatBootstrapResult(first[0]), /created=map2:enabled=true/);

    const second = bootstrapAdditionalArkServers(registry);
    assert.equal(second.length, 1);
    assert.equal(second[0].existing, true);
    assert.equal(registry.list({ includeDisabled: true }).length, 1);
  });
});

test('MAP2 with an endpoint is registered but remains disabled when explicitly disabled', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-map2-disabled-'));
  const registry = new ArkClusterRegistry(dir);
  withEnv({
    ARK_SERVER_PREFIXES: '',
    ARK_MAP2_ENABLED: 'false',
    ARK_MAP2_HOST: '',
    ARK_MAP2_SFTP_HOST: '127.0.0.3',
    ARK_MAP2_RCON_PORT: '',
    ARK_MAP2_NAME: 'MAP2'
  }, () => {
    const result = bootstrapAdditionalArkServers(registry);
    assert.equal(result[0].created, true);
    assert.equal(result[0].record.enabled, false);
    assert.equal(registry.list({ includeDisabled: false }).length, 0);
    assert.equal(registry.list({ includeDisabled: true })[0].id, 'map2');
  });
});
