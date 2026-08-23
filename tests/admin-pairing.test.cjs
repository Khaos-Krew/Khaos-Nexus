'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { AdminPairingStore, cleanCode, hashCode } = require('../src/sentinel/admin-pairing.cjs');
const { pairRequest } = require('../src/desktop/sentinal-pairing.cjs');
const { pairingCommand } = require('../src/sentinel/admin-pairing-extension.cjs');

test('admin pairing codes are normalized, hashed, and one-use', () => {
  const store = new AdminPairingStore();
  const pairing = store.create('owner-1');
  assert.match(pairing.code, /^NXA-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(store.entries.has(pairing.code), false);
  assert.equal(store.entries.has(hashCode(pairing.code)), true);
  assert.deepEqual(store.consume(pairing.code).actorId, 'owner-1');
  assert.equal(store.consume(pairing.code), null);
  assert.equal(cleanCode(pairing.code), pairing.code.replace(/-/g, ''));
});

test('desktop pairing refuses insecure non-loopback HTTP', async () => {
  await assert.rejects(() => pairRequest('http://example.com/admin', 'NXA-AAAA-BBBB'), /valid HTTPS Sentinal admin URL/);
});

test('desktop pairing exchanges a code on loopback without exposing token in config', async (t) => {
  const token = 'a'.repeat(64);
  const server = http.createServer((req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/pair');
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      assert.equal(JSON.parse(body).code, 'NXA-TEST-CODE');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, token, pairedAt: '2026-08-23T00:00:00.000Z' }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const result = await pairRequest(`http://127.0.0.1:${port}`, 'NXA-TEST-CODE');
  assert.equal(result.ok, true);
  assert.equal(result.token, token);
  assert.equal(result.baseUrl, `http://127.0.0.1:${port}`);
});

test('/nexus-pair command has a dedicated admin pairing surface', () => {
  const json = pairingCommand().toJSON();
  assert.equal(json.name, 'nexus-pair');
  assert.match(json.description.toLowerCase(), /pair/);
});

test('sandboxed preload delegates pairing to main process IPC', () => {
  const preload = fs.readFileSync(path.join(__dirname, '../src/preload.cjs'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');
  assert.match(preload, /ipcRenderer\.invoke\('nexus:sentinal-pair'/);
  assert.doesNotMatch(preload, /sentinal-pairing\.cjs|node:https|node:http/);
  assert.match(main, /require\('\.\/desktop\/sentinal-pairing\.cjs'\)/);
  assert.match(main, /ipcMain\.handle\('nexus:sentinal-pair'/);
  assert.match(main, /vault\.set\(tokenEnv, paired\.token\)/);
  assert.doesNotMatch(preload, /paired\.token/);
});
