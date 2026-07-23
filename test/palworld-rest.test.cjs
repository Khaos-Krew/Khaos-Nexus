'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PalworldRestClient, PalworldRestError, normalizeServerAddress, summarizeGameData } = require('../bot/palworld-rest.cjs');

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => payload === undefined ? '' : JSON.stringify(payload)
  };
}

const server = {
  game: 'palworld', host: '109.230.208.21', port: 17083, protocol: 'http',
  apiPath: '/v1/api', username: 'admin', password: 'secret'
};

test('normalizes pasted host:port and URL values', () => {
  assert.deepEqual(
    normalizeServerAddress({ host: '109.230.208.21:17083', port: 0, username: '' }),
    { host: '109.230.208.21', port: 17083, username: 'admin', protocol: 'http', apiPath: '/v1/api' }
  );
  const secure = normalizeServerAddress({ host: 'https://pal.example.com:9443/custom/api', port: 0 });
  assert.equal(secure.host, 'pal.example.com');
  assert.equal(secure.port, 9443);
  assert.equal(secure.protocol, 'https');
  assert.equal(secure.apiPath, '/custom/api');
});

test('GET info uses the configured API URL and Basic authentication', async () => {
  let request;
  const client = new PalworldRestClient(server, {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response(200, { servername: 'Khaos Palworld', version: 'v1.0.0' });
    }
  });
  const result = await client.info();
  assert.equal(request.url, 'http://109.230.208.21:17083/v1/api/info');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.headers.Authorization, `Basic ${Buffer.from('admin:secret').toString('base64')}`);
  assert.equal(result.servername, 'Khaos Palworld');
});

test('POST actions send JSON bodies', async () => {
  let body;
  const client = new PalworldRestClient(server, {
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return response(200);
    }
  });
  await client.announce('Maintenance soon');
  assert.deepEqual(body, { message: 'Maintenance soon' });
});

test('401 responses produce a specific authentication error', async () => {
  const client = new PalworldRestClient(server, { fetchImpl: async () => response(401, { message: 'Unauthorized' }) });
  await assert.rejects(client.info(), (error) => {
    assert.ok(error instanceof PalworldRestError);
    assert.equal(error.code, 'AUTH_FAILED');
    assert.match(error.message, /AdminPassword/);
    return true;
  });
});

test('world actor snapshot is reduced to a safe summary', () => {
  const summary = summarizeGameData({
    Time: '2026-07-23 01:00:00', FPS: 58, AverageFPS: 52,
    ActorData: [{ UnitType: 'Player' }, { UnitType: 'WildPal' }, { UnitType: 'WildPal' }, { Type: 'PalBox' }]
  });
  assert.equal(summary.actorCount, 4);
  assert.deepEqual(summary.actorTypes, { Player: 1, WildPal: 2, PalBox: 1 });
});
