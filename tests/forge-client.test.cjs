'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeBaseUrl,
  ForgeClient
} = require('../src/sentinel/forge-client.cjs');

test('Forge base URL normalizes Railway private hostnames', () => {
  assert.equal(normalizeBaseUrl('forge.railway.internal/'), 'http://forge.railway.internal');
  assert.equal(normalizeBaseUrl('https://forge.example.test/'), 'https://forge.example.test');
});

test('Forge health probe does not require the service token', async () => {
  const calls = [];
  const client = new ForgeClient({
    enabled: true,
    baseUrl: 'forge.railway.internal:8080',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            name: 'Khaos Nexus Forge',
            version: '0.1.0',
            openaiConfigured: true,
            githubConfigured: true,
            writePolicy: 'draft-pr-only'
          };
        }
      };
    }
  });

  const result = await client.health();
  assert.equal(result.ok, true);
  assert.equal(result.writePolicy, 'draft-pr-only');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://forge.railway.internal:8080/health');
  assert.equal(calls[0].options.headers['x-forge-token'], undefined);
});

test('Forge plan sends authenticated read-only task to configured Nexus branch', async () => {
  let request;
  const client = new ForgeClient({
    enabled: true,
    baseUrl: 'http://forge.internal:8080',
    token: 'secret-token',
    defaultRepo: 'Khaos-Krew/Khaos-Nexus',
    defaultBaseRef: 'rebuild/nexus-0.1',
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            status: 'completed',
            mode: 'plan',
            repo: 'Khaos-Krew/Khaos-Nexus',
            base_ref: 'rebuild/nexus-0.1',
            branch: null,
            output: 'Plan complete.'
          };
        }
      };
    }
  });

  const result = await client.plan('Design a safe repair loop.');
  assert.equal(result.status, 'completed');
  assert.equal(result.branch, null);
  assert.equal(request.url, 'http://forge.internal:8080/api/v1/tasks');
  assert.equal(request.options.headers['x-forge-token'], 'secret-token');
  assert.equal(request.body.mode, 'plan');
  assert.equal(request.body.base_ref, 'rebuild/nexus-0.1');
});

test('Forge execute preserves draft-PR execution mode and returned forge branch', async () => {
  const client = new ForgeClient({
    enabled: true,
    baseUrl: 'http://forge.internal:8080',
    token: 'secret-token',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.mode, 'execute');
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            status: 'completed',
            mode: 'execute',
            repo: body.repo,
            base_ref: body.base_ref,
            branch: 'forge/test-repair-1234567',
            output: 'Draft PR prepared.'
          };
        }
      };
    }
  });

  const result = await client.execute('Repair the failing parser.');
  assert.match(result.branch, /^forge\//);
  assert.equal(result.output, 'Draft PR prepared.');
});

test('Forge task execution stays disabled until the bridge is explicitly enabled', async () => {
  const client = new ForgeClient({ enabled: false, baseUrl: 'http://forge.internal:8080', token: 'x', fetchImpl: async () => { throw new Error('should not call'); } });
  await assert.rejects(() => client.plan('Do nothing'), (error) => error.code === 'FORGE_DISABLED');
});
