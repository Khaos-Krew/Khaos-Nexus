'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ServerConnection, isPalworldRest } = require('../bot/server-client.cjs');

function response(payload) {
  return { ok: true, status: 200, text: async () => payload === undefined ? '' : JSON.stringify(payload) };
}

const server = {
  game: 'palworld', connectionType: 'rest', host: '127.0.0.1', port: 17083,
  protocol: 'http', apiPath: '/v1/api', username: 'admin', password: 'secret'
};

test('Palworld defaults to REST unless explicitly set to legacy RCON', () => {
  assert.equal(isPalworldRest({ game: 'palworld' }), true);
  assert.equal(isPalworldRest({ game: 'palworld', connectionType: 'rcon' }), false);
  assert.equal(isPalworldRest({ game: 'ark' }), false);
});

test('status combines info and metrics', async () => {
  const seen = [];
  const connection = new ServerConnection(server, {
    fetchImpl: async (url) => {
      seen.push(url);
      return url.endsWith('/info')
        ? response({ servername: 'Khaos', version: '1.0' })
        : response({ serverfps: 60, currentplayernum: 2, maxplayernum: 16 });
    }
  });
  const result = await connection.action('status');
  assert.equal(result.info.servername, 'Khaos');
  assert.equal(result.metrics.serverfps, 60);
  assert.equal(seen.length, 2);
});

test('legacy Save command is translated to the REST save endpoint', async () => {
  let called;
  const connection = new ServerConnection(server, {
    fetchImpl: async (url, options) => {
      called = { url, options };
      return response();
    }
  });
  const result = await connection.execute('Save');
  assert.ok(called.url.endsWith('/save'));
  assert.equal(called.options.method, 'POST');
  assert.match(result, /save requested/i);
});

test('player names resolve to user IDs before moderation', async () => {
  const requests = [];
  const connection = new ServerConnection(server, {
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/players')) return response({ players: [{ name: 'Kirito', userId: 'steam_123' }] });
      return response();
    }
  });
  await connection.action('kick', { player: 'Kirito', message: 'Testing' });
  const kick = requests.find((item) => item.url.endsWith('/kick'));
  assert.deepEqual(JSON.parse(kick.options.body), { userid: 'steam_123', message: 'Testing' });
});

test('raw commands are rejected for REST connections', async () => {
  const connection = new ServerConnection(server, { fetchImpl: async () => response() });
  await assert.rejects(connection.action('raw', { command: 'Info' }), /typed Palworld action/);
});
