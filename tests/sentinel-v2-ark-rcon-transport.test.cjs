'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ArkRconReadTransport, ALLOWED_COMMAND } = require('../src/sentinel-v2/ark-rcon-read-transport.cjs');
const { loadSentinelConfig } = require('../src/sentinel-v2/config.cjs');

test('read-only RCON transport resolves credentials internally and executes only ListPlayers', async () => {
  const secret = 'do-not-leak-this-password';
  const resolverCalls = [];
  const clientOptions = [];
  const executed = [];
  const logs = [];
  const transport = new ArkRconReadTransport({
    env: { ARK_RAG_HOST: 'private.example', ARK_RAG_RCON_PASSWORD: secret },
    resolveServer(prefix, env) {
      resolverCalls.push({ prefix, env });
      return {
        host: '10.0.0.10',
        port: 27020,
        password: secret,
        enabled: true,
        timeoutMs: 4500,
        source: 'environment',
      };
    },
    clientFactory(options) {
      clientOptions.push(options);
      return {
        async execute(command) {
          executed.push(command);
          return 'No Players Connected';
        },
      };
    },
    logger: { info(message, details) { logs.push({ message, details }); } },
  });

  const result = await transport.request({ serverId: 'rag', envPrefix: 'ARK_RAG', command: ALLOWED_COMMAND });
  assert.equal(result, 'No Players Connected');
  assert.equal(resolverCalls.length, 1);
  assert.equal(resolverCalls[0].prefix, 'ARK_RAG');
  assert.deepEqual(clientOptions, [{ host: '10.0.0.10', port: 27020, password: secret, timeoutMs: 4500 }]);
  assert.deepEqual(executed, ['ListPlayers']);
  assert.equal(JSON.stringify(logs).includes(secret), false);
  assert.equal(JSON.stringify(logs).includes('10.0.0.10'), false);
  assert.equal(typeof transport.execute, 'undefined');
  assert.equal(typeof transport.send, 'undefined');
});

test('read-only RCON transport rejects arbitrary commands before resolving credentials', async () => {
  let resolved = false;
  const transport = new ArkRconReadTransport({
    resolveServer() {
      resolved = true;
      return {};
    },
    clientFactory() {
      throw new Error('should not build client');
    },
  });

  await assert.rejects(
    () => transport.request({ serverId: 'rag', envPrefix: 'ARK_RAG', command: 'Broadcast hello' }),
    /only permits ListPlayers/,
  );
  assert.equal(resolved, false);
});

test('read-only RCON transport refuses disabled or incomplete credential targets', async () => {
  const disabled = new ArkRconReadTransport({
    resolveServer() {
      return { host: 'host', port: 27020, password: 'secret', enabled: false };
    },
  });
  await assert.rejects(
    () => disabled.request({ serverId: 'rag', envPrefix: 'ARK_RAG', command: 'ListPlayers' }),
    /target is disabled/,
  );

  const missingPassword = new ArkRconReadTransport({
    resolveServer() {
      return { host: 'host', port: 27020, password: '', enabled: true };
    },
  });
  await assert.rejects(
    () => missingPassword.request({ serverId: 'rag', envPrefix: 'ARK_RAG', command: 'ListPlayers' }),
    /password is missing/,
  );
});

test('RCON shadow observation is disabled by default', () => {
  const names = [
    'NEXUS_SENTINEL_ARK_RCON_SHADOW_ENABLED',
    'NEXUS_SENTINEL_ARK_RCON_SHADOW_INTERVAL_MS',
    'NEXUS_SENTINEL_ARK_RCON_SHADOW_JITTER_MS',
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    const config = loadSentinelConfig();
    assert.equal(config.arkRconShadowEnabled, false);
    assert.equal(config.arkRconShadowIntervalMs, 300000);
    assert.equal(config.arkRconShadowJitterMs, 30000);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
