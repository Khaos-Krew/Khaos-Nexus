'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeBaseUrl,
  makeJobId,
  ForgeWorkerClient
} = require('../src/sentinel/forge-worker-client.cjs');

test('worker base URLs normalize Railway private hostnames', () => {
  assert.equal(normalizeBaseUrl('knx-build-node-01:8080/'), 'http://knx-build-node-01:8080');
  assert.equal(normalizeBaseUrl('https://worker.example.test/'), 'https://worker.example.test');
});

test('worker job ids satisfy the worker API identifier contract', () => {
  assert.match(makeJobId('validation'), /^NX-VALIDATION-[A-F0-9]+$/);
});

test('worker health does not send the API token', async () => {
  let request;
  const client = new ForgeWorkerClient({
    forgeUrl: 'knx-build-node-01:8080',
    token: 'secret',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, async json() { return { ok: true, nodeId: 'KNX-BUILD-NODE-01', lane: 'forge' }; } };
    }
  });

  const result = await client.health('forge');
  assert.equal(result.ok, true);
  assert.equal(request.url, 'http://knx-build-node-01:8080/health');
  assert.equal(request.options.headers.authorization, undefined);
});

test('enqueueJob sends authenticated job to the requested lane', async () => {
  let request;
  const client = new ForgeWorkerClient({
    arkUrl: 'http://knx-build-node-02:8080',
    token: 'secret',
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return { ok: true, status: 201, async json() { return { job_id: request.body.jobId, lane: request.body.lane, status: 'queued' }; } };
    }
  });

  const result = await client.enqueueJob({
    lane: 'ark',
    stage: 'validation',
    repository: 'Khaos-Krew/Khaos-Nexus',
    gitRef: 'forge/ark-config-repair',
    commands: [{ command: 'npm', args: ['run', 'check'] }]
  });

  assert.equal(result.status, 'queued');
  assert.equal(request.url, 'http://knx-build-node-02:8080/jobs');
  assert.equal(request.options.headers.authorization, 'Bearer secret');
  assert.equal(request.body.lane, 'ark');
  assert.equal(request.body.artifactType, 'ARK_CONFIG');
  assert.equal(request.body.gitRef, 'forge/ark-config-repair');
});

test('queueValidationPipeline queues check then test without deployment', async () => {
  const jobs = [];
  const client = new ForgeWorkerClient({
    forgeUrl: 'http://knx-build-node-01:8080',
    token: 'secret',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      jobs.push(body);
      return { ok: true, status: 201, async json() { return { job_id: body.jobId, stage: body.stage, status: 'queued' }; } };
    }
  });

  await client.queueValidationPipeline({ lane: 'forge', gitRef: 'forge/safe-build' });
  assert.deepEqual(jobs.map((job) => job.stage), ['validation', 'test']);
  assert.deepEqual(jobs[0].payload.commands, [{ command: 'npm', args: ['run', 'check'] }]);
  assert.deepEqual(jobs[1].payload.commands, [{ command: 'npm', args: ['test'] }]);
  assert.equal(jobs.some((job) => job.stage === 'deploy'), false);
});
