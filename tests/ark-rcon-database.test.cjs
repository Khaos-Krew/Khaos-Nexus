'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { PGlite } = require('@electric-sql/pglite');
const { ArkRconDatabase } = require('../src/sentinel/ark-rcon-database.cjs');
const { ArkRconClient, packet, decode } = require('../src/sentinel/ark-rcon.cjs');

test('RCON database encrypts credentials, binds ciphertext to map, gates changes and never falls back', async () => {
  const db = new PGlite();
  const provider = new ArkRconDatabase({ pool: db, secret: 'x'.repeat(32), writesEnabled: true });
  try {
    await provider.initialize();
    await provider.setEndpoint('ARK_GEN1', { host: '127.0.0.1', port: 27020, enabled: true, actorId: 'owner' });
    await provider.setPassword('ARK_GEN1', 'test-password-never-plaintext', 'owner');
    const persisted = (await db.query('SELECT * FROM nexus_ark_rcon_servers')).rows[0];
    assert.equal(JSON.stringify(persisted).includes('test-password-never-plaintext'), false);
    assert.equal(JSON.stringify(await provider.status('ARK_GEN1')).includes('test-password'), false);
    assert.equal((await provider.resolve('ARK_GEN1')).password, 'test-password-never-plaintext');
    assert.throws(() => provider.decrypt('ARK_MAP2', persisted.password), /cannot be decrypted/);
    const wrongKey = new ArkRconDatabase({ pool: db, secret: 'z'.repeat(32) });
    await assert.rejects(wrongKey.resolve('ARK_GEN1'), /cannot be decrypted/);
    await assert.rejects(wrongKey.setPassword('ARK_GEN1', 'replacement', 'owner'), /writes are disabled/);
    await provider.clear('ARK_GEN1', 'owner');
    await assert.rejects(provider.resolve('ARK_GEN1'), /disabled/);
    await assert.rejects(provider.resolve('ARK_MAP2'), /missing or disabled/);
  } finally { await db.close(); }
});

async function fakeServer(password, label) {
  const commands = [];
  const server = net.createServer(socket => {
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      const parsed = decode(Buffer.concat([buffer, chunk])); buffer = parsed.remaining;
      for (const p of parsed.packets) {
        if (p.type === 3) socket.write(packet(p.body === password ? p.id : -1, 2, ''));
        else { commands.push(p.body); socket.end(packet(p.id, 0, label)); }
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, commands, port: server.address().port };
}

test('existing shared RCON client observes database endpoint/password changes on next command', async () => {
  const db = new PGlite();
  const provider = new ArkRconDatabase({ pool: db, secret: 's'.repeat(32), writesEnabled: true });
  const first = await fakeServer('first-password', 'first map response');
  const second = await fakeServer('second-password', 'second map response');
  try {
    await provider.initialize();
    await provider.setEndpoint('ARK_GEN1', { host: '127.0.0.1', port: first.port, enabled: true, actorId: 'owner' });
    await provider.setPassword('ARK_GEN1', 'first-password', 'owner');
    const client = new ArkRconClient({ prefix: 'ARK_GEN1', provider });
    assert.equal(await client.execute('ListPlayers'), 'first map response');
    await provider.setEndpoint('ARK_GEN1', { host: '127.0.0.1', port: second.port, enabled: true, actorId: 'owner' });
    await provider.setPassword('ARK_GEN1', 'second-password', 'owner');
    assert.equal(await client.execute('ListPlayers'), 'second map response');
    await provider.clear('ARK_GEN1', 'owner');
    await assert.rejects(client.execute('SaveWorld'), /disabled/);
    assert.deepEqual(first.commands, ['ListPlayers']);
    assert.deepEqual(second.commands, ['ListPlayers']);
  } finally {
    await Promise.all([new Promise(r => first.server.close(r)), new Promise(r => second.server.close(r))]);
    await db.close();
  }
});

test('/ark server includes owner configuration and staff test commands within Discord limits', () => {
  const definition = require('../src/sentinel/ark-ops-extension.cjs').arkCommand().toJSON();
  assert.ok(definition.options.length <= 25);
  const group = definition.options.find(o => o.name === 'server');
  assert.ok(group.options.some(o => o.name === 'test'));
  assert.ok(group.options.some(o => o.name === 'password'));
});
