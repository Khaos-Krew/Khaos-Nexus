'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { SourceRcon, validateConnectionOptions } = require('../bot/rcon.cjs');

test('rejects host values that include a port', () => {
  assert.throws(
    () => validateConnectionOptions({ host: '109.230.208.21:17080', port: 17080 }),
    /separate Port field/
  );
});

test('rejects invalid RCON ports before opening a socket', () => {
  assert.throws(
    () => validateConnectionOptions({ host: '127.0.0.1', port: 70000 }),
    /between 1 and 65535/
  );
});

test('explains a server disconnect before authentication', async (t) => {
  const server = net.createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const address = server.address();
  const client = new SourceRcon({
    host: '127.0.0.1',
    port: address.port,
    password: 'not-a-real-password',
    timeoutMs: 1000
  });

  await assert.rejects(
    client.execute('Info'),
    /RCON may be disabled.*port may not be the RCON port.*rejected the RCON password/
  );
});
