'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeBaseUrl,
  ForgeClient
} = require('../src/sentinel/forge-client.cjs');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

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
      return jsonResponse({ ok: true, name: 'Khaos Nexus Forge', version: '0.1.0', openaiConfigured: true, githubConfigured: true, writePolicy: 'draft-pr-only' });
    }
  });
  const result = await client.health();
  assert.equal(result.ok, true);
  assert.equal(result.writePolicy, 'draft-pr-only');
  assert.equal(calls[0].url, 'http://forge.railway.internal:8080/health');
  assert.equal(calls[0].options.headers['x-forge-token'], undefined);
});

test('Forge CI status uses authenticated deterministic endpoint without task payload', async () => {
  let request;
  const client = new ForgeClient({
    enabled: true,
    baseUrl: 'https://forge.example.test',
    token: 'secret-token',
    defaultRepo: 'Khaos-Krew/Khaos-Nexus',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({ repo: 'Khaos-Krew/Khaos-Nexus', ref: 'forge/repair-1', sha: 'abc123', state: 'failure', combined_status: 'failure', check_runs: [{ name: 'test', status: 'completed', conclusion: 'failure' }], statuses: [] });
    }
  });
  const result = await client.ciStatus('forge/repair-1');
  assert.equal(result.state, 'failure');
  assert.match(request.url, /\/api\/v1\/ci\?/);
  assert.equal(request.options.headers['x-forge-token'], 'secret-token');
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
      return jsonResponse({ status: 'completed', mode: 'plan', repo: 'Khaos-Krew/Khaos-Nexus', base_ref: 'rebuild/nexus-0.1', branch: null, output: 'Plan complete.' });
    }
  });
  const result = await client.plan('Design a safe repair loop.');
  assert.equal(result.status, 'completed');
  assert.equal(request.url, 'http://forge.internal:8080/api/v1/tasks');
  assert.equal(request.body.mode, 'plan');
});

test('Forge execute preserves draft-PR execution mode and returned forge branch', async () => {
  const client = new ForgeClient({ enabled: true, baseUrl: 'http://forge.internal:8080', token: 'secret-token', fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.mode, 'execute');
    return jsonResponse({ status: 'completed', mode: 'execute', repo: body.repo, base_ref: body.base_ref, branch: 'forge/test-repair-1234567', output: 'Draft PR prepared.' });
  } });
  const result = await client.execute('Repair the failing parser.');
  assert.match(result.branch, /^forge\//);
});

test('Forge V0.2 status and readiness use authenticated control-plane endpoints', async () => {
  const calls = [];
  const client = new ForgeClient({ enabled: true, baseUrl: 'https://forge.example.test', token: 'shared', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/ready')) return jsonResponse({ ok: true, ready: true });
    return jsonResponse({ ok: true, version: '0.2.0-infra', queue: { queued: 0 }, approvalGate: 'required-for-durable-model-work' });
  } });
  assert.equal((await client.ready()).ready, true);
  assert.equal((await client.infrastructureStatus()).version, '0.2.0-infra');
  assert.equal(calls.every((call) => call.options.headers['x-forge-token'] === 'shared'), true);
});

test('Forge queue submission carries actor correlation and idempotency metadata without model execution', async () => {
  let request;
  const client = new ForgeClient({ enabled: true, baseUrl: 'https://forge.example.test', token: 'shared', fetchImpl: async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return jsonResponse({ ok: true, duplicate: false, approvalRequired: true, modelTokensConsumed: 0, task: { id: 'task-1', state: 'queued', repo: 'Khaos-Krew/Khaos-Nexus', mode: 'plan', base_ref: 'rebuild/nexus-0.1', goal: 'Inspect failure', attempt: 0, max_attempts: 2 } });
  } });
  const result = await client.queueTask({ goal: 'Inspect failure', actor: 'discord:123', correlationId: 'incident:ABC', idempotencyKey: 'incident:ABC' });
  assert.equal(result.task.id, 'task-1');
  assert.equal(result.approvalRequired, true);
  assert.equal(result.modelTokensConsumed, 0);
  assert.equal(request.options.headers['x-forge-actor'], 'discord:123');
  assert.equal(request.options.headers['x-forge-correlation-id'], 'incident:ABC');
  assert.equal(request.options.headers['idempotency-key'], 'incident:ABC');
  assert.equal(request.body.mode, 'plan');
});

test('Forge approval and revoke actions remain explicit zero-token control-plane calls', async () => {
  const calls = [];
  const client = new ForgeClient({ enabled: true, baseUrl: 'https://forge.example.test', token: 'shared', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ ok: true, modelTokensConsumed: 0, task: { id: 'abc', state: 'queued' }, approval: { task_id: 'abc' } });
  } });
  const approved = await client.approveTask('abc', { actor: 'discord:123' });
  const revoked = await client.revokeTask('abc', { actor: 'discord:123' });
  assert.equal(approved.modelTokensConsumed, 0);
  assert.equal(revoked.modelTokensConsumed, 0);
  assert.match(calls[0].url, /\/task-queue\/abc\/approve$/);
  assert.match(calls[1].url, /\/task-queue\/abc\/revoke$/);
  assert.equal(calls[0].options.method, 'POST');
});

test('Forge repair candidate intake is idempotent infrastructure and does not execute a model', async () => {
  let request;
  const client = new ForgeClient({ enabled: true, baseUrl: 'https://forge.example.test', token: 'shared', fetchImpl: async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return jsonResponse({ ok: true, approvalRequired: true, modelTokensConsumed: 0, execution: 'not-started', task: { id: 'repair-1', state: 'queued', mode: 'plan', base_ref: 'rebuild/nexus-0.1' } });
  } });
  const result = await client.queueRepairCandidate({ incidentId: 'SR-123', severity: 'high', summary: 'CI failed', evidence: ['check=test failure'], actor: 'self-repair' });
  assert.equal(result.execution, 'not-started');
  assert.equal(result.modelTokensConsumed, 0);
  assert.equal(request.body.incident_id, 'SR-123');
  assert.equal(request.options.headers['x-forge-actor'], 'self-repair');
});

test('Forge usage endpoint maps persisted token ledger without invoking a task', async () => {
  const client = new ForgeClient({ enabled: true, baseUrl: 'https://forge.example.test', token: 'shared', fetchImpl: async (url) => {
    assert.match(url, /\/api\/v1\/usage$/);
    return jsonResponse({ ok: true, totals: { tasks: 2, requests: 3, input_tokens: 100, output_tokens: 50, total_tokens: 150 }, by_route: { primary: { total_tokens: 150 } }, modelTokensConsumed: 0 });
  } });
  const usage = await client.usage();
  assert.deepEqual(usage.totals, { tasks: 2, requests: 3, inputTokens: 100, outputTokens: 50, totalTokens: 150 });
  assert.equal(usage.modelTokensConsumed, 0);
});

test('Forge task execution stays disabled until the bridge is explicitly enabled', async () => {
  const client = new ForgeClient({ enabled: false, baseUrl: 'http://forge.internal:8080', token: 'x', fetchImpl: async () => { throw new Error('should not call'); } });
  await assert.rejects(() => client.plan('Do nothing'), (error) => error.code === 'FORGE_DISABLED');
});
