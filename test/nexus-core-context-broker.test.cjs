'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FileEventJournal } = require('../shared/nexus-core/event-journal.cjs');
const { ContextBroker } = require('../shared/nexus-core/context-broker.cjs');

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-nexus-context-'));
  const journal = new FileEventJournal({ filePath: path.join(root, 'events.ndjson'), fsync: false });
  let id = 0;
  const broker = new ContextBroker({
    journal,
    now: () => '2026-08-11T07:10:00.000Z',
    idFactory: () => `context-${++id}`
  });
  return { broker, journal };
}

function request(scopes) {
  return {
    requestId: 'ctx-request-001',
    correlationId: 'corr-context-001',
    actor: { kind: 'discord-user', id: '1234' },
    scopes
  };
}

test('Veyra receives only authorized D&D context and provider secrets are redacted', async () => {
  const { broker, journal } = harness();
  broker
    .registerWorker('veyra', {
      allowedScopeKinds: ['campaign', 'session', 'user'],
      deniedScopeKinds: ['server', 'module'],
      maxScopes: 4
    })
    .registerProvider('campaign', async (scope) => ({
      id: scope.id,
      title: 'Ashes of the Nexus',
      dmNotes: 'Visible to this authorized worker.',
      credentials: { apiKey: 'should-never-leave-core' },
      nested: { discordToken: 'also-private', safe: true }
    }));

  const result = await broker.resolve('veyra', request([{ kind: 'campaign', id: 'campaign-1' }]));
  assert.equal(result.contexts.length, 1);
  assert.equal(result.contexts[0].data.title, 'Ashes of the Nexus');
  assert.equal(result.contexts[0].data.credentials, '[REDACTED]');
  assert.equal(result.contexts[0].data.nested.discordToken, '[REDACTED]');
  assert.equal(result.contexts[0].data.nested.safe, true);
  assert.equal(Object.isFrozen(result.contexts[0].data), true);

  const grant = journal.list({ type: 'core.context.granted' })[0];
  assert.equal(grant.event.payload.workerId, 'veyra');
  assert.deepEqual(grant.event.payload.scopes, [{ kind: 'campaign', id: 'campaign-1' }]);
  assert.equal(JSON.stringify(grant).includes('should-never-leave-core'), false);
  assert.equal(JSON.stringify(grant).includes('also-private'), false);
});

test('Sentinel is denied D&D campaign context even when a provider exists', async () => {
  const { broker, journal } = harness();
  let providerCalls = 0;
  broker
    .registerWorker('sentinel', {
      allowedScopeKinds: ['server', 'module'],
      deniedScopeKinds: ['campaign', 'session']
    })
    .registerProvider('campaign', async () => {
      providerCalls += 1;
      return { privateDmContext: 'must not resolve' };
    });

  await assert.rejects(
    () => broker.resolve('sentinel', request([{ kind: 'campaign', id: 'campaign-1' }])),
    (error) => error.code === 'NEXUS_CONTEXT_DENIED'
  );
  assert.equal(providerCalls, 0);

  const denial = journal.list({ type: 'core.context.denied' })[0];
  assert.equal(denial.event.payload.reason, 'scope-not-authorized');
  assert.equal(JSON.stringify(denial).includes('privateDmContext'), false);
});

test('scope limits and missing providers fail closed before any context is returned', async () => {
  const { broker } = harness();
  broker.registerWorker('worker', {
    allowedScopeKinds: ['server', 'user'],
    maxScopes: 1
  });
  broker.registerProvider('server', async () => ({ online: true }));

  await assert.rejects(
    () => broker.resolve('worker', request([
      { kind: 'server', id: 'rag-01' },
      { kind: 'user', id: 'user-1' }
    ])),
    (error) => error.code === 'NEXUS_CONTEXT_DENIED'
  );

  await assert.rejects(
    () => broker.resolve('worker', request([{ kind: 'user', id: 'user-1' }])),
    (error) => error.code === 'NEXUS_CONTEXT_DENIED'
  );
});

test('duplicate scopes are deduplicated before provider resolution and auditing', async () => {
  const { broker, journal } = harness();
  let calls = 0;
  broker
    .registerWorker('worker', { allowedScopeKinds: ['server'], maxScopes: 2 })
    .registerProvider('server', async () => {
      calls += 1;
      return { online: true };
    });

  const result = await broker.resolve('worker', request([
    { kind: 'server', id: 'rag-01' },
    { kind: 'server', id: 'rag-01' }
  ]));
  assert.equal(calls, 1);
  assert.equal(result.contexts.length, 1);
  assert.equal(journal.list({ type: 'core.context.granted' })[0].event.payload.count, 1);
});

test('context providers cannot smuggle functions, undefined values, or non-plain objects', async () => {
  const invalidValues = [
    { invalid: undefined },
    { invalid: () => true },
    { invalid: new Date('2026-08-11T07:00:00Z') }
  ];

  for (const [index, provided] of invalidValues.entries()) {
    const { broker } = harness();
    broker
      .registerWorker(`worker-${index}`, { allowedScopeKinds: ['server'] })
      .registerProvider('server', async () => provided);
    await assert.rejects(
      () => broker.resolve(`worker-${index}`, request([{ kind: 'server', id: `server-${index}` }])),
      (error) => error.code === 'NEXUS_CONTEXT_INVALID'
    );
  }
});
