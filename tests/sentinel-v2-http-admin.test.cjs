'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { handleRequest, authorized } = require('../src/sentinel-v2/http-server.cjs');

function response() {
  return {
    statusCode: 0,
    headers: {},
    headersSent: false,
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(value = '') { this.body += value; this.headersSent = true; },
  };
}

function request({ method = 'GET', url = '/', token, body } = {}) {
  const req = Readable.from(body == null ? [] : [JSON.stringify(body)]);
  req.method = method;
  req.url = url;
  req.headers = token ? { authorization: `Bearer ${token}` } : {};
  return req;
}

const health = {
  live() { return { ok: true }; },
  ready() { return { ok: true }; },
};

test('admin bearer-token comparison rejects missing and incorrect credentials', () => {
  assert.equal(authorized({ headers: {} }, 'secret'), false);
  assert.equal(authorized({ headers: { authorization: 'Bearer wrong' } }, 'secret'), false);
  assert.equal(authorized({ headers: { authorization: 'Bearer secret' } }, 'secret'), true);
  assert.equal(authorized({ headers: { authorization: 'Bearer secret' } }, ''), false);
});

test('dead-letter inspection requires admin authentication', async () => {
  const res = response();
  await handleRequest(request({ url: '/admin/dead-letters' }), res, {
    health,
    adminToken: 'secret',
    deadLetters: { async list() { throw new Error('must not be called'); } },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.body).error, 'unauthorized');
});

test('dead-letter inspection forwards bounded filters to store', async () => {
  const calls = [];
  const res = response();
  await handleRequest(request({ url: '/admin/dead-letters?provider=ark.sftp&status=quarantined&limit=25', token: 'secret' }), res, {
    health,
    adminToken: 'secret',
    deadLetters: {
      async list(filters) { calls.push(filters); return [{ deadLetterId: 42, status: 'quarantined' }]; },
    },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls[0], { provider: 'ark.sftp', status: 'quarantined', limit: '25' });
  assert.equal(JSON.parse(res.body).count, 1);
});

test('RCON readiness requires admin authentication and does not require dead-letter availability', async () => {
  const denied = response();
  await handleRequest(request({ url: '/admin/readiness/ark-rcon' }), denied, {
    health,
    adminToken: 'secret',
    arkRconReadiness: { async snapshot() { throw new Error('must not be called'); } },
  });
  assert.equal(denied.statusCode, 401);

  const calls = [];
  const allowed = response();
  await handleRequest(request({
    url: '/admin/readiness/ark-rcon?since=2026-09-10T00%3A00%3A00.000Z&limit=50',
    token: 'secret',
  }), allowed, {
    health,
    adminToken: 'secret',
    arkRconReadiness: {
      async snapshot(filters) {
        calls.push(filters);
        return { advisory: true, writeCapable: false, eligible: false, reasons: ['insufficient-samples'] };
      },
    },
  });
  assert.equal(allowed.statusCode, 200);
  assert.deepEqual(calls[0], { since: '2026-09-10T00:00:00.000Z', limit: '50' });
  const body = JSON.parse(allowed.body);
  assert.equal(body.readiness.advisory, true);
  assert.equal(body.readiness.writeCapable, false);
});

test('RCON readiness reports unavailable control surface without a readiness provider', async () => {
  const res = response();
  await handleRequest(request({ url: '/admin/readiness/ark-rcon', token: 'secret' }), res, {
    health,
    adminToken: 'secret',
  });
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error, 'ark-rcon-readiness-unavailable');
});

test('dead-letter acknowledgement requires actor and reason then delegates to audited store method', async () => {
  const calls = [];
  const res = response();
  await handleRequest(request({
    method: 'POST',
    url: '/admin/dead-letters/42/acknowledge',
    token: 'secret',
    body: { actor: 'owner', reason: 'maintenance reviewed' },
  }), res, {
    health,
    adminToken: 'secret',
    deadLetters: {
      async acknowledge(id, input) {
        calls.push({ id, input });
        return { deadLetterId: Number(id), status: 'acknowledged', ...input };
      },
    },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls[0], { id: '42', input: { actor: 'owner', reason: 'maintenance reviewed' } });
  assert.equal(JSON.parse(res.body).item.status, 'acknowledged');
});

test('dead-letter acknowledgement maps already-resolved state to conflict', async () => {
  const res = response();
  await handleRequest(request({
    method: 'POST',
    url: '/admin/dead-letters/42/acknowledge',
    token: 'secret',
    body: { actor: 'owner', reason: 'duplicate' },
  }), res, {
    health,
    adminToken: 'secret',
    deadLetters: {
      async acknowledge() {
        throw Object.assign(new Error('not quarantined'), { code: 'SENTINEL_DEAD_LETTER_NOT_QUARANTINED' });
      },
    },
  });
  assert.equal(res.statusCode, 409);
  assert.equal(JSON.parse(res.body).error, 'not-quarantined');
});
