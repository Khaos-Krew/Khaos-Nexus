'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ArkRconReadAdapter,
  READ_COMMANDS,
  normalizeListPlayers,
  registerArkRconPlayersJob,
} = require('../src/sentinel-v2/ark-rcon-read-adapter.cjs');

const server = {
  id: 'rag',
  envPrefix: 'ARK_RAG',
  enabled: true,
  connections: { rcon: true },
};

test('ARK RCON read adapter exposes a fixed ListPlayers command only', async () => {
  const calls = [];
  const transport = {
    async request(input) {
      calls.push(input);
      return '0. Kirito, EOS_ABC123\n1. Asuna, EOS_DEF456';
    },
  };
  const adapter = new ArkRconReadAdapter({ transport });
  const outcome = await adapter.listPlayers(server);

  assert.equal(outcome.ok, true);
  assert.equal(outcome.result.playerCount, 2);
  assert.deepEqual(calls, [{ serverId: 'rag', envPrefix: 'ARK_RAG', command: READ_COMMANDS.listPlayers }]);
  assert.equal(typeof adapter.execute, 'undefined');
  assert.equal(typeof adapter.send, 'undefined');
  assert.equal(typeof adapter.broadcast, 'undefined');
  assert.equal(typeof adapter.restart, 'undefined');
});

test('ARK RCON read adapter routes reads through provider resilience', async () => {
  const seen = [];
  const resilience = {
    async execute(input) {
      seen.push(input);
      return { ok: true, blocked: false, result: await input.run() };
    },
  };
  const adapter = new ArkRconReadAdapter({
    resilience,
    transport: { async request() { return 'No Players Connected'; } },
  });

  const outcome = await adapter.listPlayers(server, { correlationId: 'corr-rcon-1' });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.result.playerCount, 0);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].provider, 'ark-rcon:rag');
  assert.equal(seen[0].operation, 'players.list');
  assert.equal(seen[0].subject, 'rag');
  assert.equal(seen[0].correlationId, 'corr-rcon-1');
  assert.deepEqual(seen[0].payload, { serverId: 'rag', envPrefix: 'ARK_RAG', command: 'ListPlayers' });
});

test('ARK RCON read adapter does not call transport when resilience blocks the provider', async () => {
  let transportCalls = 0;
  const resilience = {
    async execute() {
      return { ok: false, blocked: true, reason: 'circuit-open', error: new Error('blocked') };
    },
  };
  const adapter = new ArkRconReadAdapter({
    resilience,
    transport: { async request() { transportCalls += 1; return ''; } },
  });

  const outcome = await adapter.listPlayers(server);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.blocked, true);
  assert.equal(transportCalls, 0);
});

test('ListPlayers normalization is bounded and ignores unrecognized lines', () => {
  const result = normalizeListPlayers('0. Kirito, EOS_ABC123\nnoise\n1. Asuna, EOS_DEF456', { serverId: 'rag', envPrefix: 'ARK_RAG' });
  assert.equal(result.playerCount, 2);
  assert.deepEqual(result.players.map((player) => player.name), ['Kirito', 'Asuna']);
});

test('ARK RCON players job is scheduler-owned and read-only', async () => {
  let definition;
  const scheduler = { register(job) { definition = job; } };
  const calls = [];
  const adapter = {
    async listPlayers(item) {
      calls.push(item.id);
      return { ok: true, blocked: false, result: { playerCount: item.id === 'rag' ? 2 : 1 } };
    },
  };
  registerArkRconPlayersJob(scheduler, {
    adapter,
    servers: [server, { ...server, id: 'astra', envPrefix: 'ARK_ASTRA' }, { ...server, id: 'off', enabled: false }],
  });

  assert.equal(definition.name, 'ark.rcon.players.read');
  assert.equal(definition.owner, 'ark');
  assert.equal(definition.trigger.type, 'interval');
  const summary = await definition.run({ correlationId: 'corr-job-1' });
  assert.deepEqual(calls, ['rag', 'astra']);
  assert.deepEqual(summary, { servers: 2, succeeded: 2, blocked: 0, failed: 0, players: 3 });
});

test('ARK RCON read adapter rejects disabled RCON targets before transport', async () => {
  let called = false;
  const adapter = new ArkRconReadAdapter({ transport: { async request() { called = true; } } });
  await assert.rejects(() => adapter.listPlayers({ ...server, connections: { rcon: false } }), /RCON is disabled/);
  assert.equal(called, false);
});
